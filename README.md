# 🔮 VITA — Personal Health & Fitness AI

Your personal Iron Man-inspired AI assistant. A holographic orb that listens to your voice,
reads your facial expressions, and tracks your physical activity via your phone's sensors.

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Run VITA
```bash
npm run dev
```

You'll see this in your terminal:
```
  💻  Laptop  →  http://localhost:3000
  📱  Phone   →  http://192.168.x.x:3000/phone
```

### 3. Open on laptop
Go to `http://localhost:3000`

### 4. Open on phone
Open `http://[your-laptop-ip]:3000/phone` in Safari (iPhone) or Chrome (Android).

> ⚠️ Both devices must be on the **same WiFi network**

---

## 📱 How Phone Connection Works

```
📱 Phone                          💻 Laptop
────────────────                  ──────────────────
Open /phone page                  Open / page
                                  
Tap 👟 START TRACKING      ──────► WebSocket message
                                  VITA orb reacts:
DeviceMotion fires                - Steps update live
Accelerometer data sent           - Orb spins faster
                                  - Activity detected
```

The WebSocket server runs inside `server.js` and bridges messages between
your phone and laptop in real-time.

---

## 🎮 Features

### Phase 1 — Voice Activation
- Click **🎙 VOICE** and speak naturally
- Orb pulses and glows with your voice amplitude
- Real-time speech transcription on the HUD

### Phase 2 — Face Cam Mood Detection
- Click **📷 CAM** to enable webcam
- face-api.js reads your facial expression every 200ms
- Orb color shifts based on detected mood:
  - 😊 Happy → Green
  - 😐 Neutral → Cyan
  - 😡 Stressed → Red
  - 😮 Surprised → Gold

### Phase 3 — Step Tracking
- **Phone:** Open `/phone` → tap START TRACKING
- Steps stream live to your laptop via WebSocket
- Or click **👟 STEPS** on laptop for local tracking
- Goal ring shows progress to 10,000 steps
- Detects IDLE / WALKING / RUNNING automatically
- Orb spins faster as you move:
  - Walking → Green shells
  - Running → Gold shells, rapid pulse

---

## 🏗 Project Structure

```
vita-app/
├── server.js                    # Custom WebSocket + Next.js server
├── src/
│   ├── app/
│   │   ├── page.tsx             # Laptop page → VitaOrb
│   │   ├── phone/page.tsx       # Phone sensor PWA page
│   │   ├── api/local-ip/        # Returns local IP for phone URL
│   │   └── globals.css          # Space Mono font + HUD styles
│   ├── components/
│   │   └── VitaOrb.tsx          # Main orb (Three.js + all phases)
│   └── lib/
│       └── stepDetector.ts      # Accelerometer step algorithm
└── public/
    └── manifest.json            # PWA manifest (add to home screen)
```

---

## 🔧 iPhone Tip

Safari on iOS 13+ requires explicit permission for DeviceMotion.
The app requests it automatically when you tap START TRACKING.

If denied: **Settings → Safari → Motion & Orientation Access → ON**

---

## 🗺 Roadmap

- [ ] Phase 4 — Bloom post-processing on the orb
- [ ] Groq LLM voice agent (VITA talks back)
- [ ] Heart rate via phone camera (rPPG)
- [ ] Sleep tracking integration
- [ ] MediaPipe hand gesture control

---

* — built by A MAN* 🦇
