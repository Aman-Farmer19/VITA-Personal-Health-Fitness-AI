import Groq from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

const SYSTEM_PROMPT = `
You are VITA, a personal AI health and fitness assistant.

Personality:
- calm
- intelligent
- concise
- supportive
- practical

You receive live context from VITA's sensors.

Rules:
- Never invent sensor readings.
- null means the sensor is unavailable.
- Facial expressions are observations, not proof of emotion, stress, or a medical condition.
- Never diagnose medical conditions.
- Use the supplied VITA state when answering.
- Prefer concrete numbers when available.
- Keep normal responses under 80 words.
`;

export async function POST(req: NextRequest) {
    const started = Date.now();

    try {
        if (!process.env.GROQ_API_KEY) {
            return NextResponse.json(
                { error: "GROQ_API_KEY is not configured." },
                { status: 500 }
            );
        }

        const body = await req.json();

        const message = String(body.message ?? "").trim();
        const vitaState = body.vitaState ?? {};

        if (!message) {
            return NextResponse.json(
                { error: "Message is required." },
                { status: 400 }
            );
        }

        const completion = await groq.chat.completions.create({
            model: process.env.GROQ_MODEL || "qwen/qwen3.6-27b",
            reasoning_effort: "none",
            temperature: 0.7,
            max_completion_tokens: 120,
            messages: [
                {
                    role: "system",
                    content: SYSTEM_PROMPT,
                },
                {
                    role: "user",
                    content: `User request:${message}Current VITA state:${JSON.stringify(vitaState, null, 2)}
          `,
                },
            ],
        });

        console.log(`[VITA] LLM response: ${Date.now() - started}ms`);

        const answer =
            completion.choices[0]?.message?.content?.trim();

        if (!answer) {
            throw new Error("Groq returned an empty response.");
        }

        return NextResponse.json({
            answer,
            model: completion.model,
        });
    } catch (error: any) {
        console.error("[VITA AGENT ERROR]", error);

        return NextResponse.json(
            {
                error:
                    error?.message ||
                    "VITA could not process the request.",
            },
            { status: 500 }
        );
    }
}