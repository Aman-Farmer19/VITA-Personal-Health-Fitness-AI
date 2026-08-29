import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const GEMINI_TTS_VOICE =
  process.env.GEMINI_TTS_VOICE || "Aoede";

const FALLBACK_ENGINE =
  (process.env.VITA_TTS_FALLBACK || "elevenlabs").toLowerCase();

function pcmToWav(
  pcm: Buffer,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16,
) {
  const byteRate =
    sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign =
    numChannels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);

  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

async function geminiTts(text: string) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is missing from .env.local." },
      { status: 500 },
    );
  }

  const started = performance.now();

  try {
    const ai = new GoogleGenAI({ apiKey });

    /*
     * This intentionally follows Google's current JavaScript TTS sample:
     * models.generateContentStream(...)
     * responseModalities: ['AUDIO']
     * prebuiltVoiceConfig.voiceName
     */
    const responseStream = await ai.models.generateContentStream({
      model: GEMINI_TTS_MODEL,
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
              voiceName: GEMINI_TTS_VOICE,
            },
          },
        },
      },
    });

    const chunks: Buffer[] = [];
    let chunkCount = 0;
    let mimeType = "audio/pcm";

    for await (const chunk of responseStream) {
      const inlineData =
        chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData;

      if (!inlineData?.data) continue;

      const audioChunk = Buffer.from(
        inlineData.data,
        "base64",
      );

      if (audioChunk.length === 0) continue;

      chunks.push(audioChunk);
      chunkCount += 1;

      if (inlineData.mimeType) {
        mimeType = inlineData.mimeType;
      }
    }

    const pcm = Buffer.concat(chunks);

    console.log(
      `[VITA TTS] Gemini SDK chunks=${chunkCount} bytes=${pcm.length} mime=${mimeType} in ${Math.round(
        performance.now() - started,
      )}ms`,
    );

    if (!pcm.length) {
      throw new Error(
        "Gemini TTS stream completed without audio data.",
      );
    }

    // Gemini's documented stream returns raw PCM:
    // 24 kHz, mono, 16-bit. Wrap it in WAV for browser Audio().
    const wav = pcmToWav(pcm, 24000, 1, 16);

    return new Response(wav, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(wav.length),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Vita-TTS-Provider": GEMINI_TTS_MODEL,
        "X-Vita-TTS-Voice": GEMINI_TTS_VOICE,
        "X-Vita-TTS-Latency-Ms": String(
          Math.round(performance.now() - started),
        ),
      },
    });
  } catch (error) {
    console.error("[VITA TTS] Gemini SDK failed:", error);

    if (FALLBACK_ENGINE === "elevenlabs") {
      return elevenLabsFallback(text, error);
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gemini TTS failed.",
      },
      { status: 502 },
    );
  }
}

async function elevenLabsFallback(
  text: string,
  cause: unknown = null,
) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.VITA_TTS_VOICE_ID;
  const modelId =
    process.env.VITA_TTS_MODEL || "eleven_flash_v2_5";

  console.warn(
    "[VITA TTS] Gemini unavailable; using ElevenLabs fallback.",
    cause,
  );

  if (!apiKey || !voiceId) {
    return NextResponse.json(
      {
        error:
          "Gemini TTS failed and ElevenLabs fallback is not configured.",
      },
      { status: 502 },
    );
  }

  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/` +
    `${encodeURIComponent(voiceId)}/stream` +
    `?output_format=mp3_22050_32`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.8,
        style: 0.15,
        use_speaker_boost: true,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text();

    return new NextResponse(
      errorText || "ElevenLabs fallback failed.",
      {
        status: response.status || 502,
        headers: {
          "Content-Type":
            response.headers.get("content-type") ||
            "text/plain",
        },
      },
    );
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type":
        response.headers.get("content-type") ||
        "audio/mpeg",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Vita-TTS-Provider": "elevenlabs-primary",
    },
  });
}

let geminiDisabledUntil = 0;
let geminiProbeInFlight: Promise<Response> | null = null;

const GEMINI_COOLDOWN_MS = 60 * 60 * 1000;

function isGeminiTtsCoolingDown() {
  return Date.now() < geminiDisabledUntil;
}

function disableGeminiTts(reason: string) {
  geminiDisabledUntil = Date.now() + GEMINI_COOLDOWN_MS;
  console.warn(
    `[VITA TTS] Gemini TTS disabled for ${Math.round(
      GEMINI_COOLDOWN_MS / 60000,
    )} minutes: ${reason}`,
  );
}

async function speakWithPolicy(text: string) {
  /*
   * Production policy:
   *   1. ElevenLabs is the primary voice.
   *   2. Gemini 3.1 Flash TTS is a fallback.
   *   3. A Gemini 429 triggers a cooldown so we don't burn requests
   *      repeatedly while the project is quota-limited.
   */
  try {
    console.log("[VITA TTS] primary=ElevenLabs");

    const eleven = await elevenLabsFallback(text, null);

    if (eleven.ok) {
      return eleven;
    }

    console.warn(
      `[VITA TTS] ElevenLabs primary returned HTTP ${eleven.status}; trying Gemini fallback.`,
    );
  } catch (error) {
    console.warn(
      "[VITA TTS] ElevenLabs primary failed; trying Gemini fallback.",
      error,
    );
  }

  if (isGeminiTtsCoolingDown()) {
    console.log(
      "[VITA TTS] Gemini fallback is cooling down; returning ElevenLabs error.",
    );

    return NextResponse.json(
      {
        error:
          "Primary ElevenLabs TTS failed and Gemini TTS is temporarily disabled because of quota/rate limiting.",
      },
      { status: 503 },
    );
  }

  return geminiWithQuotaHandling(text);
}

async function geminiWithQuotaHandling(text: string) {
  // De-duplicate simultaneous Gemini fallback attempts.
  if (geminiProbeInFlight) {
    return geminiProbeInFlight;
  }

  geminiProbeInFlight = (async () => {
    try {
      console.log(
        `[VITA TTS] fallback=Gemini model=${GEMINI_TTS_MODEL} voice=${GEMINI_TTS_VOICE}`,
      );

      return await geminiTts(text);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      // The SDK currently throws ApiError with status=429 for free-tier
      // request exhaustion. Treat the error as quota exhaustion and enter
      // cooldown rather than retrying over and over.
      const looksLikeQuota =
        /\b429\b/.test(message) ||
        /RESOURCE_EXHAUSTED/i.test(message) ||
        /quota/i.test(message) ||
        /rate.?limit/i.test(message);

      if (looksLikeQuota) {
        disableGeminiTts("quota/rate limit detected");
      }

      throw error;
    } finally {
      geminiProbeInFlight = null;
    }
  })().catch(async (error) => {
    console.error("[VITA TTS] Gemini fallback failed:", error);

    // Keep the response contract predictable.
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gemini fallback TTS failed.",
      },
      { status: 502 },
    );
  });

  return geminiProbeInFlight;
}

async function speak(text: string) {
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

  return speakWithPolicy(cleanText);
}

export async function GET(req: NextRequest) {
  return speak(
    req.nextUrl.searchParams.get("text")?.trim() || "",
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    return speak(
      typeof body?.text === "string"
        ? body.text.trim()
        : "",
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid TTS request body." },
      { status: 400 },
    );
  }
}
