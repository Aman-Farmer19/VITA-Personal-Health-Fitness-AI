# VITA — System Architecture

## High-Level

```mermaid
flowchart TD
    UI["VITA Next.js UI"]

    VOICE["Voice Input"]
    PHONE["Phone Sensor Module"]
    CAM["Camera / Mood"]

    STT["Live Speech Transcription"]
    WS["Custom VITA WebSocket Server"]
    STATE["Live VITA Application State"]

    ROUTER["Intent Router"]
    GEMINI["Gemini Agent"]
    TOOLS["Controlled Tools"]

    TTS["ElevenLabs TTS"]
    AUDIO["Browser Audio Playback"]

    UI --> VOICE
    UI --> CAM
    PHONE --> WS
    WS --> STATE

    VOICE --> STT
    STT --> ROUTER
    STATE --> ROUTER

    ROUTER --> GEMINI
    GEMINI --> TOOLS
    TOOLS --> STATE

    GEMINI --> TTS
    TTS --> AUDIO
    AUDIO --> UI

    STATE --> UI

## Voice Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant B as Browser
    participant S as Live STT
    participant A as /api/agent
    participant G as Gemini
    participant T as ElevenLabs

    U->>B: "Hello Vita"
    B->>B: Activate session
    B->>T: Request greeting audio
    T-->>B: Audio
    B->>S: Open live transcription
    U->>B: Voice question
    B->>S: PCM audio stream
    S-->>B: Interim transcript
    S-->>B: Final transcript
    B->>A: User text + VITA state
    A->>G: Route / reason / call tools
    G-->>A: Verified answer
    A-->>B: Answer
    B->>T: Request neural TTS
    T-->>B: Audio
    B->>U: Spoken answer
    B->>S: Start next turn
```
