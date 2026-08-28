import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "eleven_flash_v2_5";
const DEFAULT_OUTPUT_FORMAT = "mp3_22050_32";

async function streamSpeech(text: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.VITA_TTS_VOICE_ID;
  const modelId = process.env.VITA_TTS_MODEL || DEFAULT_MODEL;

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

  if (!text) {
    return NextResponse.json(
      { error: "TTS text is required." },
      { status: 400 },
    );
  }

  if (text.length > 2500) {
    return NextResponse.json(
      { error: "TTS text is too long." },
      { status: 400 },
    );
  }

  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/` +
    `${encodeURIComponent(voiceId)}/stream` +
    `?output_format=${encodeURIComponent(DEFAULT_OUTPUT_FORMAT)}`;

  console.log(
    `[VITA TTS] ElevenLabs stream request: voice=${voiceId} model=${modelId}`,
  );

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

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      `[VITA TTS] ElevenLabs ${response.status}:`,
      errorText,
    );

    return new NextResponse(errorText || "ElevenLabs TTS failed.", {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "text/plain",
      },
    });
  }

  if (!response.body) {
    return NextResponse.json(
      { error: "ElevenLabs returned no audio stream." },
      { status: 502 },
    );
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type":
        response.headers.get("content-type") || "audio/mpeg",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Transfer-Encoding": "chunked",
    },
  });
}

export async function GET(req: NextRequest) {
  const text = req.nextUrl.searchParams.get("text")?.trim() || "";
  return streamSpeech(text);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text =
      typeof body?.text === "string" ? body.text.trim() : "";

    return streamSpeech(text);
  } catch {
    return NextResponse.json(
      { error: "Invalid TTS request body." },
      { status: 400 },
    );
  }
}
