# 🔮 VITA — Personal Health & Fitness AI

> A real-time AI health and fitness companion with voice interaction, activity tracking, facial-expression awareness, and a reactive 3D holographic interface.

VITA is designed as a futuristic personal AI companion: speak naturally, receive an AI response, track activity from a connected phone, and watch the orb react to voice, movement, and mood.
<p align="center">
  <img src="screenshots/vita-dashboard.png" alt="VITA Personal Health & Fitness AI" width="100%">
</p>


## ✨ What VITA Does

- 🎙️ **Voice interaction** — record speech directly from the browser and send it through the VITA voice pipeline.
- 📝 **Whisper transcription** — Groq Whisper converts recorded speech into text before the AI agent processes it.
- 🧠 **AI agent** — Groq-powered VITA responses using `qwen/qwen3.6-27b` with a fast conversational configuration.
- 🔊 **Voice responses** — VITA speaks back through the browser's Speech Synthesis API with a preferred female English voice when available.
- 🌀 **Reactive 3D orb** — Three.js visualization with bloom, orbital elements, activity-aware motion, and voice-reactive animation.
- 📱 **Phone activity tracking** — a companion `/phone` page reads device motion data and streams activity to the laptop over WebSockets.
- 👟 **Step tracking** — detects steps, cadence, distance, calories, and IDLE/WALKING/RUNNING activity.
- 📷 **Facial-expression awareness** — optional webcam mode uses `face-api.js` for expression detection and maps the dominant expression to VITA's mood display.
- 📊 **Live health HUD** — steps, distance, calories, cadence, activity, mood, stress indicator, connection state, and voice status are shown directly on the interface.

## 🧠 Architecture

```text
                       ┌───────────────────────┐
                       │       VITA ORB         │
                       │      Three.js HUD      │
                       └───────────┬───────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  │                │                │
                  ▼                ▼                ▼
             🎙 Voice          📱 Phone         📷 Camera
                  │                │                │
                  ▼                ▼                ▼
           MediaRecorder       WebSocket       face-api.js
                  │                │                │
                  ▼                ▼                ▼
          /api/transcribe     StepData         Mood state
                  │
                  ▼
        Groq Whisper transcription
                  │
                  ▼
             /api/agent
                  │
                  ▼
          Groq Qwen 3.6 27B
                  │
                  ▼
          Browser Speech Synthesis
                  │
                  ▼
             🔊 VITA SPEAKS
```

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/Aman-Farmer19/VITA-Personal-Health-Fitness-AI.git
cd VITA-Personal-Health-Fitness-AI
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env.local` file in the project root:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=qwen/qwen3.6-27b
```

Never commit `.env.local` or expose your API key in client-side code.

### 4. Start VITA

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

### 5. Connect a phone

Open the phone companion page from the same Wi-Fi network:

```text
http://<YOUR-LAPTOP-IP>:3000/phone
```

Both devices should be connected to the same local network.

## 🎮 How to Use VITA

### 🎙️ Voice

Click **VOICE**, speak naturally, and stop speaking. VITA detects the end of the utterance, sends the recording for transcription, passes the resulting text to the AI agent, and speaks the response back.
## 🎙️ Voice Interaction

<p align="center">
  <img src="screenshots/vita-voice.png" alt="VITA voice interaction" width="100%">
</p>

The voice pipeline is:

```text
Voice → MediaRecorder → Whisper → Groq Agent → Speech Synthesis
```

### 📷 Camera

Click **CAM** to enable the webcam. VITA uses facial-expression detection to update its visible mood state and react visually through the orb.

### 👟 Steps

You can track activity locally or use the phone companion:

```text
Phone sensors → WebSocket → Laptop → VITA HUD
```
## 👟 Real-Time Activity Tracking

<p align="center">
  <img src="screenshots/vita-steps.png" alt="VITA activity tracking" width="100%">
</p>
VITA tracks:

- Steps
- Cadence
- Distance
- Calories
- Activity classification

The local step detector uses accelerometer peak detection with smoothing and debouncing.

## 🗂️ Project Structure

```text
vita-app/
├── public/
│   └── manifest.json
│
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── agent/
│   │   │   │   └── route.ts       # Groq AI agent
│   │   │   ├── transcribe/
│   │   │   │   └── route.ts       # Groq Whisper transcription
│   │   │   └── local-ip/
│   │   │       └── route.ts       # Local network IP helper
│   │   ├── phone/
│   │   │   └── page.tsx           # Phone sensor companion
│   │   ├── globals.css             # HUD styling
│   │   ├── layout.tsx
│   │   └── page.tsx               # Main VITA page
│   │
│   ├── components/
│   │   └── VitaOrb.tsx             # Main VITA UI + Three.js experience
│   │
│   └── lib/
│       ├── stepDetector.ts         # Accelerometer step detection
│       └── Vitastate.ts             # Shared VITA state types
│
├── server.js                        # Custom Next.js + WebSocket server
├── next.config.js
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── README.md
└── .gitignore
```

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, React, TypeScript |
| 3D UI | Three.js, post-processing / bloom |
| Voice capture | MediaRecorder, Web Audio API |
| Speech-to-text | Groq Whisper `whisper-large-v3-turbo` |
| AI agent | Groq `qwen/qwen3.6-27b` |
| Text-to-speech | Browser Speech Synthesis API |
| Motion tracking | DeviceMotion / accelerometer |
| Computer vision | face-api.js |
| Realtime transport | WebSocket |
| Styling | Tailwind CSS + custom HUD CSS |

## 🔐 Privacy & Secrets

- API credentials belong in `.env.local`, not in the repository.
- Raw microphone recordings are handled as transient data for transcription by the app rather than written into the project as permanent files.
- Health/activity state is passed to the agent as request context when needed for a response.
- Persistent long-term memory is intentionally not part of the current implementation.

## 🗺️ Roadmap

### ✅ Implemented

- [x] Interactive Three.js holographic orb
- [x] Reactive bloom and voice animation
- [x] Browser microphone capture
- [x] Automatic end-of-speech detection
- [x] Groq Whisper transcription
- [x] Groq AI agent
- [x] Browser text-to-speech responses
- [x] Phone-to-laptop WebSocket connection
- [x] Step/cadence/activity tracking
- [x] Facial-expression detection
- [x] Live health HUD

### 🔭 Next

- [ ] Tool calling for direct VITA actions
- [ ] Selective long-term memory for meaningful user preferences
- [ ] Heart-rate integration
- [ ] Sleep tracking
- [ ] Hand-gesture control
- [ ] More robust voice activity detection and interruption handling
- [ ] Production deployment and mobile-friendly packaging

## ⚠️ Development Notes

VITA is a personal engineering project and should not be treated as a medical diagnostic system. Sensor-derived values and facial-expression classifications are contextual signals, not medical diagnoses.

## 👨‍💻 Author

**Aman Tiwari**

Built as an exploration of real-time AI assistants, multimodal interaction, health/fitness interfaces, and futuristic UI engineering.

---

⭐ If you find the project interesting, consider starring the repository.
