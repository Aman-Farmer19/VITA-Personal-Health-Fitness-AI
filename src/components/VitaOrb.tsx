'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { StepData } from '@/lib/stepDetector';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Constants
// ─────────────────────────────────────────────────────────────────────────────

interface MoodEntry {
  label: string; hex: string; threeHex: number;
  stress: string; sw: number; mw: number;
}

const MOODS: Record<string, MoodEntry> = {
  happy: { label: 'HAPPY', hex: '#00FF88', threeHex: 0x00FF88, stress: 'LOW', sw: 15, mw: 95 },
  sad: { label: 'MELANCHOLY', hex: '#4488FF', threeHex: 0x4488FF, stress: 'MODERATE', sw: 50, mw: 35 },
  angry: { label: 'STRESSED', hex: '#FF2D2D', threeHex: 0xFF2D2D, stress: 'HIGH', sw: 88, mw: 20 },
  fearful: { label: 'ANXIOUS', hex: '#FF8C00', threeHex: 0xFF8C00, stress: 'HIGH', sw: 75, mw: 30 },
  disgusted: { label: 'UNEASY', hex: '#FF6644', threeHex: 0xFF6644, stress: 'MODERATE', sw: 55, mw: 40 },
  surprised: { label: 'ALERT', hex: '#FFD700', threeHex: 0xFFD700, stress: 'LOW', sw: 20, mw: 80 },
  neutral: { label: 'CALM', hex: '#00E5FF', threeHex: 0x00E5FF, stress: 'LOW', sw: 18, mw: 70 },
};

const ACT_COLOR: Record<string, string> = {
  IDLE: '#00E5FF', WALKING: '#00FF88', RUNNING: '#FFD700',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function VitaOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [heartRate, setHeartRate] = useState(72);
  const [mood, setMood] = useState<MoodEntry>(MOODS.neutral);
  const [stepData, setStepData] = useState<StepData>({ steps: 0, cadence: 0, activity: 'IDLE', distance: 0, calories: 0 });
  const [transcript, setTranscript] = useState('— AWAITING INPUT —');
  const [statusMsg, setStatusMsg] = useState('VITA ONLINE');
  const [errorMsg, setErrorMsg] = useState('');
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [stepsOn, setStepsOn] = useState(false);
  const [phoneLinked, setPhoneLinked] = useState(false);
  const [localIP, setLocalIP] = useState('');
  const [expression, setExpression] = useState('');
  const [micSim, setMicSim] = useState(false);
  const [stepSim, setStepSim] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  // Three.js state ref
  const threeRef = useRef<{
    renderer: any; composer: any; scene: any; camera: any; group: any;
    core: any; coreMat: any; glows: any[];
    sh1: any; sh2: any; sh3: any; s1m: any; s2m: any; s3m: any;
    ri1: any; ri2: any; ri3: any; orbs: any[];
    voiceAmp: number; stepBoost: number; moodColor: number; activityLevel: number;
    mx: number; my: number; tx: number; ty: number; t: number; animId: number;
  } | null>(null);

  const audioRef = useRef<any>(null);
  const ttsAudioContextRef = useRef<AudioContext | null>(null);
  const ttsVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsRequestIdRef = useRef(0);
  const ttsCooldownUntilRef = useRef(0);
  const ttsActiveRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const faceApiRef = useRef<any>(null);
  const detectTimer = useRef<any>(null);
  const simMoodTimer = useRef<any>(null);
  const simEI = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const motionRef = useRef<any>(null);
  const simStepTimer = useRef<any>(null);
  const stepDetRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (ttsAudioContextRef.current) {
        void ttsAudioContextRef.current.close();
        ttsAudioContextRef.current = null;
      }
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current.removeAttribute('src');
        ttsAudioRef.current.load();
        ttsAudioRef.current = null;
      }
    };
  }, []);

  // ── Fetch local IP ──────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/local-ip').then(r => r.json()).then(d => setLocalIP(d.ip)).catch(() => { });
  }, []);

  // ── WebSocket ───────────────────────────────────────────────────
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`ws://${window.location.host}/vita-ws?type=laptop`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'steps') {
            setStepData(msg);
            if (threeRef.current) {
              threeRef.current.stepBoost = 1;
              threeRef.current.activityLevel =
                msg.activity === 'RUNNING' ? 2 : msg.activity === 'WALKING' ? 1 : 0;
            }
          }
          if (msg.type === 'phone_connected') setPhoneLinked(true);
          if (msg.type === 'phone_disconnected') setPhoneLinked(false);
        } catch { }
      };
      ws.onclose = () => setTimeout(connect, 3000);
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  // ── Three.js + Bloom (Phase 4) ─────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    let cancelled = false;

    async function init() {
      await document.fonts.load('700 16px "Space Mono"');
      if (cancelled) return;

      // Core Three.js
      const THREE = await import('three');

      // Post-processing — bloom
      const { EffectComposer } = await import('three/examples/jsm/postprocessing/EffectComposer.js');
      const { RenderPass } = await import('three/examples/jsm/postprocessing/RenderPass.js');
      const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js');
      const { OutputPass } = await import('three/examples/jsm/postprocessing/OutputPass.js');

      if (cancelled) return;

      const container = containerRef.current!;
      const canvas = canvasRef.current!;
      const W = container.offsetWidth;
      const H = container.offsetHeight;

      // Renderer
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      renderer.setSize(W, H);
      renderer.setPixelRatio(1); // Force 1x — massive CPU/GPU savings on laptop
      renderer.toneMapping = THREE.ReinhardToneMapping;
      renderer.toneMappingExposure = 0.9;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
      camera.position.set(0, 0, 6);

      // ── Bloom composer ──────────────────────────────────────────
      const renderPass = new RenderPass(scene, camera);

      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(W, H),
        0.5,   // strength  — was 1.4, toned way down
        0.3,   // radius    — tighter glow spread
        0.7    // threshold — higher = only bright core glows, not everything
      );

      const outputPass = new OutputPass();

      const composer = new EffectComposer(renderer);
      composer.addPass(renderPass);
      composer.addPass(bloomPass);
      composer.addPass(outputPass);

      // ── Scene objects ───────────────────────────────────────────
      const group = new THREE.Group();
      scene.add(group);

      // Core
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xFF2D9A });
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 32), coreMat);
      group.add(core);

      // Glow layers
      const glows: any[] = [];
      for (let i = 1; i <= 5; i++) {
        const g = new THREE.Mesh(
          new THREE.SphereGeometry(0.7 + i * 0.18, 32, 32),
          new THREE.MeshBasicMaterial({ color: 0xFF2D9A, transparent: true, opacity: 0.12 / i, side: THREE.BackSide })
        );
        group.add(g); glows.push(g);
      }

      // Wireframe shells
      const s1m = new THREE.MeshBasicMaterial({ color: 0x7C3AED, wireframe: true, transparent: true, opacity: 0.6 });
      const s2m = new THREE.MeshBasicMaterial({ color: 0x00E5FF, wireframe: true, transparent: true, opacity: 0.35 });
      const s3m = new THREE.MeshBasicMaterial({ color: 0xFF2D9A, wireframe: true, transparent: true, opacity: 0.15 });
      const sh1 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 1), s1m);
      const sh2 = new THREE.Mesh(new THREE.IcosahedronGeometry(2.15, 1), s2m);
      const sh3 = new THREE.Mesh(new THREE.IcosahedronGeometry(2.55, 0), s3m);
      group.add(sh1, sh2, sh3);

      // Rings
      const mkR = (r: number, tb: number, col: number, op: number, rx: number, ry: number, rz: number) => {
        const m = new THREE.Mesh(
          new THREE.TorusGeometry(r, tb, 16, 128),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op })
        );
        m.rotation.set(rx, ry, rz); return m;
      };
      const ri1 = mkR(2.9, 0.018, 0x00E5FF, 0.8, Math.PI / 2.5, 0.2, 0);
      const ri2 = mkR(3.3, 0.012, 0xFF2D9A, 0.6, Math.PI / 4, Math.PI / 5, 0.3);
      const ri3 = mkR(3.7, 0.008, 0x7C3AED, 0.4, -Math.PI / 6, Math.PI / 3, -0.2);
      group.add(ri1, ri2, ri3);

      // Orbital debris
      const orbs: any[] = [];
      for (let i = 0; i < 12; i++) {
        const d = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 8, 8),
          new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0x00E5FF : 0xFF2D9A })
        );
        d.userData = { angle: (i / 12) * Math.PI * 2, speed: 0.3 + Math.random() * 0.4, radius: 2.9, tilt: Math.random() * 0.5 };
        group.add(d); orbs.push(d);
      }

      // Star field
      const pp = new Float32Array(9000);
      for (let i = 0; i < 9000; i++) pp[i] = (Math.random() - 0.5) * 30;
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
      scene.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x8888aa, size: 0.025, transparent: true, opacity: 0.5 })));

      // Background
      scene.background = new THREE.Color(0x050510);

      const state = {
        renderer, composer, scene, camera, group,
        core, coreMat, glows, sh1, sh2, sh3, s1m, s2m, s3m,
        ri1, ri2, ri3, orbs,
        voiceAmp: 0, stepBoost: 0, moodColor: 0xFF2D9A,
        activityLevel: 0, mx: 0, my: 0, tx: 0, ty: 0, t: 0, animId: 0,
      };
      threeRef.current = state;

      container.addEventListener('mousemove', (e) => {
        const r = container.getBoundingClientRect();
        state.mx = ((e.clientX - r.left) / r.width - 0.5) * 2;
        state.my = -((e.clientY - r.top) / r.height - 0.5) * 2;
      });

      // ── Render loop ─────────────────────────────────────────────
      let lastFrame = 0;
      const animate = () => {
        state.animId = requestAnimationFrame(animate);
        state.t += 0.012;

        state.tx += (state.mx * 0.6 - state.tx) * 0.04;
        state.ty += (state.my * 0.4 - state.ty) * 0.04;
        camera.position.x = state.tx;
        camera.position.y = state.ty;
        camera.lookAt(0, 0, 0);

        // Activity multiplier
        const actBoost = 1 + state.activityLevel * 1.5;
        const sp = (1 + state.voiceAmp * 4) * actBoost;

        // Core pulse
        const pulse = (1 + Math.sin(state.t * 2.5) * 0.06)
          * (1 + state.voiceAmp * 2)
          * (1 + state.stepBoost * 0.4);
        core.scale.setScalar(pulse);

        // ── Phase 4: Dynamic bloom strength ────────────────────────
        const dynamicBloom = 0.5
          + state.voiceAmp * 0.8
          + state.stepBoost * 0.5
          + Math.sin(state.t * 2.5) * 0.05;
        bloomPass.strength = Math.min(dynamicBloom, 1.8);

        // Mood colour lerp
        const mc = new THREE.Color(state.moodColor);
        coreMat.color.lerp(mc, 0.05);
        glows.forEach((g, i) => {
          g.material.opacity = 0.12 / (i + 1) + state.voiceAmp * 0.1 + state.stepBoost * 0.06;
          g.scale.setScalar(1 + state.voiceAmp * 0.5 + state.stepBoost * 0.2);
          g.material.color.lerp(mc, 0.03);
        });

        // Shell rotation
        sh1.rotation.x += 0.004 * sp; sh1.rotation.y += 0.006 * sp;
        sh2.rotation.x -= 0.003 * sp; sh2.rotation.y -= 0.005 * sp;
        sh3.rotation.y += 0.002 * sp; sh3.rotation.z += 0.003 * sp;

        // Ring rotation
        ri1.rotation.z += 0.008 * sp;
        ri2.rotation.z -= 0.006 * sp;
        ri3.rotation.x += 0.004 * sp;

        // Shell colour reacts to activity + voice
        if (state.activityLevel === 2) { s1m.color.setHex(0xFFD700); s2m.color.setHex(0xFF8C00); }
        else if (state.activityLevel === 1) { s1m.color.setHex(0x00FF88); s2m.color.setHex(0x00E5FF); }
        else if (state.voiceAmp > 0.1) { s1m.color.setHex(0xFF2D9A); s2m.color.setHex(0xFF8C00); }
        else { s1m.color.setHex(0x7C3AED); s2m.color.setHex(0x00E5FF); }

        // Orbital debris
        orbs.forEach(d => {
          d.userData.angle += d.userData.speed * 0.012 * sp;
          const a = d.userData.angle, rv = d.userData.radius;
          d.position.x = Math.cos(a) * rv;
          d.position.y = Math.sin(a * 0.5) * rv * d.userData.tilt;
          d.position.z = Math.sin(a) * rv;
        });

        state.voiceAmp *= 0.88;
        state.stepBoost *= 0.85;


        // ── Use composer instead of renderer.render ─────────────────
        const now = Date.now();
        if (now - lastFrame < 33) return;
        lastFrame = now;
        composer.render();
      };
      animate();

      // Resize
      window.addEventListener('resize', () => {
        const W2 = container.offsetWidth, H2 = container.offsetHeight;
        camera.aspect = W2 / H2;
        camera.updateProjectionMatrix();
        renderer.setSize(W2, H2);
        composer.setSize(W2, H2);
        bloomPass.resolution.set(W2, H2);
      });
    }

    requestAnimationFrame(() => requestAnimationFrame(() => init()));

    return () => {
      cancelled = true;
      if (threeRef.current) {
        cancelAnimationFrame(threeRef.current.animId);
        threeRef.current.renderer.dispose();
      }
    };
  }, []);

  // ── Heart rate sim ──────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setHeartRate(68 + Math.floor(Math.random() * 16)), 3000);
    return () => clearInterval(id);
  }, []);

  // ── VITA VOICE SESSION: SINGLE OWNER ─────────────────────────────
  const sessionActiveRef = useRef(false);
  const lastTtsFinishedAtRef = useRef(0);
  const startMicRef = useRef<(() => Promise<void>) | null>(null);
  const endSessionRef = useRef<(() => void) | null>(null);
  const askVitaRef = useRef<((message: string) => Promise<string | null>) | null>(null);

  const getGreeting = useCallback(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning, Boss.';
    if (hour < 17) return 'Good afternoon, Boss.';
    return 'Good evening, Boss.';
  }, []);

  const speakVita = useCallback(async (text: string) => {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    if (!cleanText) return;

    const requestId = ++ttsRequestIdRef.current;

    // Absolute single-audio ownership: stop any previous audio and all legacy
    // browser speech before VITA starts speaking.
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    }

    const previousAudio = ttsAudioRef.current;
    if (previousAudio) {
      previousAudio.pause();
      previousAudio.removeAttribute('src');
      previousAudio.load();
      ttsAudioRef.current = null;
    }

    ttsActiveRef.current = true;
    setStatusMsg('VITA SPEAKING...');

    const started = performance.now();
    console.log('[VITA TTS] ElevenLabs streaming request started');

    try {
      const audioUrl =
        `/api/speak?text=${encodeURIComponent(cleanText)}` +
        `&request_id=${requestId}`;

      const audio = new Audio();
      audio.preload = 'auto';
      audio.volume = 1;
      audio.src = audioUrl;

      ttsAudioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let firstPlayLogged = false;

        const cleanup = () => {
          audio.onplaying = null;
          audio.onended = null;
          audio.onerror = null;

          if (ttsAudioRef.current === audio) {
            ttsAudioRef.current = null;
          }

          audio.pause();
          audio.removeAttribute('src');
          audio.load();

          if (threeRef.current) {
            threeRef.current.voiceAmp = 0;
          }
        };

        const finish = () => {
          if (settled) return;
          settled = true;

          ttsActiveRef.current = false;
          lastTtsFinishedAtRef.current = performance.now();

          // Keep the microphone closed briefly after TTS to prevent the
          // response from being re-recorded as a user command.
          ttsCooldownUntilRef.current = performance.now() + 1500;
          setStatusMsg('VITA READY');

          console.log(
            `[VITA TTS] ElevenLabs finished in ${Math.round(
              performance.now() - started,
            )}ms`,
          );

          cleanup();
          window.setTimeout(resolve, 900);
        };

        audio.onplaying = () => {
          if (!firstPlayLogged) {
            firstPlayLogged = true;
            console.log(
              `[VITA TTS] first audio playback after ${Math.round(
                performance.now() - started,
              )}ms`,
            );
          }

          if (threeRef.current) {
            threeRef.current.voiceAmp = 0.25;
          }
        };

        audio.onended = finish;

        audio.onerror = () => {
          if (settled) return;
          settled = true;
          ttsActiveRef.current = false;
          cleanup();
          reject(new Error('VITA streaming audio playback failed.'));
        };

        void audio.play().catch((error) => {
          if (settled) return;
          settled = true;
          ttsActiveRef.current = false;
          cleanup();
          reject(
            error instanceof Error
              ? error
              : new Error('VITA audio playback was blocked.'),
          );
        });
      });
    } catch (error) {
      ttsActiveRef.current = false;
      ttsCooldownUntilRef.current = performance.now() + 700;
      setStatusMsg('VITA ERROR');
      setErrorMsg('NEURAL TTS UNAVAILABLE');

      // Never fall back to SpeechSynthesis. That was the source of the
      // unwanted Heera/Google second voice.
      console.error('[VITA TTS] ElevenLabs streaming failed:', error);
    }
  }, []);

  const askVita = useCallback(async (message: string) => {
    if (!sessionActiveRef.current) return null;

    try {
      setStatusMsg('VITA THINKING...');

      const vitaState = {
        steps: stepData.steps,
        cadence: stepData.cadence,
        activity: stepData.activity,
        distance: stepData.distance,
        calories: stepData.calories,
        mood: mood.label,
        expression,
        heartRate: null,
        micOn,
        camOn,
        stepsOn,
        phoneLinked,
        timestamp: new Date().toISOString(),
      };

      const started = performance.now();

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, vitaState }),
      });

      const data = await res.json();

      console.log(
        `[VITA] /api/agent round trip: ${Math.round(performance.now() - started)}ms`,
      );

      if (!res.ok) throw new Error(data.error || 'VITA agent failed');

      if (!sessionActiveRef.current) return null;

      const answer = String(data.answer ?? '').trim();
      setTranscript(`"${answer.toUpperCase()}"`);
      await speakVita(answer);

      // ONE USER COMMAND PER SESSION.
      // Do not reopen the microphone after the answer; this was the source
      // of the repeated self-listening / "Thank you" loop.
      if (sessionActiveRef.current) {
        endSessionRef.current?.();
      }

      return answer;
    } catch (error) {
      console.error('[VITA]', error);
      if (!sessionActiveRef.current) return null;

      setStatusMsg('AI OFFLINE');
      setErrorMsg('GEMINI TEMPORARILY UNAVAILABLE');

      // Never restart the microphone automatically after a brain failure.
      // Doing so creates a transcription storm and repeatedly sends silence/
      // echo phrases such as "Thank you" back into Whisper.
      window.dispatchEvent(new Event('vita:agent-failed'));
      endSessionRef.current?.();

      return null;
    }
  }, [
    stepData,
    mood,
    expression,
    micOn,
    camOn,
    stepsOn,
    phoneLinked,
    speakVita,
  ]);

  askVitaRef.current = askVita;

  // ── PHASE 1: Voice ──────────────────────────────────────────────
  const startMic = useCallback(async () => {
    if (!sessionActiveRef.current) return;

    const remaining = ttsCooldownUntilRef.current - performance.now();

    if (ttsActiveRef.current || remaining > 0) {
      window.setTimeout(() => {
        if (sessionActiveRef.current) void startMicRef.current?.();
      }, Math.max(250, remaining));
      return;
    }

    if (audioRef.current?.recorder) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      if (!sessionActiveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;

      const data = new Uint8Array(analyser.fftSize);
      ctx.createMediaStreamSource(stream).connect(analyser);

      let rafId = 0;

      const tick = () => {
        if (!audioRef.current) return;
        rafId = requestAnimationFrame(tick);
        analyser.getByteFrequencyData(data);

        if (threeRef.current) {
          threeRef.current.voiceAmp =
            data.reduce((a, b) => a + b, 0) / data.length / 128;
        }
      };

      tick();

      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      const chunks: Blob[] = [];
      let stopping = false;
      let hasSpoken = false;
      const startedAt = performance.now();
      let lastVoiceAt = startedAt;

      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };

      recorder.onerror = (event) => {
        console.error('[VITA RECORDER ERROR]', event);
      };

      const finishRecording = (reason: string) => {
        if (stopping || recorder.state === 'inactive') return;

        stopping = true;
        console.log('[VITA] Stopping recorder:', reason);

        try {
          recorder.requestData();
        } catch { }

        setStatusMsg('TRANSCRIBING...');

        window.setTimeout(() => {
          try {
            if (recorder.state !== 'inactive') recorder.stop();
          } catch (error) {
            console.error('[VITA STOP RECORDER]', error);
          }
        }, 40);
      };

      recorder.onstop = async () => {
        try {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 80));

          if (!sessionActiveRef.current) return;

          const blob = new Blob(chunks, {
            type: recorder.mimeType || 'audio/webm',
          });

          if (!hasSpoken || blob.size < 6000) {
            console.log('[VITA] Ignoring empty/noise recording.');
            setTranscript('— DID NOT CATCH THAT —');

            // One-shot session: do not re-open the microphone after silence.
            endSessionRef.current?.();
            return;
          }

          const form = new FormData();
          form.append('audio', blob, 'vita-voice.webm');

          const started = performance.now();

          const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: form,
          });

          const data = await response.json();

          console.log(
            `[VITA] Gemini Transcribe round trip: ${Math.round(
              performance.now() - started,
            )}ms`,
          );

          if (!response.ok) {
            throw new Error(data.error || 'Transcription failed');
          }

          if (!sessionActiveRef.current) return;

          const text = String(data.text || '').trim();

          const normalized = text
            .toLowerCase()
            .replace(/[^a-z\s']/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (!normalized) {
            console.log('[VITA] Empty transcript — ending one-shot session.');
            endSessionRef.current?.();
            return;
          }

          console.log('[VITA] Gemini transcript:', text);

          const timeSinceTts =
            performance.now() - lastTtsFinishedAtRef.current;

          const echoPhrase =
            /^(thank you|thanks|thankyou|you're welcome|you are welcome|welcome|okay|ok|thanks vita|thank you vita)$/.test(
              normalized,
            );

          const likelyEcho =
            echoPhrase ||
            (timeSinceTts < 5000 &&
              /^(good morning|good afternoon|good evening|good night|boss)$/.test(
                normalized,
              ));

          const promptLeak =
            normalized.includes('return only the spoken transcript') ||
            normalized.includes("transcribe only the user's spoken words") ||
            normalized.includes('transcribe only the spoken words');

          if (
            likelyEcho ||
            promptLeak ||
            normalized.length < 2 ||
            /^[.]+$/.test(normalized)
          ) {
            console.log('[VITA] Ignoring likely echo/noise:', text);

            // Critical: END, do not restart the microphone.
            endSessionRef.current?.();
            return;
          }

          if (
            /^(?:vita\s+)?stop(?:\s+now)?$/.test(normalized) ||
            /^stop(?:\s+the\s+)?session$/.test(normalized)
          ) {
            console.log('[VITA] STOP command detected — no agent call.');
            endSessionRef.current?.();
            return;
          }

          setTranscript(`"${text.toUpperCase()}"`);
          await askVitaRef.current?.(text);

        } catch (error) {
          console.error('[VITA TRANSCRIPTION]', error);

          if (sessionActiveRef.current) {
            setStatusMsg('VITA ERROR');
            setErrorMsg('TRANSCRIPTION FAILED');

            // Never start another recorder after a failed STT request.
            endSessionRef.current?.();
          }
        } finally {
          if (audioRef.current?.silenceRaf) {
            cancelAnimationFrame(audioRef.current.silenceRaf);
          }

          stream.getTracks().forEach((track) => track.stop());

          await ctx.close().catch(() => undefined);

          audioRef.current = null;
          setMicOn(false);

          if (threeRef.current) {
            threeRef.current.voiceAmp = 0;
          }
        }
      };

      const detectSilence = () => {
        if (
          !audioRef.current ||
          audioRef.current.recorder !== recorder ||
          recorder.state !== 'recording'
        ) {
          return;
        }

        const now = performance.now();

        analyser.getByteTimeDomainData(data);

        let sumSquares = 0;

        for (let i = 0; i < data.length; i += 1) {
          const x = (data[i] - 128) / 128;
          sumSquares += x * x;
        }

        const rms = Math.sqrt(sumSquares / data.length);

        if (rms > 0.045) {
          hasSpoken = true;
          lastVoiceAt = now;
        }

        if (
          hasSpoken &&
          now - startedAt >= 500 &&
          now - lastVoiceAt >= 900
        ) {
          finishRecording('silence');
          return;
        }

        if (now - startedAt >= 7000) {
          finishRecording('max-duration');
          return;
        }

        audioRef.current.silenceRaf =
          requestAnimationFrame(detectSilence);
      };

      audioRef.current = {
        ctx,
        analyser,
        data,
        rafId,
        stream,
        recorder,
        chunks,
        silenceRaf: 0,
      };

      recorder.start(250);
      audioRef.current.silenceRaf =
        requestAnimationFrame(detectSilence);

      setMicOn(true);
      setMicSim(false);
      setStatusMsg('LISTENING...');
      setTranscript('— SPEAK TO VITA —');
      setErrorMsg('');

    } catch (error) {
      console.error('[VITA MICROPHONE]', error);
      setMicOn(false);
      setMicSim(false);
      setErrorMsg('MICROPHONE UNAVAILABLE');
      setStatusMsg('VITA READY');
    }
  }, []);

  startMicRef.current = startMic;

  const stopMic = useCallback(() => {
    const audio = audioRef.current;

    if (!audio) {
      setMicOn(false);
      return;
    }

    if (audio.silenceRaf) {
      cancelAnimationFrame(audio.silenceRaf);
    }

    if (
      audio.recorder &&
      audio.recorder.state !== 'inactive'
    ) {
      setStatusMsg('TRANSCRIBING...');

      try {
        audio.recorder.requestData();
      } catch { }

      window.setTimeout(() => {
        try {
          if (audio.recorder.state !== 'inactive') {
            audio.recorder.stop();
          }
        } catch (error) {
          console.error('[VITA STOP MIC]', error);
        }
      }, 40);

      return;
    }

    audio.stream?.getTracks().forEach((track: MediaStreamTrack) => {
      track.stop();
    });

    audio.ctx?.close().catch(() => undefined);
    audioRef.current = null;
    setMicOn(false);
  }, []);

  const endSession = useCallback(() => {
    if (!sessionActiveRef.current) return;

    sessionActiveRef.current = false;
    setSessionActive(false);
    ttsActiveRef.current = false;
    ttsCooldownUntilRef.current = 0;

    stopMic();

    setStatusMsg('VITA READY');
    setTranscript('— SESSION ENDED —');
    console.log('[VITA SESSION] OFF');

    window.dispatchEvent(new Event('vita:session-ended'));
  }, [stopMic]);

  endSessionRef.current = endSession;

  const activateSession = useCallback(async () => {
    if (sessionActiveRef.current) return;

    sessionActiveRef.current = true;
    setSessionActive(true);
    setErrorMsg('');
    setStatusMsg('VITA READY');
    setTranscript('— VITA ACTIVATING —');

    console.log('[VITA SESSION] ACTIVE');
    window.dispatchEvent(new Event('vita:session-started'));

    await speakVita(
      `${getGreeting()} What we are gonna do today, Boss?`,
    );

    if (!sessionActiveRef.current) return;

    // After the greeting, listen for exactly one user command.
    void startMicRef.current?.();
  }, [getGreeting, speakVita]);

  useEffect(() => {
    const onActivate = () => void activateSession();
    const onStop = () => endSessionRef.current?.();

    window.addEventListener('vita:activate', onActivate);
    window.addEventListener('vita:stop-requested', onStop);

    return () => {
      window.removeEventListener('vita:activate', onActivate);
      window.removeEventListener('vita:stop-requested', onStop);
    };
  }, [activateSession]);

  const handleVoiceButton = useCallback(() => {
    if (sessionActiveRef.current) {
      endSession();
    } else {
      void activateSession();
    }
  }, [activateSession, endSession]);

  // ── PHASE 2: Face Cam ───────────────────────────────────────────
  const applyMood = useCallback((key: string) => {
    const m = MOODS[key] || MOODS.neutral;
    setMood(m); setExpression(key.toUpperCase());
    if (threeRef.current) threeRef.current.moodColor = m.threeHex;
  }, []);

  const startSimMood = useCallback(() => {
    const keys = Object.keys(MOODS);
    const next = () => { applyMood(keys[simEI.current % keys.length]); simEI.current++; simMoodTimer.current = setTimeout(next, 2500); };
    next();
  }, [applyMood]);

  const startCam = useCallback(async () => {
    if (!faceApiRef.current) {
      try {
        const fa = await import('face-api.js');
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';
        await Promise.all([fa.nets.tinyFaceDetector.loadFromUri(MODEL_URL), fa.nets.faceExpressionNet.loadFromUri(MODEL_URL)]);
        faceApiRef.current = fa;
      } catch { faceApiRef.current = null; }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) { videoRef.current.srcObject = stream; await new Promise<void>(r => { videoRef.current!.onloadedmetadata = () => r(); }); }
      setCamOn(true); setErrorMsg('');
      if (faceApiRef.current) {
        const fa = faceApiRef.current;
        const loop = async () => {
          if (!videoRef.current?.srcObject) return;
          try {
            const det = await fa.detectSingleFace(videoRef.current, new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 })).withFaceExpressions();
            if (det) { const dom = Object.entries(det.expressions).sort((a: any, b: any) => b[1] - a[1])[0]; if ((dom[1] as number) > 0.3) applyMood(dom[0]); }
          } catch { }
          detectTimer.current = setTimeout(loop, 200);
        };
        loop();
      } else { setErrorMsg('AI MODELS FAILED — FEED ONLY'); startSimMood(); }
    } catch (err: any) {
      setCamOn(true);
      setErrorMsg(err.name === 'NotAllowedError' ? 'CAM DENIED — DEMO MOOD' : 'CAM UNAVAIL — DEMO MOOD');
      startSimMood();
    }
  }, [applyMood, startSimMood]);

  const stopCam = useCallback(() => {
    if (detectTimer.current) { clearTimeout(detectTimer.current); detectTimer.current = null; }
    if (simMoodTimer.current) { clearTimeout(simMoodTimer.current); simMoodTimer.current = null; }
    if (videoRef.current?.srcObject) { (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop()); videoRef.current.srcObject = null; }
    setExpression(''); applyMood('neutral'); setCamOn(false); setErrorMsg('');
  }, [applyMood]);

  // ── PHASE 3: Steps ──────────────────────────────────────────────
  const startSteps = useCallback(async () => {
    try {
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        const p = await (DeviceMotionEvent as any).requestPermission();
        if (p !== 'granted') throw new Error('denied');
      }
      if (!('DeviceMotionEvent' in window)) throw new Error('unsupported');
      const { StepDetector } = await import('@/lib/stepDetector');
      const det = new StepDetector(); stepDetRef.current = det; det.reset();
      det.onStep = (data) => {
        setStepData(data);
        if (threeRef.current) { threeRef.current.stepBoost = 1; threeRef.current.activityLevel = data.activity === 'RUNNING' ? 2 : data.activity === 'WALKING' ? 1 : 0; }
      };
      const handler = (e: DeviceMotionEvent) => { const a = e.accelerationIncludingGravity || e.acceleration; if (a?.x != null) det.update(a.x!, a.y!, a.z!); };
      window.addEventListener('devicemotion', handler); motionRef.current = handler;
      setStepsOn(true); setStepSim(false); setStatusMsg('TRACKING STEPS...'); setErrorMsg('');
    } catch {
      setStepsOn(true); setStepSim(true);
      setErrorMsg('NO SENSOR — SIMULATING');
      setStatusMsg('SIM WALKING...');
      let ss = 0; const st: number[] = [];
      const tick = () => {
        const now = Date.now(); st.push(now); if (st.length > 8) st.shift();
        let cad = 0; if (st.length >= 2) { const span = (st[st.length - 1] - st[0]) / 1000; cad = Math.round((st.length - 1) / span * 60); }
        ss++;
        const act = cad >= 120 ? 'RUNNING' : cad >= 60 ? 'WALKING' : 'IDLE';
        const d: StepData = { steps: ss, cadence: cad, activity: act as any, distance: parseFloat((ss * 0.000762).toFixed(2)), calories: Math.round(ss * 0.04) };
        setStepData(d);
        if (threeRef.current) { threeRef.current.stepBoost = 1; threeRef.current.activityLevel = act === 'RUNNING' ? 2 : act === 'WALKING' ? 1 : 0; }
        simStepTimer.current = setTimeout(tick, 580 + Math.sin(ss * 0.3) * 120 + Math.random() * 80);
      };
      simStepTimer.current = setTimeout(tick, 600);
    }
  }, []);

  const stopSteps = useCallback(() => {
    if (motionRef.current) { window.removeEventListener('devicemotion', motionRef.current); motionRef.current = null; }
    if (simStepTimer.current) { clearTimeout(simStepTimer.current); simStepTimer.current = null; }
    stepDetRef.current?.reset();
    setStepData({ steps: 0, cadence: 0, activity: 'IDLE', distance: 0, calories: 0 });
    if (threeRef.current) { threeRef.current.activityLevel = 0; threeRef.current.stepBoost = 0; }
    setStepsOn(false); setStepSim(false); setStatusMsg('VITA ONLINE'); setErrorMsg('');
  }, []);

  // ── Derived values ──────────────────────────────────────────────
  const goalPct = Math.min(stepData.steps / 10000, 1);
  const circumf = 2 * Math.PI * 44;

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100vw', height: '100vh', background: '#050510', overflow: 'hidden' }}>

      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0 }} />

      <video ref={videoRef} autoPlay muted playsInline style={{
        position: 'absolute', bottom: 115, left: 24, width: 106, height: 106,
        borderRadius: '50%', objectFit: 'cover', transform: 'scaleX(-1)',
        border: '2px solid #00E5FF', display: camOn ? 'block' : 'none',
      }} />

      {/* HUD */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: "'Space Mono','Courier New',monospace" }}>

        <div className="hud-corner tl" /><div className="hud-corner tr" />
        <div className="hud-corner bl" /><div className="hud-corner br" />

        <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', color: '#00E5FF', fontSize: 24, fontWeight: 700, letterSpacing: 16, whiteSpace: 'nowrap' }}>VITA</div>
        <div style={{ position: 'absolute', top: 54, left: '50%', transform: 'translateX(-50%)', color: '#7C3AED', fontSize: 9, letterSpacing: 5, whiteSpace: 'nowrap' }}>HEALTH &amp; FITNESS AI</div>
        <div style={{ position: 'absolute', top: 20, right: 56, color: '#7C3AED', fontSize: 8, letterSpacing: 2 }}>PHASE 4</div>

        {phoneLinked && (
          <div style={{ position: 'absolute', top: 36, right: 56, color: '#00FF88', fontSize: 7, letterSpacing: 2 }}>📱 PHONE LINKED</div>
        )}

        <div className="scan-line" />

        {/* LEFT STATS */}
        <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: 20, display: 'flex', flexDirection: 'column', gap: 13 }}>
          {[
            { label: 'HEART RATE', value: `${heartRate} BPM`, pct: heartRate, color: '#FF2D9A' },
            { label: 'STEPS TODAY', value: stepData.steps.toLocaleString(), pct: goalPct * 100, color: '#FFD700' },
            { label: 'DISTANCE', value: `${stepData.distance} km`, pct: goalPct * 80, color: '#00E5FF' },
            { label: 'CALORIES', value: `${stepData.calories} kcal`, pct: goalPct * 70, color: '#7C3AED' },
          ].map(({ label, value, pct, color }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 8, color: '#7C3AED', letterSpacing: 2 }}>{label}</span>
              <span style={{ fontSize: 13, color, fontWeight: 700 }}>{value}</span>
              <div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
            </div>
          ))}
        </div>

        {/* RIGHT STATS */}
        <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: 20, display: 'flex', flexDirection: 'column', gap: 13, textAlign: 'right' }}>
          {[
            { label: 'MOOD', value: mood.label, color: mood.hex, pct: mood.mw },
            { label: 'STRESS INDEX', value: mood.stress, color: '#FF8C00', pct: mood.sw },
            { label: 'ACTIVITY', value: stepData.activity, color: ACT_COLOR[stepData.activity], pct: stepData.activity === 'RUNNING' ? 95 : stepData.activity === 'WALKING' ? 50 : 5 },
            { label: 'CADENCE', value: `${stepData.cadence} spm`, color: '#FFD700', pct: Math.min(stepData.cadence / 180 * 100, 100) },
          ].map(({ label, value, color, pct }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
              <span style={{ fontSize: 8, color: '#7C3AED', letterSpacing: 2 }}>{label}</span>
              <span style={{ fontSize: 13, color, fontWeight: 700 }}>{value}</span>
              <div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
            </div>
          ))}
        </div>

        {/* Expression badge */}
        {camOn && expression && (
          <div style={{ position: 'absolute', bottom: 226, left: 24, fontSize: 7, letterSpacing: 2, color: mood.hex, border: `1px solid ${mood.hex}`, padding: '3px 8px', borderRadius: 2 }}>
            {expression}
          </div>
        )}

        {/* Step ring */}
        {stepsOn && (
          <div style={{ position: 'absolute', bottom: 115, right: 24, width: 100, height: 100 }}>
            <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
              <circle cx="50" cy="50" r="44" fill="none" stroke="#1a0a2e" strokeWidth="5" />
              <circle cx="50" cy="50" r="44" fill="none"
                stroke={goalPct >= 1 ? '#00FF88' : '#FFD700'} strokeWidth="5"
                strokeDasharray={circumf} strokeDashoffset={circumf * (1 - goalPct)}
                strokeLinecap="round" transform="rotate(-90 50 50)"
                style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.5s' }}
              />
              <text x="50" y="46" textAnchor="middle" fill="#FFD700" fontSize="9" fontFamily="'Space Mono',monospace" fontWeight="700">{goalPct >= 1 ? 'GOAL!' : 'GOAL'}</text>
              <text x="50" y="60" textAnchor="middle" fill="#00E5FF" fontSize="7" fontFamily="'Space Mono',monospace">{Math.round(goalPct * 100)}%</text>
            </svg>
          </div>
        )}

        {/* Phone URL hint */}
        {!phoneLinked && localIP && !stepsOn && (
          <div style={{ position: 'absolute', bottom: 115, right: 24, fontSize: 7, color: '#7C3AED55', letterSpacing: 1, textAlign: 'right', lineHeight: 1.6 }}>
            CONNECT PHONE:<br />
            <span style={{ color: '#7C3AED99' }}>http://{localIP}:3000/phone</span>
          </div>
        )}

        {/* Voice bars */}
        <div style={{ position: 'absolute', bottom: 112, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 3, alignItems: 'flex-end', height: 20 }}>
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className={`voice-bar ${micOn ? 'active' : ''}`}
              style={{ height: micOn ? `${Math.max(3, Math.random() * 18)}px` : '3px' }} />
          ))}
        </div>

        {errorMsg && (
          <div style={{ position: 'absolute', bottom: 134, left: '50%', transform: 'translateX(-50%)', color: '#FF8C00', fontSize: 8, letterSpacing: 1, whiteSpace: 'nowrap' }}>
            {errorMsg}
          </div>
        )}

        <div style={{ position: 'absolute', bottom: 92, left: '50%', transform: 'translateX(-50%)', color: '#00E5FF66', fontSize: 9, letterSpacing: 2, whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {transcript}
        </div>

        <div style={{ position: 'absolute', bottom: 52, left: '50%', transform: 'translateX(-50%)', color: '#00E5FF', fontSize: 9, letterSpacing: 3, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
          <span className="status-dot" />
          {statusMsg}
        </div>

        {/* Buttons */}
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, pointerEvents: 'auto' }}>
          <button className="hud-btn" onClick={handleVoiceButton}
            style={{ border: `1.5px solid ${sessionActive ? '#FF2D9A' : '#00E5FF'}`, color: sessionActive ? '#FF2D9A' : '#00E5FF', background: sessionActive ? '#FF2D9A11' : 'transparent' }}>
            {sessionActive ? '⏹ STOP' : '🎙 VOICE'}
          </button>
          <button className="hud-btn" onClick={camOn ? stopCam : startCam}
            style={{ border: `1.5px solid ${camOn ? '#00FF88' : '#7C3AED'}`, color: camOn ? '#00FF88' : '#7C3AED', background: camOn ? '#00FF8811' : 'transparent' }}>
            {camOn ? '⏹ STOP' : '📷 CAM'}
          </button>
          <button className="hud-btn" onClick={stepsOn ? stopSteps : startSteps}
            style={{ border: `1.5px solid ${stepsOn ? (stepSim ? '#FF8C00' : '#00FF88') : '#FFD700'}`, color: stepsOn ? (stepSim ? '#FF8C00' : '#00FF88') : '#FFD700', background: stepsOn ? '#FFD70011' : 'transparent' }}>
            {stepsOn ? '⏹ STOP' : '👟 STEPS'}
          </button>
        </div>

      </div>
    </div>
  );
}