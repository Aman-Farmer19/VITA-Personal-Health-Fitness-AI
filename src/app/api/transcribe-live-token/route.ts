import { NextResponse } from "next/server";
import {
    AudioTranscriptionConfigMode,
    GoogleGenAI,
    Modality,
} from "@google/genai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_TRANSCRIBE_MODEL = "gemini-3.5-transcribe-live";

const CUSTOM_VOCABULARY = [
    "VITA",
    "Vita",
    "Boss",
    "step count",
    "steps",
    "step tracking",
    "heart rate",
    "calories",
    "cadence",
    "distance",
    "workout",
    "fitness",
    "health",
    "exercise",
    "running",
    "walking",
    "activity",
    "camera",
    "phone",
    "Gemini",
    "ElevenLabs",
    "Transcribe",
];

export async function GET() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return NextResponse.json(
            { error: "GEMINI_API_KEY is missing from .env.local." },
            { status: 500 },
        );
    }

    try {
        const client = new GoogleGenAI({ apiKey });
        const now = new Date();
        const expireTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
        const newSessionExpireTime = new Date(
            now.getTime() + 60 * 1000,
        ).toISOString();

        const token = await client.authTokens.create({
            config: {
                uses: 1,
                expireTime,
                newSessionExpireTime,
                liveConnectConstraints: {
                    model: LIVE_TRANSCRIBE_MODEL,
                    config: {
                        responseModalities: [Modality.TEXT],
                        inputAudioTranscription: {
                            languageCodes: [],
                            customVocabulary: CUSTOM_VOCABULARY,
                            mode: AudioTranscriptionConfigMode.VERBATIM,
                        },
                    },
                },
            },
        });

        const accessToken = typeof token?.name === "string" ? token.name : "";

        if (!accessToken) {
            return NextResponse.json(
                { error: "Gemini did not return an ephemeral token name." },
                { status: 502 },
            );
        }

        return NextResponse.json({
            model: LIVE_TRANSCRIBE_MODEL,
            accessToken,
            wsUrl:
                `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(accessToken)}`,
            expiresAt: expireTime,
            newSessionExpiresAt: newSessionExpireTime,
        });
    } catch (error) {
        console.error("[VITA LIVE TOKEN]", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to create a Gemini live transcription token.",
            },
            { status: 500 },
        );
    }
}
