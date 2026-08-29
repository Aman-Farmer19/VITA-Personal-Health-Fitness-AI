
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { StepData } from '../lib/stepDetector';

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
  const ttsInFlightRef = useRef(false);

  // Gemini Live Transcription state
  const liveWsRef = useRef<WebSocket | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveAudioContextRef = useRef<AudioContext | null>(null);
  const liveSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const liveWorkletRef = useRef<AudioWorkletNode | null>(null);
  const liveSetupCompleteRef = useRef(false);
  const liveStoppingRef = useRef(false);
  const liveHasSpokenRef = useRef(false);
  const liveLastVoiceAtRef = useRef(0);
  const liveStartedAtRef = useRef(0);
  const liveFinalTextRef = useRef('');
  const liveFinalizingRef = useRef(false);
  const liveEndSentRef = useRef(false);
  const liveTurnCompletedRef = useRef(false);
  const liveWaitingForTurnCompleteRef = useRef(false);
  const liveLastFinalChunkRef = useRef('');

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
      liveStoppingRef.current = true;

      liveWorkletRef.current?.disconnect();
      liveSourceRef.current?.disconnect();
      liveStreamRef.current?.getTracks().forEach((track) => track.stop());

      if (liveWsRef.current && liveWsRef.current.readyState !== WebSocket.CLOSED) {
        try { liveWsRef.current.close(1000, 'component unmounted'); } catch { }
      }

      void liveAudioContextRef.current?.close();

      liveWsRef.current = null;
      liveTurnCompletedRef.current = false;
      liveWorkletRef.current = null;
      liveSourceRef.current = null;
      liveStreamRef.current = null;
      liveAudioContextRef.current = null;

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

  // ── PHASE 1: Voice / Gemini Live Transcription ───────────────────
  function pcm16ToBase64(input: Int16Array): string {
    const bytes = new Uint8Array(
      input.buffer,
      input.byteOffset,
      input.byteLength,
    );

    let binary = '';
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(
        i,
        Math.min(i + chunkSize, bytes.length),
      );

      for (let j = 0; j < chunk.length; j += 1) {
        binary += String.fromCharCode(chunk[j]);
      }
    }

    return btoa(binary);
  }

  const stopLiveTranscription = useCallback(async (
    sendStreamEnd = true,
    keepWebSocket = false,
  ) => {
    liveStoppingRef.current = true;

    const ws = liveWsRef.current;

    if (sendStreamEnd && ws?.readyState === WebSocket.OPEN) {
      liveEndSentRef.current = true;
      try {
        ws.send(
          JSON.stringify({
            realtimeInput: {
              audioStreamEnd: true,
            },
          }),
        );
        console.log('[VITA LIVE STT] audioStreamEnd sent');
      } catch { }
    }

    liveWorkletRef.current?.disconnect();
    liveSourceRef.current?.disconnect();

    liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveStreamRef.current = null;

    if (liveAudioContextRef.current) {
      await liveAudioContextRef.current.close().catch(() => undefined);
      liveAudioContextRef.current = null;
    }

    liveWorkletRef.current = null;
    liveSourceRef.current = null;
    liveSetupCompleteRef.current = false;

    if (
      !keepWebSocket &&
      ws &&
      ws.readyState !== WebSocket.CLOSED
    ) {
      try {
        ws.close(1000, 'VITA turn complete');
      } catch { }
    }

    if (!keepWebSocket) {
      liveWsRef.current = null;
    }
    setMicOn(false);
    setStatusMsg('VITA READY');
  }, []);

  const processLiveFinalTranscript = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || liveFinalizingRef.current) return;

    liveFinalizingRef.current = true;
    liveTurnCompletedRef.current = true;
    liveEndSentRef.current = true;
    liveWaitingForTurnCompleteRef.current = false;

    console.log('[VITA LIVE STT] final:', clean);
    setTranscript(`"${clean.toUpperCase()}"`);

    const normalized = clean
      .toLowerCase()
      .replace(/[^a-z\s']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      liveFinalizingRef.current = false;
      endSessionRef.current?.();
      return;
    }

    const timeSinceTts = performance.now() - lastTtsFinishedAtRef.current;

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

    if (likelyEcho || normalized.length < 2) {
      console.log('[VITA LIVE STT] ignoring likely echo/noise:', clean);
      liveFinalizingRef.current = false;
      endSessionRef.current?.();
      return;
    }

    if (
      /^(?:vita\s+)?stop(?:\s+now)?$/.test(normalized) ||
      /^stop(?:\s+the\s+)?session$/.test(normalized)
    ) {
      console.log('[VITA LIVE STT] STOP command detected');
      liveFinalizingRef.current = false;
      endSessionRef.current?.();
      return;
    }

    await stopLiveTranscription(true, true);

    if (!sessionActiveRef.current) {
      liveFinalizingRef.current = false;
      return;
    }

    await askVitaRef.current?.(clean);
    liveFinalizingRef.current = false;
  }, [stopLiveTranscription]);

  const startLiveTranscription = useCallback(async () => {
    if (!sessionActiveRef.current) return;
    if (liveWsRef.current || liveStreamRef.current) return;

    liveStoppingRef.current = false;
    liveHasSpokenRef.current = false;
    liveFinalTextRef.current = '';
    liveFinalizingRef.current = false;
    liveEndSentRef.current = false;
    liveTurnCompletedRef.current = false;
    liveWaitingForTurnCompleteRef.current = false;
    liveLastFinalChunkRef.current = '';
    liveStartedAtRef.current = performance.now();
    liveLastVoiceAtRef.current = liveStartedAtRef.current;

    try {
      setStatusMsg('GETTING LIVE STT TOKEN...');

      const tokenResponse = await fetch(
        '/api/transcribe-live-token',
        { cache: 'no-store' },
      );

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        throw new Error(
          tokenData?.error || 'Failed to obtain Gemini Live STT token.',
        );
      }

      const wsUrl = tokenData?.wsUrl;

      if (!wsUrl) {
        throw new Error('Live STT token response has no wsUrl.');
      }

      console.log('[VITA LIVE STT] token acquired');

      const ws = new WebSocket(wsUrl);
      liveWsRef.current = ws;

      // IMPORTANT: attach WebSocket handlers immediately.
      // The socket can reach OPEN while getUserMedia()/AudioWorklet setup
      // is awaiting. Registering onopen later can miss the OPEN event and
      // leave VITA stuck on "GETTING LIVE STT TOKEN...".
      ws.onopen = () => {
        console.log('[VITA LIVE STT] websocket connected');

        try {
          ws.send(
            JSON.stringify({
              setup: {
                model: 'models/gemini-3.5-transcribe-live',
                generationConfig: {
                  responseModalities: ['TEXT'],
                },
                inputAudioTranscription: {
                  languageCodes: ['en-IN'],
                  mode: 'VERBATIM',
                  customVocabulary: [
                    'VITA',
                    'Vita',
                    'Boss',
                    'step count',
                    'steps',
                    'step tracking',
                    'heart rate',
                    'calories',
                    'cadence',
                    'distance',
                    'workout',
                    'fitness',
                    'health',
                    'exercise',
                    'running',
                    'walking',
                    'activity',
                    'camera',
                    'phone',
                    'Gemini',
                    'ElevenLabs',
                    'Transcribe',
                  ],
                },
              },
            }),
          );

          setStatusMsg('STARTING LIVE STT...');
        } catch (error) {
          console.error('[VITA LIVE STT] setup send failed', error);
        }
      };

      ws.onmessage = async (event) => {
        let message: any;

        try {
          message =
            typeof event.data === 'string'
              ? JSON.parse(event.data)
              : JSON.parse(await new Response(event.data).text());
        } catch {
          return;
        }

        if (message?.setupComplete) {
          liveSetupCompleteRef.current = true;
          setMicOn(true);
          setStatusMsg('LISTENING...');
          setTranscript('— SPEAK TO VITA —');
          console.log('[VITA LIVE STT] setup complete');
          console.log('[VITA LIVE STT] microphone streaming');
          return;
        }

        if (message?.error) {
          console.error(
            '[VITA LIVE STT] server error:',
            message.error,
          );
          setErrorMsg(
            message.error?.message || 'LIVE TRANSCRIPTION ERROR',
          );
          setStatusMsg('VITA ERROR');
          await stopLiveTranscription(false);
          return;
        }

        const content = message?.serverContent;

        if (
          content?.interimInputTranscription?.text &&
          !liveTurnCompletedRef.current &&
          !liveWaitingForTurnCompleteRef.current
        ) {
          setTranscript(
            String(content.interimInputTranscription.text),
          );
          console.log(
            '[VITA LIVE STT] interim:',
            content.interimInputTranscription.text,
          );
        }

        if (
          content?.inputTranscription?.text &&
          !liveTurnCompletedRef.current
        ) {
          const finalChunk = String(
            content.inputTranscription.text,
          ).trim();

          if (
            finalChunk &&
            finalChunk !== liveLastFinalChunkRef.current
          ) {
            liveLastFinalChunkRef.current = finalChunk;

            liveFinalTextRef.current =
              `${liveFinalTextRef.current} ${finalChunk}`.trim();

            setTranscript(
              `"${liveFinalTextRef.current.toUpperCase()}"`,
            );

            console.log(
              '[VITA LIVE STT] final chunk:',
              finalChunk,
            );

            // Process the first authoritative final immediately. In this
            // one-shot VITA flow, waiting for a separate turnComplete event
            // can stall the Brain indefinitely.
            await processLiveFinalTranscript(
              liveFinalTextRef.current,
            );
          } else if (finalChunk) {
            console.log(
              '[VITA LIVE STT] duplicate final chunk ignored:',
              finalChunk,
            );
          }
        }

        if (content?.turnComplete) {
          console.log('[VITA LIVE STT] turn complete');
        }
      };

      ws.onerror = (event) => {
        console.error(
          '[VITA LIVE STT] websocket error',
          event,
        );
        setErrorMsg('LIVE STT CONNECTION ERROR');
        setStatusMsg('VITA ERROR');
      };

      ws.onclose = (event) => {
        console.log(
          '[VITA LIVE STT] websocket closed',
          event.code,
          event.reason,
        );

        liveSetupCompleteRef.current = false;

        if (
          sessionActiveRef.current &&
          !liveFinalizingRef.current
        ) {
          setStatusMsg('VITA READY');
        }
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      liveStreamRef.current = mediaStream;

      const audioContext = new AudioContext();
      liveAudioContextRef.current = audioContext;
      await audioContext.resume();

      await audioContext.audioWorklet.addModule('/vita-pcm-processor.js');

      const source = audioContext.createMediaStreamSource(mediaStream);
      const worklet = new AudioWorkletNode(
        audioContext,
        'vita-pcm-processor',
        {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1,
        },
      );

      liveSourceRef.current = source;
      liveWorkletRef.current = worklet;

      worklet.port.onmessage = (event: MessageEvent) => {
        if (
          liveStoppingRef.current ||
          !liveSetupCompleteRef.current ||
          ws.readyState !== WebSocket.OPEN
        ) {
          return;
        }

        const payload = event.data as {
          pcm16k: ArrayBuffer;
          rms: number;
        };

        if (!payload?.pcm16k) return;

        if (payload.rms > 0.02) {
          liveHasSpokenRef.current = true;
          liveLastVoiceAtRef.current = performance.now();

          if (threeRef.current) {
            threeRef.current.voiceAmp = Math.min(
              0.9,
              payload.rms * 5,
            );
          }
        }

        try {
          ws.send(
            JSON.stringify({
              realtimeInput: {
                audio: {
                  data: pcm16ToBase64(
                    new Int16Array(payload.pcm16k),
                  ),
                  mimeType: 'audio/pcm;rate=16000',
                },
              },
            }),
          );
        } catch (error) {
          console.error('[VITA LIVE STT] audio send failed', error);
        }

        if (
          liveHasSpokenRef.current &&
          !liveEndSentRef.current &&
          performance.now() - liveLastVoiceAtRef.current >= 1200 &&
          !liveFinalizingRef.current
        ) {
          liveEndSentRef.current = true;
          liveWaitingForTurnCompleteRef.current = true;

          console.log('[VITA LIVE STT] local silence detected');

          try {
            ws.send(
              JSON.stringify({
                realtimeInput: {
                  audioStreamEnd: true,
                },
              }),
            );
            console.log('[VITA LIVE STT] audioStreamEnd sent');
          } catch (error) {
            console.error(
              '[VITA LIVE STT] audioStreamEnd send failed',
              error,
            );
          }

          // Stop microphone capture now, but KEEP the WebSocket open.
          // Gemini still needs to send the final transcription + turnComplete.
          liveStoppingRef.current = true;
          liveWorkletRef.current?.disconnect();
          liveSourceRef.current?.disconnect();
          liveStreamRef.current?.getTracks().forEach((track) => track.stop());
          liveStreamRef.current = null;
          liveWorkletRef.current = null;
          liveSourceRef.current = null;
          setMicOn(false);
          return;
        }

        // Safety limit only. A normal utterance should end by silence first.
        // Keep this comfortably above the previous 7-second limit.
        if (
          !liveEndSentRef.current &&
          performance.now() - liveStartedAtRef.current >= 20000 &&
          !liveFinalizingRef.current
        ) {
          liveEndSentRef.current = true;
          liveWaitingForTurnCompleteRef.current = true;

          console.log('[VITA LIVE STT] safety max turn duration reached');

          try {
            ws.send(
              JSON.stringify({
                realtimeInput: {
                  audioStreamEnd: true,
                },
              }),
            );
            console.log('[VITA LIVE STT] audioStreamEnd sent');
          } catch (error) {
            console.error(
              '[VITA LIVE STT] audioStreamEnd send failed',
              error,
            );
          }

          liveStoppingRef.current = true;
          liveWorkletRef.current?.disconnect();
          liveSourceRef.current?.disconnect();
          liveStreamRef.current?.getTracks().forEach((track) => track.stop());
          liveStreamRef.current = null;
          liveWorkletRef.current = null;
          liveSourceRef.current = null;
          setMicOn(false);
          return;
        }
      };

      source.connect(worklet);

    } catch (error) {
      console.error('[VITA LIVE STT] start failed', error);
      setErrorMsg(
        error instanceof Error
          ? error.message
          : 'LIVE STT UNAVAILABLE',
      );

      await stopLiveTranscription(false);
      endSessionRef.current?.();
    }
  }, [processLiveFinalTranscript, stopLiveTranscription]);

  const speakVita = useCallback(async (text: string) => {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    if (!cleanText) return;

    if (ttsInFlightRef.current) {
      console.warn('[VITA TTS] Duplicate speak request ignored.');
      return;
    }

    ttsInFlightRef.current = true;

    const requestId = ++ttsRequestIdRef.current;

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
    console.log(
      `[VITA TTS] /api/speak request started (request=${requestId})`,
    );

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
          ttsInFlightRef.current = false;
          lastTtsFinishedAtRef.current = performance.now();

          ttsCooldownUntilRef.current = performance.now() + 1500;
          setStatusMsg('VITA READY');

          console.log(
            `[VITA TTS] /api/speak finished in ${Math.round(
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
          ttsInFlightRef.current = false;
          cleanup();
          reject(new Error('VITA streaming audio playback failed.'));
        };

        void audio.play().catch((error) => {
          if (settled) return;
          settled = true;
          ttsActiveRef.current = false;
          ttsInFlightRef.current = false;
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
      ttsInFlightRef.current = false;
      ttsCooldownUntilRef.current = performance.now() + 700;
      setStatusMsg('VITA ERROR');
      setErrorMsg('NEURAL TTS UNAVAILABLE');

      console.error('[VITA TTS] /api/speak failed:', error);
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
        `[VITA] /api/agent round trip: ${Math.round(
          performance.now() - started,
        )}ms`,
      );

      if (!res.ok) throw new Error(data.error || 'VITA agent failed');

      if (!sessionActiveRef.current) return null;

      const answer = String(data.answer ?? '').trim();
      setTranscript(`"${answer.toUpperCase()}"`);
      await speakVita(answer);

      if (sessionActiveRef.current) {
        endSessionRef.current?.();
      }

      return answer;
    } catch (error) {
      console.error('[VITA]', error);
      if (!sessionActiveRef.current) return null;

      setStatusMsg('AI OFFLINE');
      setErrorMsg('GEMINI TEMPORARILY UNAVAILABLE');

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

  // Start Live STT after the greeting.
  startMicRef.current = startLiveTranscription;

  const stopMic = useCallback(() => {
    void stopLiveTranscription(true);
  }, [stopLiveTranscription]);

  const endSession = useCallback(() => {
    if (!sessionActiveRef.current) return;

    sessionActiveRef.current = false;
    setSessionActive(false);
    ttsActiveRef.current = false;
    ttsInFlightRef.current = false;
    ttsCooldownUntilRef.current = 0;

    void stopLiveTranscription(false);

    setStatusMsg('VITA READY');
    setTranscript('— SESSION ENDED —');
    console.log('[VITA SESSION] OFF');

    window.dispatchEvent(new Event('vita:session-ended'));
  }, [stopLiveTranscription]);

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
      const { StepDetector } = await import('../lib/stepDetector');
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