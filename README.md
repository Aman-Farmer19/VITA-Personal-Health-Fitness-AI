


🔮 VITA — Personal Health & Fitness AI
VITA is a voice-first personal health and fitness assistant designed as a real-time, state-aware application rather than a simple chatbot.

It combines conversational voice interaction, live fitness telemetry from a phone, tool-based AI actions, and an interactive Three.js visualization in a single Next.js application.

Current status: Core voice, AI, phone sensor, WebSocket, HTTPS/WSS, multi-turn session, and production-build flows have been tested successfully.

What VITA Does
VITA combines four main interaction layers:

🎙️ Voice: wake phrase → live speech transcription → AI response → neural TTS

📱 Phone telemetry: DeviceMotion-based step detection streamed to the laptop over WebSocket

📷 Camera/mood: face-api.js expression detection with a demo fallback when the camera/models are unavailable

🔮 Interactive HUD: Three.js orb and HUD react to voice amplitude, activity, steps, mood, and phone connection state

Core Architecture
                         ┌──────────────────────────┐
                         │        VITA UI            │
                         │      Next.js + React      │
                         └────────────┬─────────────┘
                                      │
             ┌────────────────────────┼────────────────────────┐
             │                        │                        │
             ▼                        ▼                        ▼
        🎙 Voice                  📱 Phone                 📷 Camera
             │                        │                        │
             │                 DeviceMotionEvent        face-api.js
             │                        │                        │
             │                  StepDetector             Mood state
             │                        │
             │                      WSS
             │                        │
             └───────────────┬────────┘
                             ▼
                    ┌──────────────────┐
                    │  VITA Application │
                    │      State       │
                    └────────┬─────────┘
                             │
                      ┌──────▼───────┐
                      │ Intent Router │
                      └──────┬───────┘
                             │
                    ┌────────▼─────────┐
                    │  Gemini Agent    │
                    │ + controlled     │
                    │   tools          │
                    └────────┬─────────┘
                             │
                 ┌───────────┴────────────┐
                 │                        │
          Live VITA state            Direct answer
                 │                        │
                 └───────────┬────────────┘
                             ▼
                     ElevenLabs TTS
                             │
                             ▼
                         🔊 Audio
Voice Pipeline
The laptop voice flow is designed as a multi-turn session:

Wake phrase
   ↓
Session activation
   ↓
Live STT token acquisition
   ↓
Gemini Live transcription WebSocket
   ↓
Interim transcription
   ↓
Local silence detection
   ↓
Final transcript
   ↓
/api/agent
   ↓
Intent routing
   ↓
Gemini + application tools
   ↓
Answer
   ↓
/api/speak
   ↓
ElevenLabs
   ↓
Audio playback
   ↓
Fresh STT turn
VITA keeps the conversation alive across turns and explicitly supports a voice STOP command.

The current implementation also handles browser audio restrictions by unlocking audio after a real user gesture, while preserving the wake-word workflow.

AI and Tool Architecture
VITA does not give the language model unrestricted control of the application.

The backend exposes controlled application tools such as:

Tool	Purpose
get_step_count	Read the current step count from live VITA state
get_vita_state	Read current fitness, activity, mood, sensor, and session state
set_step_tracking	Start or stop tracking when the user explicitly requests it
The backend instructions also distinguish live measurements from estimates and prevent the assistant from inventing unavailable health measurements.

This gives VITA an agent-style architecture:

User request
    ↓
Intent Router
    ↓
Gemini
    ↓
Tool decision
    ↓
Tool execution
    ↓
Verified application state
    ↓
Natural-language response
Phone Sensor Pipeline
The phone acts as a sensor client rather than running the entire application.

Android / iPhone browser
        ↓
/phone
        ↓
DeviceMotionEvent
        ↓
StepDetector
        ↓
steps / cadence / activity / distance / calories
        ↓
WebSocket (WSS)
        ↓
Laptop VITA
        ↓
HUD + AI state
The phone sends structured messages such as:

phone_ready

tracking_started

steps

tracking_stopped

The laptop receives the stream and updates its live VITA state.

Local HTTPS / WSS Architecture
Phone motion APIs require a secure browser context in the relevant deployment scenario. VITA therefore uses a local HTTPS server for LAN testing.

Development certificate setup uses mkcert.

Current demo endpoints:

Laptop:
https://localhost:3000

Phone:
https://<LAPTOP-LAN-IP>:3000/phone
The custom server.js:

Starts Next.js

Serves HTTPS using the local certificate

Listens on 0.0.0.0:3000

Hosts the /vita-ws WebSocket endpoint

Relays phone telemetry to connected laptop clients

For the current local demo, the laptop and phone must be reachable on the same local network/hotspot.

Project Structure
vita-app/
├── server.js
├── certs/
│   ├── vita-cert.pem
│   └── vita-key.pem
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── phone/
│   │   │   └── page.tsx
│   │   └── api/
│   │       ├── agent/
│   │       ├── local-ip/
│   │       ├── speak/
│   │       └── transcribe-live-token/
│   ├── components/
│   │   ├── VitaOrb.tsx
│   │   ├── VitaSessionController.tsx
│   │   └── VitaTtsVoiceLock.tsx
│   └── lib/
│       └── stepDetector.ts
├── public/
│   ├── manifest.json
│   ├── icon-192.png
│   ├── favicon.ico
│   ├── local-ip.json
│   └── vita-pcm-processor.js
├── .env.local
├── package.json
└── README.md
Setup
1. Install dependencies
npm install
2. Create local HTTPS certificates
Install mkcert on Windows and create a local certificate containing the laptop LAN IP, localhost, and 127.0.0.1.

Example:

mkcert -install
mkcert -key-file certs/vita-key.pem -cert-file certs/vita-cert.pem 192.168.162.202 localhost 127.0.0.1
Use your current LAN IP if it changes.

3. Configure environment variables
Create/update .env.local with the API credentials required by the configured VITA backend.

Do not commit secrets to Git.

Production Demo Run
The current reliable demo flow uses a production Next.js build behind the custom HTTPS server.

Build
Because the project can require additional Node heap during static generation on Windows:

$env:NODE_OPTIONS="--max-old-space-size=4096"
npm run build
Start VITA
$env:NODE_ENV="production"
node server.js
Then open:

https://localhost:3000
On the phone:

https://<LAPTOP-LAN-IP>:3000/phone
Demo Flow
A predictable mentor/interview demonstration:

1. Connect the phone
Open /phone and verify:

LINKED TO LAPTOP ✓
2. Start tracking
Tap:

👟 START TRACKING
Walk with the phone.

The laptop dashboard should update:

STEPS
CADENCE
ACTIVITY
DISTANCE
CALORIES
3. Start voice
Use the VITA voice control and say:

Hello Vita
Then demonstrate:

What is my step count today?
VITA reads the current application state through the tool layer and responds through neural TTS.

4. Demonstrate state awareness
Ask:

What is my current activity?
or:

What's your status now?
5. Demonstrate multi-turn voice
Ask a general fitness question such as:

Why is consistency important for fitness?
6. End the session naturally
Thanks, Vita, stop now.
or:

Vita, stop now.
VITA detects the STOP command and returns to the wake-listening state.

Feature Status
Capability	Status
Next.js application	✅
Interactive Three.js orb	✅
Wake phrase	✅
Browser audio unlock	✅
Live STT	✅
Interim/final transcription	✅
Silence-based turn completion	✅
Intent routing	✅
Gemini agent	✅
Controlled application tools	✅
ElevenLabs neural TTS	✅
Multi-turn voice session	✅
Voice STOP commands	✅
Phone DeviceMotion	✅
Step detection	✅
Phone → laptop WebSocket	✅
Local HTTPS	✅
Laptop WSS	✅
PWA manifest	✅
Production build	✅
Camera mood detection	✅
Mood fallback simulation	✅
Local step fallback simulation	✅
Implementation Notes
Audio
Browser autoplay policies can block audible playback until a user gesture has occurred. VITA therefore performs a best-effort browser audio unlock after a real interaction and also uses the explicit VOICE control as an unlock path.

Live speech
The application captures microphone audio, processes it through an AudioWorklet, converts it to 16 kHz PCM, and streams the resulting data to the configured Live Transcription service.

Voice turn control
VITA uses local silence detection and a safety duration limit to decide when an utterance has ended. Completed turns close the current Live STT stream and create a fresh stream for the next turn.

Phone telemetry
The phone client creates a WSS connection back to /vita-ws, then sends structured state messages. The laptop updates its dashboard and AI state from those messages.

Current Limitations
This is a local demonstration architecture, not a hardened internet-facing production deployment.

Important current limitations include:

The local HTTPS certificate must be trusted by the test device.

Laptop and phone must be able to reach each other on the local network/hotspot.

Browser microphone/autoplay permissions vary by browser and platform.

The displayed heart-rate value is currently a simulated UI value rather than a medical sensor measurement.

Camera mood detection depends on browser camera access and the face-api.js models; a fallback mode is available.

LLM and TTS latency depends on external service response time and network conditions.

Engineering Decisions
Why WebSockets?
Phone telemetry is event-driven and continuous. WebSockets avoid repeated polling requests and allow the laptop dashboard to react immediately when new step data arrives.

Why HTTPS locally?
Modern browsers restrict several device capabilities to secure contexts. The phone sensor workflow therefore uses a locally trusted HTTPS origin during LAN testing.

Why separate STT and application WebSockets?
The phone/laptop WSS channel carries VITA device telemetry and connection events.

The Live STT WebSocket is a separate connection dedicated to real-time transcription.

Keeping these responsibilities separate makes the voice pipeline independent from the phone telemetry channel.

Why controlled tools?
The agent should be able to read and change only explicitly supported application state. Tool execution also provides a verifiable source for live measurements and actions.

Interview Summary
A strong one-minute description:

VITA is a real-time personal health and fitness AI assistant built with Next.js and a custom HTTPS/WebSocket server. It combines live voice interaction, Gemini-based intent routing with controlled application tools, ElevenLabs neural TTS, and a phone sensor module using DeviceMotion and WebSockets. The phone streams fitness telemetry such as steps, cadence, activity, distance, and calories to the laptop, while the AI can query the live application state and respond conversationally.

The key engineering story is that VITA is not just an LLM wrapper. It is an integrated system combining real-time audio, AI agents/tools, device telemetry, WebSockets, secure browser APIs, application state, and interactive visualization.

Future Improvements
Potential next-stage improvements:

Persistent user accounts and cloud-backed fitness history

Database-backed longitudinal health state

Authentication and device pairing

Production WebSocket gateway with horizontal scaling

More robust observability and tracing

LLM evaluation and regression tests

Latency optimization and streaming responses

Wearable integrations for real heart-rate data

More advanced activity recognition

These are future engineering directions rather than requirements for the current mentor demo.

License
Private portfolio / demonstration project.

Built with persistence, debugging, and a lot of iteration. 🦇

By- The Farmer & Aspiring AI Engineer Aman Tiwari