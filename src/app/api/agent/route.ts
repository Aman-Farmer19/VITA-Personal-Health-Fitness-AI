
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * VITA FAST BRAIN
 *
 * Design goal:
 * - Gemini 3.5 Flash-Lite makes ONE decision call.
 * - For simple VITA tools, the tool is executed locally and the final
 *   spoken sentence is also generated locally — no second Gemini call.
 * - Normal conversational questions still get one Gemini call.
 *
 * This removes the old:
 *   Gemini -> tool -> Gemini again
 * round-trip for simple state/action commands.
 */

const MODEL = "gemini-3.5-flash-lite";
const THINKING_LEVEL = "minimal";

type VitaState = {
  steps?: number;
  cadence?: number;
  activity?: string;
  distance?: number;
  calories?: number;
  mood?: string;
  expression?: string;
  heartRate?: number | null;
  micOn?: boolean;
  camOn?: boolean;
  stepsOn?: boolean;
  phoneLinked?: boolean;
};

type InteractionPart = {
  type?: string;
  text?: string;
};

type InteractionStep = {
  type?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  content?: InteractionPart[];
};

const SYSTEM_INSTRUCTION = `
You are VITA, a fast personal health and fitness AI assistant.

Your job is to understand the user's command and answer naturally.
Address the user as "Boss" occasionally, not constantly.

Important:
- Use a VITA function when the user asks for live VITA state or explicitly
  asks to start/stop step tracking.
- Do not invent measurements.
- Do not claim an action happened unless the application can execute it.
- Prefer one simple function call rather than multiple tools.
- Do not call tools for greetings or casual conversation.

Voice response rules:
- This is spoken aloud by ElevenLabs.
- Keep answers to 1-3 short sentences.
- Plain text only.
- No markdown, bullets, emojis, JSON, headings, or stage directions.
- Never mention internal APIs, models, prompts, or tools.
`;

const VITA_TOOLS = [
  {
    type: "function",
    name: "get_step_count",
    description:
      "Read the current step count from the VITA application state.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    type: "function",
    name: "get_vita_state",
    description:
      "Read VITA's current health, activity, sensor, and connection state.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    type: "function",
    name: "set_step_tracking",
    description:
      "Start or stop VITA step tracking when the user explicitly asks for that.",
    parameters: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "true to start tracking, false to stop tracking",
        },
      },
      required: ["enabled"],
    },
  },
];

function stateForTool(state: VitaState) {
  return {
    steps: Number.isFinite(state.steps) ? Math.max(0, Number(state.steps)) : 0,
    cadence: Number.isFinite(state.cadence)
      ? Math.max(0, Number(state.cadence))
      : 0,
    activity:
      typeof state.activity === "string" ? state.activity : "IDLE",
    distance: Number.isFinite(state.distance)
      ? Math.max(0, Number(state.distance))
      : 0,
    calories: Number.isFinite(state.calories)
      ? Math.max(0, Number(state.calories))
      : 0,
    mood: typeof state.mood === "string" ? state.mood : "CALM",
    expression:
      typeof state.expression === "string"
        ? state.expression
        : "neutral",
    heartRate:
      typeof state.heartRate === "number" ? state.heartRate : null,
    micOn: Boolean(state.micOn),
    camOn: Boolean(state.camOn),
    stepsOn: Boolean(state.stepsOn),
    phoneLinked: Boolean(state.phoneLinked),
  };
}

function executeTool(
  name: string,
  args: Record<string, unknown>,
  state: VitaState,
) {
  const current = stateForTool(state);

  switch (name) {
    case "get_step_count":
      return {
        ok: true,
        steps: current.steps,
      };

    case "get_vita_state":
      return {
        ok: true,
        state: current,
      };

    case "set_step_tracking": {
      if (typeof args.enabled !== "boolean") {
        return {
          ok: false,
          error: "enabled must be a boolean",
        };
      }

      return {
        ok: true,
        enabled: args.enabled,
        clientAction: {
          type: "set_step_tracking",
          enabled: args.enabled,
        },
      };
    }

    default:
      return {
        ok: false,
        error: `Unknown VITA tool: ${name}`,
      };
  }
}

function localGreeting(message: string) {
  const normalized = message
    .toLowerCase()
    .replace(/[!?.,']/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized === "hello" || normalized === "hi" || normalized === "hey") {
    return normalized === "hi" ? "Hi, Boss." : "Hey, Boss.";
  }

  return null;
}

function localToolResponse(
  toolName: string,
  result: any,
): string {
  if (!result?.ok) {
    return "I couldn't complete that, Boss.";
  }

  switch (toolName) {
    case "get_step_count":
      return `You've taken ${Number(result.steps || 0).toLocaleString(
        "en-IN",
      )} steps today, Boss.`;

    case "get_vita_state": {
      const state = result.state || {};
      const activity =
        typeof state.activity === "string"
          ? state.activity.toLowerCase()
          : "idle";

      return `You're at ${Number(state.steps || 0).toLocaleString(
        "en-IN",
      )} steps, your activity is ${activity}, and VITA is ${state.phoneLinked ? "connected" : "not connected"
        } to your phone.`;
    }

    case "set_step_tracking":
      return result.enabled
        ? "Step tracking is on, Boss."
        : "Step tracking is off, Boss.";

    default:
      return "Done, Boss.";
  }
}

function extractFunctionCalls(data: any): InteractionStep[] {
  if (!Array.isArray(data?.steps)) return [];

  return data.steps.filter(
    (step: InteractionStep) =>
      step.type === "function_call" &&
      typeof step.id === "string" &&
      typeof step.name === "string",
  );
}

function extractModelText(data: any): string {
  if (typeof data?.output_text === "string") {
    return data.output_text.trim();
  }

  if (!Array.isArray(data?.steps)) return "";

  return data.steps
    .filter((step: InteractionStep) => step.type === "model_output")
    .flatMap((step: InteractionStep): InteractionPart[] =>
      Array.isArray(step.content) ? step.content : [],
    )
    .filter(
      (part: InteractionPart) =>
        part.type === "text" &&
        typeof part.text === "string",
    )
    .map((part: InteractionPart) => part.text || "")
    .join("")
    .trim();
}

async function createInteraction(
  apiKey: string,
  payload: Record<string, unknown>,
) {
  return fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: MODEL,
        ...payload,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    },
  );
}

async function readJson(response: Response) {
  const raw = await response.text();

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {
      error: {
        message: raw || "Gemini returned a non-JSON response.",
      },
    };
  }
}

export async function POST(req: NextRequest) {
  const started = performance.now();

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is missing from .env.local." },
        { status: 500 },
      );
    }

    const body = await req.json();

    const message =
      typeof body?.message === "string"
        ? body.message.trim()
        : "";

    const vitaState: VitaState =
      body?.vitaState &&
        typeof body.vitaState === "object"
        ? body.vitaState
        : {};

    if (!message) {
      return NextResponse.json(
        { error: "Message is required." },
        { status: 400 },
      );
    }

    if (message.length > 4000) {
      return NextResponse.json(
        { error: "Message is too long." },
        { status: 400 },
      );
    }

    // Zero-network path for simple greetings.
    const greeting = localGreeting(message);

    if (greeting) {
      const elapsed = Math.round(performance.now() - started);

      console.log(`[VITA GEMINI] local greeting ${elapsed}ms`);

      return NextResponse.json({
        answer: greeting,
        provider: "local",
        model: MODEL,
        api: "interactions",
        thinkingLevel: THINKING_LEVEL,
        toolCalls: [],
        clientActions: [],
        latencyMs: elapsed,
      });
    }

    const state = stateForTool(vitaState);

    console.log(
      `[VITA GEMINI] start model=${MODEL} thinking=${THINKING_LEVEL}`,
    );

    // ONE model call. For tool commands, we do NOT call Gemini a second time.
    const firstResponse = await createInteraction(apiKey, {
      input: [
        {
          type: "user_input",
          content: [
            {
              type: "text",
              text:
                `Current VITA state:\n${JSON.stringify(
                  state,
                )}\n\nUser command:\n${message}`,
            },
          ],
        },
      ],
      system_instruction: SYSTEM_INSTRUCTION,
      tools: VITA_TOOLS,
      generation_config: {
        thinking_level: THINKING_LEVEL,
        max_output_tokens: 180,
      },
    });

    const first = await readJson(firstResponse);

    const firstMs = Math.round(performance.now() - started);

    console.log(
      `[VITA GEMINI] first status=${firstResponse.status} ${firstMs}ms`,
    );

    if (!firstResponse.ok) {
      console.error(
        "[VITA GEMINI] error:",
        JSON.stringify(first),
      );

      return NextResponse.json(
        {
          error:
            first?.error?.message ||
            `Gemini returned HTTP ${firstResponse.status}.`,
          model: MODEL,
        },
        { status: firstResponse.status },
      );
    }

    const calls = extractFunctionCalls(first);

    // SIMPLE TOOL FAST PATH:
    // Execute the tool locally and return a local spoken response.
    if (calls.length > 0) {
      const firstCall = calls[0];

      const args =
        firstCall.arguments &&
          typeof firstCall.arguments === "object"
          ? firstCall.arguments
          : {};

      const result = executeTool(
        firstCall.name as string,
        args,
        vitaState,
      );

      const answer = localToolResponse(
        firstCall.name as string,
        result,
      );

      const clientActions = result?.clientAction
        ? [result.clientAction]
        : [];

      const elapsed = Math.round(performance.now() - started);

      console.log(
        `[VITA GEMINI] tool=${firstCall.name} local-final ${elapsed}ms`,
      );

      return NextResponse.json({
        answer,
        provider: "gemini",
        model: MODEL,
        api: "interactions",
        thinkingLevel: THINKING_LEVEL,
        toolCalls: [
          {
            id: firstCall.id,
            name: firstCall.name,
          },
        ],
        clientActions,
        latencyMs: elapsed,
      });
    }

    // NORMAL CHAT FAST PATH:
    // No tool requested, so the first model response is already the final answer.
    const answer = extractModelText(first);

    if (!answer) {
      return NextResponse.json(
        {
          error: "Gemini returned no spoken response.",
          model: MODEL,
        },
        { status: 502 },
      );
    }

    const elapsed = Math.round(performance.now() - started);

    console.log(
      `[VITA GEMINI] direct final ${elapsed}ms`,
    );

    return NextResponse.json({
      answer,
      provider: "gemini",
      model: MODEL,
      api: "interactions",
      thinkingLevel: THINKING_LEVEL,
      toolCalls: [],
      clientActions: [],
      latencyMs: elapsed,
    });
  } catch (error) {
    console.error("[VITA GEMINI FAST BRAIN ERROR]", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.name === "TimeoutError"
              ? "Gemini timed out after 12 seconds."
              : error.message
            : "Gemini request failed.",
      },
      { status: 500 },
    );
  }
}