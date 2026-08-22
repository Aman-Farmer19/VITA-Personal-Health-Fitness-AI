import dns from "node:dns";
import { NextRequest, NextResponse } from "next/server";

dns.setDefaultResultOrder("ipv4first");

export const runtime = "nodejs";

const GROQ_API_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

export async function GET() {
  return NextResponse.json({ ok: true, service: "transcribe" });
}

export async function POST(req: NextRequest) {
  const started = Date.now();

  try {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GROQ_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const incoming = await req.formData();
    const audio = incoming.get("audio");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Audio file is required." },
        { status: 400 }
      );
    }

    if (audio.size === 0) {
      return NextResponse.json(
        { error: "Audio file is empty." },
        { status: 400 }
      );
    }

    const form = new FormData();
    form.append("file", audio, audio.name || "vita.webm");
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "en");
    form.append("response_format", "text");
    form.append("temperature", "0");
    form.append(
      "prompt",
      [
        "VITA personal AI assistant.",
        "Indian English conversation.",
        "Health and fitness vocabulary.",
        "steps, walking, running, workout, calories,",
        "distance, cadence, heart rate, activity.",
        "Preserve numbers exactly.",
        "Return only the spoken transcript.",
      ].join(" ")
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response: Response;

    try {
      response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();

    console.log(`[VITA] Whisper: ${Date.now() - started}ms`);

    if (!response.ok) {
      console.error("[VITA WHISPER ERROR]", text);

      return NextResponse.json(
        { error: text || "Groq transcription failed." },
        { status: response.status }
      );
    }

    return NextResponse.json({ text: text.trim() });
  } catch (error: any) {
    const message =
      error?.name === "AbortError"
        ? "Groq transcription timed out after 15 seconds."
        : error?.message || "VITA transcription failed.";

    console.error("[VITA TRANSCRIBE ERROR]", error);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
