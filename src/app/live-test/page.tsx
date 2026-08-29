
"use client";
import { useEffect, useRef, useState } from "react";

const MODEL = "gemini-3.5-transcribe-live";

function float32ToBase64Pcm16(input: Float32Array): string {
    const pcm = new Int16Array(input.length);

    for (let i = 0; i < input.length; i += 1) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    const bytes = new Uint8Array(pcm.buffer);
    let binary = "";

    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += Array.from(chunk, (byte) => String.fromCharCode(byte)).join("");
    }

    return btoa(binary);
}

function downsampleTo16k(
    input: Float32Array,
    inputSampleRate: number,
): Float32Array {
    if (inputSampleRate === 16000) return input;

    const ratio = inputSampleRate / 16000;
    const outputLength = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(outputLength);

    let offset = 0;

    for (let i = 0; i < outputLength; i += 1) {
        const nextOffset = Math.min(
            input.length,
            Math.round((i + 1) * ratio),
        );

        let sum = 0;
        let count = 0;

        for (let j = offset; j < nextOffset; j += 1) {
            sum += input[j];
            count += 1;
        }

        output[i] = count ? sum / count : input[Math.min(offset, input.length - 1)] || 0;
        offset = nextOffset;
    }

    return output;
}

export default function LiveTranscribeTestPage() {
    const wsRef = useRef<WebSocket | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const runningRef = useRef(false);
    const setupCompleteRef = useRef(false);

    const [status, setStatus] = useState("IDLE");
    const [interim, setInterim] = useState("");
    const [finalText, setFinalText] = useState("");
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState("");

    useEffect(() => {
        return () => {
            runningRef.current = false;
            processorRef.current?.disconnect();
            sourceRef.current?.disconnect();
            streamRef.current?.getTracks().forEach((t) => t.stop());
            void audioContextRef.current?.close();
            wsRef.current?.close();
        };
    }, []);

    async function stopTest() {
        runningRef.current = false;
        setupCompleteRef.current = false;

        try {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(
                    JSON.stringify({
                        realtimeInput: {
                            audioStreamEnd: true,
                        },
                    }),
                );
            }
        } catch { }

        processorRef.current?.disconnect();
        sourceRef.current?.disconnect();

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        await audioContextRef.current?.close().catch(() => undefined);
        audioContextRef.current = null;

        wsRef.current?.close();
        wsRef.current = null;

        setStatus("STOPPED");
    }

    async function startTest() {
        if (runningRef.current) return;

        setError("");
        setInterim("");
        setFinalText("");
        setElapsed(0);

        try {
            setStatus("GETTING TOKEN...");

            const tokenResponse = await fetch(
                "/api/transcribe-live-token",
                { cache: "no-store" },
            );

            const tokenData = await tokenResponse.json();

            if (!tokenResponse.ok) {
                throw new Error(
                    tokenData?.error || "Failed to obtain ephemeral token.",
                );
            }

            const accessToken = tokenData?.accessToken;
            const wsUrl = tokenData?.wsUrl;

            if (!accessToken || !wsUrl) {
                throw new Error("Token response is missing accessToken/wsUrl.");
            }

            console.log("[VITA LIVE STT] token acquired");
            setStatus("CONNECTING...");

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = async () => {
                console.log("[VITA LIVE STT] websocket connected");

                /*
                 * The token is constrained server-side to the Live Transcribe model.
                 * We still send the required first setup message. Google's WebSocket
                 * contract requires setup first and recommends waiting for setup
                 * completion before sending audio.
                 */
                ws.send(
                    JSON.stringify({
                        setup: {
                            model: `models/${MODEL}`,
                            generationConfig: {
                                responseModalities: ["TEXT"],
                            },
                            inputAudioTranscription: {
                                languageCodes: ["en-IN"],
                                mode: "VERBATIM",
                                customVocabulary: [
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
                                ],
                            },
                        },
                    }),
                );

                setStatus("WAITING FOR SETUP...");
            };

            ws.onmessage = async (event) => {
                let message: any;

                try {
                    message =
                        typeof event.data === "string"
                            ? JSON.parse(event.data)
                            : JSON.parse(await new Response(event.data).text());
                } catch {
                    console.warn("[VITA LIVE STT] non-JSON message");
                    return;
                }

                console.log("[VITA LIVE STT] message", message);

                if (message?.setupComplete) {
                    setupCompleteRef.current = true;
                    setStatus("LISTENING");
                    console.log("[VITA LIVE STT] setup complete");
                    return;
                }

                const content = message?.serverContent;

                if (content?.interimInputTranscription?.text) {
                    const text = content.interimInputTranscription.text;
                    setInterim(text);
                    console.log("[VITA LIVE STT] interim:", text);
                }

                if (content?.inputTranscription?.text) {
                    const text = content.inputTranscription.text.trim();
                    setFinalText((prev) => `${prev} ${text}`.trim());
                    setInterim("");
                    console.log("[VITA LIVE STT] final:", text);
                }

                if (content?.turnComplete) {
                    console.log("[VITA LIVE STT] turn complete");
                }

                if (message?.error) {
                    const messageText =
                        message.error?.message || "Gemini Live STT error.";
                    setError(messageText);
                    setStatus("ERROR");
                    console.error("[VITA LIVE STT] server error:", message.error);
                }
            };

            ws.onerror = (event) => {
                console.error("[VITA LIVE STT] websocket error", event);
                setError("WebSocket connection error.");
                setStatus("ERROR");
            };

            ws.onclose = (event) => {
                console.log(
                    "[VITA LIVE STT] websocket closed",
                    event.code,
                    event.reason,
                );
                setupCompleteRef.current = false;

                if (runningRef.current) {
                    setStatus("CLOSED");
                }
            };

            setStatus("REQUESTING MICROPHONE...");

            const mediaStream =
                await navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                });

            streamRef.current = mediaStream;

            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;

            await audioContext.resume();

            const source =
                audioContext.createMediaStreamSource(mediaStream);

            sourceRef.current = source;

            /*
             * ScriptProcessorNode is deprecated, but intentionally used here for
             * this isolated test because it is widely supported and keeps the
             * test self-contained. The production VITA path can move to an
             * AudioWorklet after this connection is proven.
             */
            const processor = audioContext.createScriptProcessor(
                4096,
                1,
                1,
            );

            processorRef.current = processor;

            processor.onaudioprocess = (event) => {
                if (
                    !runningRef.current ||
                    !setupCompleteRef.current ||
                    ws.readyState !== WebSocket.OPEN
                ) {
                    return;
                }

                const input = event.inputBuffer.getChannelData(0);
                const pcm16k = downsampleTo16k(
                    input,
                    audioContext.sampleRate,
                );

                const audioBase64 = float32ToBase64Pcm16(pcm16k);

                try {
                    ws.send(
                        JSON.stringify({
                            realtimeInput: {
                                audio: {
                                    data: audioBase64,
                                    mimeType: "audio/pcm;rate=16000",
                                },
                            },
                        }),
                    );
                } catch (sendError) {
                    console.error(
                        "[VITA LIVE STT] audio send failed",
                        sendError,
                    );
                }
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            runningRef.current = true;
            setStatus(
                setupCompleteRef.current
                    ? "LISTENING"
                    : "WAITING FOR SETUP...",
            );

            const startedAt = performance.now();

            const timer = window.setInterval(() => {
                if (!runningRef.current) {
                    window.clearInterval(timer);
                    return;
                }

                setElapsed(
                    Math.round(performance.now() - startedAt) / 1000,
                );
            }, 100);

            console.log("[VITA LIVE STT] microphone streaming");
        } catch (err) {
            console.error("[VITA LIVE STT] start failed", err);
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to start live transcription.",
            );
            await stopTest();
            setStatus("ERROR");
        }
    }

    return (
        <main
            style={{
                minHeight: "100vh",
                background: "#050510",
                color: "#00E5FF",
                fontFamily: "'Space Mono','Courier New',monospace",
                padding: 32,
            }}
        >
            <div style={{ maxWidth: 900, margin: "0 auto" }}>
                <div
                    style={{
                        fontSize: 13,
                        letterSpacing: 5,
                        color: "#7C3AED",
                        marginBottom: 10,
                    }}
                >
                    VITA LIVE TRANSCRIBE TEST
                </div>

                <h1
                    style={{
                        fontSize: 28,
                        letterSpacing: 3,
                        margin: "0 0 8px",
                    }}
                >
                    Gemini 3.5 Transcribe Live
                </h1>

                <div
                    style={{
                        color: "#777",
                        fontSize: 12,
                        marginBottom: 30,
                    }}
                >
                    Isolated microphone → WebSocket → realtime transcript
                </div>

                <div
                    style={{
                        border: "1px solid #1e2a44",
                        padding: 18,
                        marginBottom: 18,
                    }}
                >
                    <div style={{ fontSize: 11, color: "#7C3AED" }}>
                        STATUS
                    </div>
                    <div
                        style={{
                            fontSize: 20,
                            marginTop: 6,
                            color: status === "ERROR" ? "#FF8C00" : "#00E5FF",
                        }}
                    >
                        {status}
                    </div>

                    <div
                        style={{
                            marginTop: 8,
                            color: "#666",
                            fontSize: 11,
                        }}
                    >
                        Model: {MODEL}
                        {" · "}
                        {elapsed.toFixed(1)}s
                    </div>
                </div>

                <div
                    style={{
                        display: "grid",
                        gap: 18,
                        gridTemplateColumns: "1fr",
                    }}
                >
                    <section
                        style={{
                            border: "1px solid #1e2a44",
                            padding: 18,
                            minHeight: 130,
                        }}
                    >
                        <div
                            style={{
                                color: "#7C3AED",
                                fontSize: 10,
                                letterSpacing: 2,
                            }}
                        >
                            INTERIM
                        </div>
                        <div
                            style={{
                                marginTop: 12,
                                color: "#aaa",
                                fontSize: 17,
                                lineHeight: 1.6,
                            }}
                        >
                            {interim || "—"}
                        </div>
                    </section>

                    <section
                        style={{
                            border: "1px solid #1e2a44",
                            padding: 18,
                            minHeight: 150,
                        }}
                    >
                        <div
                            style={{
                                color: "#00FF88",
                                fontSize: 10,
                                letterSpacing: 2,
                            }}
                        >
                            FINAL
                        </div>
                        <div
                            style={{
                                marginTop: 12,
                                color: "#fff",
                                fontSize: 19,
                                lineHeight: 1.6,
                            }}
                        >
                            {finalText || "—"}
                        </div>
                    </section>

                    {error && (
                        <section
                            style={{
                                border: "1px solid #5b3420",
                                padding: 18,
                                color: "#FF8C00",
                                fontSize: 12,
                                lineHeight: 1.5,
                            }}
                        >
                            {error}
                        </section>
                    )}
                </div>

                <div
                    style={{
                        marginTop: 22,
                        display: "flex",
                        gap: 10,
                    }}
                >
                    <button
                        onClick={() => void startTest()}
                        disabled={runningRef.current}
                        style={{
                            cursor: "pointer",
                            padding: "12px 18px",
                            border: "1px solid #00E5FF",
                            background: "transparent",
                            color: "#00E5FF",
                            fontFamily: "inherit",
                        }}
                    >
                        START LIVE TEST
                    </button>

                    <button
                        onClick={() => void stopTest()}
                        style={{
                            cursor: "pointer",
                            padding: "12px 18px",
                            border: "1px solid #FF2D9A",
                            background: "transparent",
                            color: "#FF2D9A",
                            fontFamily: "inherit",
                        }}
                    >
                        STOP
                    </button>
                </div>
            </div>
        </main>
    );
}
