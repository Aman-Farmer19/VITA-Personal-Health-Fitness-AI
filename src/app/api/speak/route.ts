import { NextRequest, NextResponse } from "next/server";

const GROQ_TTS_URL =
  "https://api.groq.com/openai/v1/audio/speech";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GROQ_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const input = String(body?.text ?? "").trim();

    if (!input) {
      return NextResponse.json(
        { error: "Text is required." },
        { status: 400 }
      );
    }

    const text = input.slice(0, 200);

    const response = await fetch(GROQ_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "canopylabs/orpheus-v1-english",
        voice: "hannah",
        input: text,
        response_format: "wav",
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[VITA TTS ERROR]", errorText);

      return NextResponse.json(
        { error: errorText || "Groq TTS request failed." },
        { status: response.status }
      );
    }

    const audio = await response.arrayBuffer();

    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("[VITA SPEAK ERROR]", error);

    return NextResponse.json(
      {
        error:
          error?.message || "VITA speech generation failed.",
      },
      { status: 500 }
    );
  }
}
