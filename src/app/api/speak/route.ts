import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ELEVEN_MODEL = process.env.VITA_TTS_MODEL || "eleven_flash_v2_5";
const ELEVEN_OUTPUT_FORMAT = "mp3_22050_32";
const ELEVEN_TIMEOUT_MS = 8_000;

const GEMINI_MODEL = "gemini-3.1-flash-tts-preview";
const GEMINI_VOICE = process.env.GEMINI_TTS_VOICE || "Aoede";
const GEMINI_COOLDOWN_MS = 60 * 60 * 1000;

let geminiDisabledUntil = 0;
let geminiFallbackInFlight: Promise<Response> | null = null;

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isQuotaError(error: unknown): boolean {
  const message = errText(error);
  return (
    /\b429\b/.test(message) ||
    /RESOURCE_EXHAUSTED/i.test(message) ||
    /quota/i.test(message) ||
    /rate.?limit/i.test(message)
  );
}

function geminiCoolingDown(): boolean {
  return Date.now() < geminiDisabledUntil;
}

function disableGemini(reason: string) {
  geminiDisabledUntil = Date.now() + GEMINI_COOLDOWN_MS;
  console.warn(`[VITA TTS] Gemini FALLBACK disabled for 60 minutes: ${reason}`);
}

function pcmToWav(
  pcm: Buffer,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16,
): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

async function elevenLabsPrimary(text: string): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.VITA_TTS_VOICE_ID;

  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is missing from .env.local." },
      { status: 500 },
    );
  }

  if (!voiceId) {
    return NextResponse.json(
      { error: "VITA_TTS_VOICE_ID is missing from .env.local." },
      { status: 500 },
    );
  }

  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/` +
    `${encodeURIComponent(voiceId)}/stream` +
    `?output_format=${encodeURIComponent(ELEVEN_OUTPUT_FORMAT)}`;

  console.log(`[VITA TTS] ElevenLabs PRIMARY start model=${ELEVEN_MODEL}`);
  const started = performance.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ELEVEN_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVEN_MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const elapsed = Math.round(performance.now() - started);
    console.log(
      `[VITA TTS] ElevenLabs PRIMARY status=${response.status} in ${elapsed}ms`,
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error(
        `[VITA TTS] ElevenLabs PRIMARY error ${response.status}: ${detail}`,
      );
      throw new Error(
        `ElevenLabs returned HTTP ${response.status}: ${detail}`,
      );
    }

    if (!response.body) {
      throw new Error("ElevenLabs returned HTTP 200 without an audio stream.");
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Vita-TTS-Provider": "elevenlabs",
        "X-Vita-TTS-Model": ELEVEN_MODEL,
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `ElevenLabs PRIMARY timed out after ${ELEVEN_TIMEOUT_MS}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function geminiFallback(text: string): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing from .env.local.");
  }

  console.log(
    `[VITA TTS] Gemini FALLBACK start model=${GEMINI_MODEL} voice=${GEMINI_VOICE}`,
  );
  const started = performance.now();

  const ai = new GoogleGenAI({ apiKey });

  const stream = await ai.models.generateContentStream({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "Read the following text as VITA, a personal health and fitness assistant.",
              "Style: warm, natural, confident, calm, conversational.",
              "Accent: Indian English.",
              "Pace: moderate and natural, with clear pauses.",
              "Do not add or remove words.",
              "",
              `Text to speak: ${text}`,
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: GEMINI_VOICE,
          },
        },
      },
    },
  });

  const chunks: Buffer[] = [];
  let chunkCount = 0;

  for await (const chunk of stream) {
    const inlineData =
      chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inlineData?.data) continue;

    const audio = Buffer.from(inlineData.data, "base64");
    if (!audio.length) continue;

    chunks.push(audio);
    chunkCount += 1;
  }

  const pcm = Buffer.concat(chunks);

  console.log(
    `[VITA TTS] Gemini FALLBACK chunks=${chunkCount} bytes=${pcm.length} in ${Math.round(
      performance.now() - started,
    )}ms`,
  );

  if (!pcm.length) {
    throw new Error("Gemini FALLBACK completed without audio data.");
  }

  const wav = pcmToWav(pcm);
  const wavBytes = new Uint8Array(wav);

  return new Response(wavBytes, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(wav.length),
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Vita-TTS-Provider": "gemini",
      "X-Vita-TTS-Model": GEMINI_MODEL,
      "X-Vita-TTS-Voice": GEMINI_VOICE,
    },
  });
}

async function getGeminiFallback(text: string): Promise<Response> {
  if (geminiFallbackInFlight) return geminiFallbackInFlight;

  if (geminiCoolingDown()) {
    throw new Error(
      "Gemini TTS FALLBACK is in 60-minute quota cooldown.",
    );
  }

  geminiFallbackInFlight = (async () => {
    try {
      return await geminiFallback(text);
    } catch (error) {
      if (isQuotaError(error)) {
        disableGemini(errText(error));
      }
      throw error;
    } finally {
      geminiFallbackInFlight = null;
    }
  })();

  return geminiFallbackInFlight;
}

async function speak(text: string): Promise<Response> {
  const cleanText = text.replace(/\s+/g, " ").trim();

  if (!cleanText) {
    return NextResponse.json(
      { error: "TTS text is required." },
      { status: 400 },
    );
  }

  if (cleanText.length > 2500) {
    return NextResponse.json(
      { error: "TTS text is too long." },
      { status: 400 },
    );
  }

  try {
    return await elevenLabsPrimary(cleanText);
  } catch (elevenError) {
    console.warn(
      "[VITA TTS] ElevenLabs PRIMARY failed; evaluating Gemini FALLBACK.",
      elevenError,
    );
  }

  if (geminiCoolingDown()) {
    return NextResponse.json(
      {
        error:
          "ElevenLabs TTS failed and Gemini TTS is temporarily disabled because of quota/rate limiting.",
      },
      { status: 503 },
    );
  }

  try {
    return await getGeminiFallback(cleanText);
  } catch (geminiError) {
    console.error("[VITA TTS] Gemini FALLBACK failed.", geminiError);

    return NextResponse.json(
      {
        error:
          `ElevenLabs primary failed; Gemini fallback failed: ${errText(
            geminiError,
          )}`,
      },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest) {
  return speak(req.nextUrl.searchParams.get("text")?.trim() || "");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return speak(typeof body?.text === "string" ? body.text.trim() : "");
  } catch {
    return NextResponse.json(
      { error: "Invalid TTS request body." },
      { status: 400 },
    );
  }
}
