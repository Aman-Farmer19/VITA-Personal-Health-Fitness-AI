
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRANSCRIBE_MODEL = "gemini-3.5-transcribe";

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

function cleanMimeType(value: string): string {
  const mime = value.toLowerCase().split(";")[0].trim();

  if (
    mime === "audio/webm" ||
    mime === "audio/ogg" ||
    mime === "audio/opus" ||
    mime === "audio/mpeg" ||
    mime === "audio/mp4" ||
    mime === "audio/wav"
  ) {
    return mime;
  }

  return "audio/webm";
}

async function uploadToGemini(
  apiKey: string,
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<{ uri: string; mimeType: string }> {
  const uploadBase =
    "https://generativelanguage.googleapis.com/upload/v1beta/files";

  // Step 1: initialize resumable upload.
  const startResponse = await fetch(
    `${uploadBase}?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: {
          display_name: `vita-voice-${Date.now()}`,
        },
      }),
      cache: "no-store",
    },
  );

  if (!startResponse.ok) {
    const detail = await startResponse.text();
    throw new Error(
      `Gemini Files upload initialization failed (${startResponse.status}): ${detail}`,
    );
  }

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");

  if (!uploadUrl) {
    throw new Error(
      "Gemini Files API did not return an upload URL.",
    );
  }

  // Step 2: upload the actual audio bytes and finalize.
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Type": mimeType,
    },
    body: bytes,
    cache: "no-store",
  });

  const uploadData = await uploadResponse.json();

  if (!uploadResponse.ok) {
    throw new Error(
      `Gemini Files upload failed (${uploadResponse.status}): ${JSON.stringify(
        uploadData,
      )}`,
    );
  }

  const uri = uploadData?.file?.uri;
  const returnedMime =
    uploadData?.file?.mimeType || uploadData?.file?.mime_type || mimeType;

  if (!uri) {
    throw new Error(
      `Gemini Files upload returned no file URI: ${JSON.stringify(
        uploadData,
      )}`,
    );
  }

  return {
    uri,
    mimeType: returnedMime,
  };
}

function extractInteractionText(data: any): string {
  // The raw REST Interactions response stores model text inside:
  // steps[].type === "model_output" -> content[].type === "text".
  if (Array.isArray(data?.steps)) {
    const text = data.steps
      .filter((step: any) => step?.type === "model_output")
      .flatMap((step: any) =>
        Array.isArray(step?.content) ? step.content : [],
      )
      .filter(
        (item: any) =>
          item?.type === "text" && typeof item?.text === "string",
      )
      .map((item: any) => item.text)
      .join("")
      .trim();

    if (text) return text;
  }

  // SDK convenience field (not normally present in raw REST responses).
  if (typeof data?.output_text === "string") {
    return data.output_text.trim();
  }

  // Defensive fallback for Generate Content-shaped responses.
  if (Array.isArray(data?.candidates)) {
    return (
      data.candidates[0]?.content?.parts
        ?.map((part: any) => part?.text || "")
        .join("")
        .trim() || ""
    );
  }

  return "";
}

function unusable(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length < 2) return true;

  return (
    normalized.includes("transcribe only the user's spoken words") ||
    normalized.includes("transcribe only the spoken words") ||
    normalized.includes("do not answer")
  );
}

export async function POST(req: NextRequest) {
  const started = Date.now();

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is missing from .env.local." },
        { status: 500 },
      );
    }

    const formData = await req.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Audio file is required." },
        { status: 400 },
      );
    }

    const bytes = await audio.arrayBuffer();

    if (bytes.byteLength === 0) {
      return NextResponse.json(
        { error: "Empty audio recording." },
        { status: 400 },
      );
    }

    // VITA clips are normally much smaller. Keep a safety ceiling.
    if (bytes.byteLength > 18 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Audio recording is too large." },
        { status: 413 },
      );
    }

    const mimeType = cleanMimeType(audio.type || "audio/webm");

    console.log(
      `[VITA STT] Uploading ${bytes.byteLength} bytes as ${mimeType}`,
    );

    const file = await uploadToGemini(
      apiKey,
      bytes,
      mimeType,
    );

    // The Transcribe docs use the Interactions API for dedicated transcription.
    const interactionResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model: TRANSCRIBE_MODEL,
          input: [
            {
              type: "audio",
              uri: file.uri,
              mime_type: file.mimeType,
            },
          ],
          generation_config: {
            transcription_config: {
              language_codes: ["en-IN"],
              custom_vocabulary: CUSTOM_VOCABULARY,
              mode: {
                type: "smart",
              },
            },
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
      },
    );

    const data = await interactionResponse.json();

    console.log(
      `[VITA STT] ${TRANSCRIBE_MODEL} ${interactionResponse.status} in ${Date.now() - started
      }ms`,
    );

    if (!interactionResponse.ok) {
      console.error(
        "[VITA STT] Interactions error:",
        JSON.stringify(data),
      );

      return NextResponse.json(
        {
          error:
            data?.error?.message ||
            `Gemini Transcribe returned HTTP ${interactionResponse.status}.`,
        },
        { status: interactionResponse.status },
      );
    }

    const text = extractInteractionText(data);

    if (!text) {
      console.warn(
        "[VITA STT] Gemini returned no text. Response shape:",
        JSON.stringify({
          status: data?.status,
          id: data?.id,
          stepTypes: Array.isArray(data?.steps)
            ? data.steps.map((step: any) => step?.type)
            : [],
        }),
      );
    }

    if (unusable(text)) {
      console.warn(
        "[VITA STT] Unusable/empty transcript:",
        text,
      );

      return NextResponse.json({
        text: "",
        provider: "gemini",
        model: TRANSCRIBE_MODEL,
        language: "en-IN",
        reason: "no_reliable_speech",
      });
    }

    console.log("[VITA STT] Gemini transcript:", text);

    return NextResponse.json({
      text,
      provider: "gemini",
      model: TRANSCRIBE_MODEL,
      language: "en-IN",
    });
  } catch (error) {
    console.error("[VITA STT ROUTE ERROR]", error);

    const message =
      error instanceof Error
        ? error.name === "TimeoutError"
          ? "Gemini transcription timed out after 25 seconds."
          : error.message
        : "Gemini transcription failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
