import Groq, { toFile } from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
    timeout: 30000,         // ← ADD THIS — default is too short
});

export async function POST(req: NextRequest) {
    const started = Date.now();

    try {
        if (!process.env.GROQ_API_KEY) {
            return NextResponse.json(
                { error: "GROQ_API_KEY is not configured." },
                { status: 500 }
            );
        }

        const formData = await req.formData();
        const audio = formData.get("audio");

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

        const arrayBuffer = await audio.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const file = await toFile(
            buffer,
            audio.name || "vita-voice.webm",
            {
                type: audio.type || "audio/webm",
            }
        );

        const transcription = await groq.audio.transcriptions.create({
            file,
            model: "whisper-large-v3-turbo",
            language: "en",
            response_format: "json",
            temperature: 0,
            prompt:
                "This is a conversation with VITA, a personal AI health and fitness assistant. " +
                "Preserve names, numbers, fitness terms, step counts, activity terms, and commands.",
        });

        console.log(`[VITA] Whisper transcription: ${Date.now() - started}ms`);

        return NextResponse.json({
            text: transcription.text?.trim() || "",
        });
    } catch (error: any) {
        console.error("[VITA TRANSCRIBE ERROR]", error);

        return NextResponse.json(
            {
                error:
                    error?.message || "VITA transcription failed.",
            },
            { status: 500 }
        );
    }
}
