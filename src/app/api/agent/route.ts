import Groq from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";
import { executeVitaTool, type VitaState } from "@/lib/vitaTools";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_activity",
      description: "Read VITA's current activity and fitness metrics.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_current_state",
      description: "Read VITA's current sensor, expression, and device state.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_workout",
      description: "Create a short workout plan using the user's current activity state.",
      parameters: {
        type: "object",
        properties: {
          durationMinutes: { type: "number", description: "Workout duration in minutes." },
          intensity: { type: "string", enum: ["easy", "moderate", "hard"] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "estimate_goal_gap",
      description: "Calculate the user's remaining steps toward a daily step target.",
      parameters: {
        type: "object",
        properties: {
          targetSteps: { type: "number", description: "Target number of steps." },
        },
        additionalProperties: false,
      },
    },
  },
];

const SYSTEM_PROMPT = `
You are VITA, a personal AI health and fitness agent.

Personality:
- calm
- intelligent
- concise
- supportive
- practical

You have access to tools that let you inspect live VITA state and perform bounded fitness-planning calculations.

Agent rules:
- Decide when a tool is useful before answering.
- If the user asks about current steps, activity, device state, or fitness metrics, use the appropriate tool instead of guessing from memory.
- If a workout is requested, use create_workout.
- If the user asks how far they are from a step target, use estimate_goal_gap.
- You may call more than one tool when necessary.
- After observing tool results, reason over them and produce one concise final answer.
- Never claim that a tool performed an action it did not perform.
- Never invent sensor readings.
- null means the sensor is unavailable.
- Facial expressions are observations, not proof of emotion, stress, or a medical condition.
- Never diagnose medical conditions.
- Prefer concrete numbers when available.
- Keep normal responses under 60 words.
`;

export async function POST(req: NextRequest) {
  const started = Date.now();

  try {
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY is not configured." },
        { status: 500 },
      );
    }

    const body = await req.json();
    const message = String(body.message ?? "").trim();
    const vitaState = (body.vitaState ?? {}) as VitaState;

    if (!message) {
      return NextResponse.json(
        { error: "Message is required." },
        { status: 400 },
      );
    }

    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `User request:\n${message}\n\nCurrent VITA state:\n${JSON.stringify(vitaState)}`,
      },
    ];

    const toolsUsed: string[] = [];

    // Bounded agent loop: tool calls are deliberate and capped so VITA
    // remains fast and predictable rather than becoming an uncontrolled loop.
    for (let round = 0; round < 3; round += 1) {
      const completion = await groq.chat.completions.create({
        model: process.env.GROQ_MODEL || "qwen/qwen3.6-27b",
        reasoning_effort: "none",
        temperature: 0.4,
        max_completion_tokens: 120,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      });

      const choice = completion.choices[0];
      const assistant = choice?.message;

      if (!assistant) {
        throw new Error("Groq returned an empty agent response.");
      }

      if (!assistant.tool_calls?.length) {
        const answer = assistant.content?.trim();

        if (!answer) {
          throw new Error("VITA produced an empty response.");
        }

        console.log(`[VITA] Agent completed in ${Date.now() - started}ms`);

        return NextResponse.json({
          answer,
          model: completion.model,
          toolsUsed,
        });
      }

      messages.push(assistant);

      for (const call of assistant.tool_calls) {
        const name = call.function.name;
        let args: Record<string, unknown> = {};

        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        const result = executeVitaTool(name, args, vitaState);
        toolsUsed.push(name);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    throw new Error("VITA reached the maximum tool-call rounds.");
  } catch (error: any) {
    console.error("[VITA AGENT ERROR]", error);

    return NextResponse.json(
      {
        error:
          error?.message ||
          "VITA could not process the request.",
      },
      { status: 500 },
    );
  }
}
