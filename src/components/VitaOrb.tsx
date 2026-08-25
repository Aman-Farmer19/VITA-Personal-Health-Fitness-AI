'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { StepData } from '@/lib/stepDetector';

interface MoodEntry { label: string; hex: string; threeHex: number; stress: string; sw: number; mw: number; }
const MOODS: Record<string, MoodEntry> = {
  happy: { label: 'HAPPY', hex: '#00FF88', threeHex: 0x00FF88, stress: 'LOW', sw: 15, mw: 95 },
  sad: { label: 'MELANCHOLY', hex: '#4488FF', threeHex: 0x4488FF, stress: 'MODERATE', sw: 50, mw: 35 },
  angry: { label: 'STRESSED', hex: '#FF2D2D', threeHex: 0xFF2D2D, stress: 'HIGH', sw: 88, mw: 20 },
  fearful: { label: 'ANXIOUS', hex: '#FF8C00', threeHex: 0xFF8C00, stress: 'HIGH', sw: 75, mw: 30 },
  disgusted: { label: 'UNEASY', hex: '#FF6644', threeHex: 0xFF6644, stress: 'MODERATE', sw: 55, mw: 40 },
  surprised: { label: 'ALERT', hex: '#FFD700', threeHex: 0xFFD700, stress: 'LOW', sw: 20, mw: 80 },
  neutral: { label: 'CALM', hex: '#00E5FF', threeHex: 0x00E5FF, stress: 'LOW', sw: 18, mw: 70 },
};
const ACT_COLOR: Record<string, string> = { IDLE: '#00E5FF', WALKING: '#00FF88', RUNNING: '#FFD700' };

export default function VitaOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const faceApiRef = useRef<any>(null);
  const detectTimer = useRef<any>(null);
  const simMoodTimer = useRef<any>(null);
  const simEI = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const motionRef = useRef<any>(null);
  const simStepTimer = useRef<any>(null);
  const stepDetRef = useRef<any>(null);
  const audioRef = useRef<any>(null);
  const ttsActiveRef = useRef(false);
  const ttsVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

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
  const [stepSim, setStepSim] = useState(false);
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const threeRef = useRef<any>(null);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      const voices = window.speechSynthesis.getVoices();
      setTtsVoices(voices);
      const female = voices.find(v => /google uk english female|microsoft zira|microsoft heera|aria|jenny|samantha|susan|hazel|female|woman|girl/i.test(v.name) && /^en(-|_)/i.test(v.lang));
      if (female) ttsVoiceRef.current = female;
      console.log('[VITA] Available voices:', voices.map(v => `${v.name} (${v.lang})`));
      if (female) console.log('[VITA] Locked voice:', female.name, female.lang);
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  useEffect(() => {
    fetch('/api/local-ip').then(r => r.json()).then(d => setLocalIP(d.ip)).catch(() => {});
  }, []);

  useEffect(() => {
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(`ws://${window.location.host}/vita-ws?type=laptop`);
      wsRef.current = ws;
      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'steps') {
            setStepData(msg);
            if (threeRef.current) {
              threeRef.current.stepBoost = 1;
              threeRef.current.activityLevel = msg.activity === 'RUNNING' ? 2 : msg.activity === 'WALKING' ? 1 : 0;
            }
          }
          if (msg.type === 'phone_connected') setPhoneLinked(true);
          if (msg.type === 'phone_disconnected') setPhoneLinked(false);
        } catch {}
      };
      ws.onclose = () => { if (!disposed) reconnect = setTimeout(connect, 3000); };
    };
    connect();
    return () => { disposed = true; if (reconnect) clearTimeout(reconnect); wsRef.current?.close(); };
  }, []);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    let cancelled = false;
    let resizeHandler: (() => void) | null = null;
    async function init() {
      await document.fonts.load('700 16px "Space Mono"');
      if (cancelled) return;
      const THREE = await import('three');
      const { EffectComposer } = await import('three/examples/jsm/postprocessing/EffectComposer.js');
      const { RenderPass } = await import('three/examples/jsm/postprocessing/RenderPass.js');
      const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js');
      const { OutputPass } = await import('three/examples/jsm/postprocessing/OutputPass.js');
      if (cancelled) return;
      const container = containerRef.current!;
      const canvas = canvasRef.current!;
      const W = container.offsetWidth, H = container.offsetHeight;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      renderer.setSize(W, H);
      renderer.setPixelRatio(1);
      renderer.toneMapping = THREE.ReinhardToneMapping;
      renderer.toneMappingExposure = 0.9;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x050510);
      const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
      camera.position.set(0, 0, 6);
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.28, 0.72);
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
      const group = new THREE.Group();
      scene.add(group);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xFF2D9A });
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 24), coreMat);
      group.add(core);
      const glows: any[] = [];
      for (let i = 1; i <= 4; i++) {
        const g = new THREE.Mesh(new THREE.SphereGeometry(0.7 + i * 0.18, 20, 20), new THREE.MeshBasicMaterial({ color: 0xFF2D9A, transparent: true, opacity: 0.12 / i, side: THREE.BackSide }));
        group.add(g); glows.push(g);
      }
      const s1m = new THREE.MeshBasicMaterial({ color: 0x7C3AED, wireframe: true, transparent: true, opacity: 0.55 });
      const s2m = new THREE.MeshBasicMaterial({ color: 0x00E5FF, wireframe: true, transparent: true, opacity: 0.30 });
      const s3m = new THREE.MeshBasicMaterial({ color: 0xFF2D9A, wireframe: true, transparent: true, opacity: 0.12 });
      const sh1 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 1), s1m);
      const sh2 = new THREE.Mesh(new THREE.IcosahedronGeometry(2.15, 1), s2m);
      const sh3 = new THREE.Mesh(new THREE.IcosahedronGeometry(2.55, 0), s3m);
      group.add(sh1, sh2, sh3);
      const mkR = (r: number, tb: number, col: number, op: number, rx: number, ry: number, rz: number) => {
        const m = new THREE.Mesh(new THREE.TorusGeometry(r, tb, 12, 96), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op }));
        m.rotation.set(rx, ry, rz); return m;
      };
      const ri1 = mkR(2.9, 0.018, 0x00E5FF, 0.8, Math.PI / 2.5, 0.2, 0);
      const ri2 = mkR(3.3, 0.012, 0xFF2D9A, 0.6, Math.PI / 4, Math.PI / 5, 0.3);
      const ri3 = mkR(3.7, 0.008, 0x7C3AED, 0.4, -Math.PI / 6, Math.PI / 3, -0.2);
      group.add(ri1, ri2, ri3);
      const orbs: any[] = [];
      for (let i = 0; i < 10; i++) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xFF2D9A : 0x00E5FF }));
        d.userData = { angle: (i / 10) * Math.PI * 2, speed: 0.3 + Math.random() * 0.4, radius: 2.9, tilt: Math.random() * 0.5 };
        group.add(d); orbs.push(d);
      }
      const pp = new Float32Array(4500);
      for (let i = 0; i < pp.length; i++) pp[i] = (Math.random() - 0.5) * 30;
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
      scene.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x8888aa, size: 0.025, transparent: true, opacity: 0.45 })));
      const state = { renderer, composer, scene, camera, core, coreMat, glows, sh1, sh2, sh3, s1m, s2m, s3m, ri1, ri2, ri3, orbs, voiceAmp: 0, stepBoost: 0, moodColor: 0xFF2D9A, activityLevel: 0, mx: 0, my: 0, tx: 0, ty: 0, t: 0, animId: 0 };
      threeRef.current = state;
      const mouse = (e: MouseEvent) => { const r = container.getBoundingClientRect(); state.mx = ((e.clientX - r.left) / r.width - 0.5) * 2; state.my = -((e.clientY - r.top) / r.height - 0.5) * 2; };
      container.addEventListener('mousemove', mouse);
      let lastFrame = 0;
      const animate = () => {
        state.animId = requestAnimationFrame(animate);
        state.t += 0.012;
        state.tx += (state.mx * 0.6 - state.tx) * 0.04;
        state.ty += (state.my * 0.4 - state.ty) * 0.04;
        camera.position.x = state.tx; camera.position.y = state.ty; camera.lookAt(0, 0, 0);
        const actBoost = 1 + state.activityLevel * 1.5;
        const sp = (1 + state.voiceAmp * 4) * actBoost;
        const pulse = (1 + Math.sin(state.t * 2.5) * 0.06) * (1 + state.voiceAmp * 2) * (1 + state.stepBoost * 0.4);
        core.scale.setScalar(pulse);
        bloomPass.strength = Math.min(0.45 + state.voiceAmp * 0.65 + state.stepBoost * 0.35, 1.35);
        const mc = new THREE.Color(state.moodColor);
        coreMat.color.lerp(mc, 0.05);
        glows.forEach((g, i) => { g.material.opacity = 0.12 / (i + 1) + state.voiceAmp * 0.08 + state.stepBoost * 0.05; g.scale.setScalar(1 + state.voiceAmp * 0.5 + state.stepBoost * 0.2); g.material.color.lerp(mc, 0.03); });
        sh1.rotation.x += 0.004 * sp; sh1.rotation.y += 0.006 * sp;
        sh2.rotation.x -= 0.003 * sp; sh2.rotation.y -= 0.005 * sp;
        sh3.rotation.y += 0.002 * sp; sh3.rotation.z += 0.003 * sp;
        ri1.rotation.z += 0.008 * sp; ri2.rotation.z -= 0.006 * sp; ri3.rotation.x += 0.004 * sp;
        if (state.activityLevel === 2) { s1m.color.setHex(0xFFD700); s2m.color.setHex(0xFF8C00); }
        else if (state.activityLevel === 1) { s1m.color.setHex(0x00FF88); s2m.color.setHex(0x00E5FF); }
        else if (state.voiceAmp > 0.1) { s1m.color.setHex(0xFF2D9A); s2m.color.setHex(0xFF8C00); }
        else { s1m.color.setHex(0x7C3AED); s2m.color.setHex(0x00E5FF); }
        orbs.forEach(d => { d.userData.angle += d.userData.speed * 0.012 * sp; const a = d.userData.angle, rv = d.userData.radius; d.position.x = Math.cos(a) * rv; d.position.y = Math.sin(a * 0.5) * rv * d.userData.tilt; d.position.z = Math.sin(a) * rv; });
        state.voiceAmp *= 0.88; state.stepBoost *= 0.85;
        const now = performance.now();
        if (now - lastFrame >= 33) { lastFrame = now; composer.render(); }
      };
      animate();
      resizeHandler = () => { const w = container.offsetWidth, h = container.offsetHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); composer.setSize(w, h); bloomPass.resolution.set(w, h); };
      window.addEventListener('resize', resizeHandler);
    }
    requestAnimationFrame(() => requestAnimationFrame(init));
    return () => { cancelled = true; if (resizeHandler) window.removeEventListener('resize', resizeHandler); if (threeRef.current) { cancelAnimationFrame(threeRef.current.animId); threeRef.current.renderer.dispose(); threeRef.current.composer.dispose(); } };
  }, []);

  useEffect(() => { const id = setInterval(() => setHeartRate(68 + Math.floor(Math.random() * 16)), 3000); return () => clearInterval(id); }, []);

  const chooseVoice = useCallback(() => {
    if (ttsVoiceRef.current) return ttsVoiceRef.current;
    const voices = ttsVoices.length ? ttsVoices : window.speechSynthesis.getVoices();
    const female = voices.find(v => /google uk english female|microsoft zira|microsoft heera|aria|jenny|samantha|susan|hazel|female|woman|girl/i.test(v.name) && /^en(-|_)/i.test(v.lang));
    if (female) ttsVoiceRef.current = female;
    return female ?? null;
  }, [ttsVoices]);

  const speakVita = useCallback(async (text: string) => {
    if (!('speechSynthesis' in window)) return;
    const speech = window.speechSynthesis;
    speech.cancel(); speech.resume();
    const voice = chooseVoice();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    else utterance.lang = 'en-IN';
    utterance.rate = 0.94; utterance.pitch = 1.06; utterance.volume = 1;
    ttsActiveRef.current = true;
    setStatusMsg('VITA SPEAKING...');
    if (threeRef.current) threeRef.current.voiceAmp = 0.25;
    console.log('[VITA] Speaking:', text);
    console.log('[VITA] Selected voice:', voice ? `${voice.name} (${voice.lang})` : 'en-IN fallback');
    await new Promise<void>(resolve => {
      utterance.onend = () => { ttsActiveRef.current = false; setStatusMsg('VITA READY'); if (threeRef.current) threeRef.current.voiceAmp = 0; setTimeout(resolve, 1000); };
      utterance.onerror = e => { console.error('[VITA TTS ERROR]', e); ttsActiveRef.current = false; setStatusMsg('VITA READY'); if (threeRef.current) threeRef.current.voiceAmp = 0; resolve(); };
      speech.speak(utterance);
    });
  }, [chooseVoice]);

  const askVita = useCallback(async (message: string) => {
    try {
      setStatusMsg('VITA THINKING...');
      const vitaState = { steps: stepData.steps, cadence: stepData.cadence, activity: stepData.activity, distance: stepData.distance, calories: stepData.calories, mood: mood.label, expression, heartRate: null, micOn, camOn, stepsOn, phoneLinked, timestamp: new Date().toISOString() };
      const started = performance.now();
      const res = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, vitaState }) });
      const data = await res.json();
      console.log(`[VITA] /api/agent round trip: ${Math.round(performance.now() - started)}ms`);
      if (!res.ok) throw new Error(data.error || 'VITA agent failed');
      setTranscript(`"${data.answer}"`);
      await speakVita(data.answer);
      return data.answer;
    } catch (error) {
      console.error('[VITA]', error); setStatusMsg('VITA ERROR'); setErrorMsg('AI AGENT UNAVAILABLE'); return null;
    }
  }, [stepData, mood, expression, micOn, camOn, stepsOn, phoneLinked, speakVita]);

  const startMic = useCallback(async () => {
    if (ttsActiveRef.current || window.speechSynthesis?.speaking) {
      console.log('[VITA] Mic start blocked while TTS is active.');
      return;
    }
    if (audioRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 } });
      if (ttsActiveRef.current || window.speechSynthesis?.speaking) { stream.getTracks().forEach(t => t.stop()); return; }
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.65;
      const data = new Uint8Array(analyser.fftSize);
      ctx.createMediaStreamSource(stream).connect(analyser);
      let rafId = 0;
      const tick = () => { rafId = requestAnimationFrame(tick); analyser.getByteFrequencyData(data); if (threeRef.current) { let sum = 0; for (const v of data) sum += v; threeRef.current.voiceAmp = Math.min(sum / data.length / 128, 1); } };
      tick();
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        try {
          if (audioRef.current?.recorder !== recorder) return;
          setStatusMsg('TRANSCRIBING...'); setErrorMsg('');
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          if (!blob.size) throw new Error('Empty recording');
          const formData = new FormData(); formData.append('audio', blob, 'vita-voice.webm');
          const started = performance.now();
          const response = await fetch('/api/transcribe', { method: 'POST', body: formData });
          const data = await response.json();
          console.log(`[VITA] Whisper round trip: ${Math.round(performance.now() - started)}ms`);
          if (!response.ok) throw new Error(data.error || 'Transcription failed');
          const text = String(data.text || '').trim();
          if (!text) { setTranscript('— DID NOT CATCH THAT —'); setStatusMsg('VITA READY'); return; }
          console.log('[VITA] Whisper:', text);
          setTranscript(`"${text.toUpperCase()}"`);
          await askVita(text);
        } catch (error) {
          console.error('[VITA TRANSCRIPTION]', error); setStatusMsg('VITA ERROR'); setErrorMsg('TRANSCRIPTION FAILED');
        } finally {
          cancelAnimationFrame(rafId); stream.getTracks().forEach(t => t.stop()); try { await ctx.close(); } catch {}
          if (threeRef.current) threeRef.current.voiceAmp = 0;
          audioRef.current = null; setMicOn(false);
        }
      };
      let lastVoiceAt = 0;
      let hasSpoken = false;
      const recordingStartedAt = performance.now();
      const SILENCE_THRESHOLD = 0.045;
      const SILENCE_DURATION = 1250;
      const MIN_RECORDING_TIME = 750;
      const MAX_RECORDING_TIME = 20000;
      const detectSilence = () => {
        if (!audioRef.current || audioRef.current.recorder !== recorder) return;
        const now = performance.now();
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) { const n = (data[i] - 128) / 128; sumSquares += n * n; }
        const rms = Math.sqrt(sumSquares / data.length);
        if (rms > SILENCE_THRESHOLD) { hasSpoken = true; lastVoiceAt = now; }
        const duration = now - recordingStartedAt;
        const silence = hasSpoken ? now - lastVoiceAt : 0;
        if (hasSpoken && duration >= MIN_RECORDING_TIME && silence >= SILENCE_DURATION) { console.log('[VITA] Natural pause detected → stopping recording'); recorder.stop(); return; }
        if (duration >= MAX_RECORDING_TIME) { console.log('[VITA] Max recording duration reached'); recorder.stop(); return; }
        audioRef.current.silenceRaf = requestAnimationFrame(detectSilence);
      };
      audioRef.current = { ctx, analyser, data, rafId, stream, recorder, chunks, silenceRaf: 0 };
      recorder.start(120);
      audioRef.current.silenceRaf = requestAnimationFrame(detectSilence);
      setMicOn(true); setStatusMsg('LISTENING...'); setTranscript('— SPEAK TO VITA —'); setErrorMsg('');
    } catch (error) {
      console.error('[VITA MICROPHONE]', error); setMicOn(false); setErrorMsg('MICROPHONE UNAVAILABLE'); setStatusMsg('VITA READY');
    }
  }, [askVita]);

  const stopMic = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) { setMicOn(false); return; }
    try { if (audio.silenceRaf) cancelAnimationFrame(audio.silenceRaf); if (audio.recorder?.state !== 'inactive') { setStatusMsg('TRANSCRIBING...'); audio.recorder.stop(); } }
    catch (error) { console.error('[VITA STOP MIC]', error); audio.stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop()); audio.ctx?.close(); audioRef.current = null; setMicOn(false); setStatusMsg('VITA READY'); }
  }, []);

  const applyMood = useCallback((key: string) => { const m = MOODS[key] || MOODS.neutral; setMood(m); setExpression(key.toUpperCase()); if (threeRef.current) threeRef.current.moodColor = m.threeHex; }, []);
  const startSimMood = useCallback(() => { const keys = Object.keys(MOODS); const next = () => { applyMood(keys[simEI.current % keys.length]); simEI.current++; simMoodTimer.current = setTimeout(next, 2500); }; next(); }, [applyMood]);
  const startCam = useCallback(async () => {
    if (!faceApiRef.current) { try { const fa = await import('face-api.js'); const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'; await Promise.all([fa.nets.tinyFaceDetector.loadFromUri(MODEL_URL), fa.nets.faceExpressionNet.loadFromUri(MODEL_URL)]); faceApiRef.current = fa; } catch { faceApiRef.current = null; } }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) { videoRef.current.srcObject = stream; await new Promise<void>(r => { videoRef.current!.onloadedmetadata = () => r(); }); }
      setCamOn(true); setErrorMsg('');
      if (faceApiRef.current) { const fa = faceApiRef.current; const loop = async () => { if (!videoRef.current?.srcObject) return; try { const det = await fa.detectSingleFace(videoRef.current, new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 })).withFaceExpressions(); if (det) { const dom = Object.entries(det.expressions).sort((a: any, b: any) => b[1] - a[1])[0]; if ((dom[1] as number) > 0.3) applyMood(dom[0]); } } catch {} detectTimer.current = setTimeout(loop, 250); }; loop(); }
      else { setErrorMsg('AI MODELS FAILED — FEED ONLY'); startSimMood(); }
    } catch (err: any) { setCamOn(true); setErrorMsg(err.name === 'NotAllowedError' ? 'CAM DENIED — DEMO MOOD' : 'CAM UNAVAIL — DEMO MOOD'); startSimMood(); }
  }, [applyMood, startSimMood]);
  const stopCam = useCallback(() => { if (detectTimer.current) clearTimeout(detectTimer.current); if (simMoodTimer.current) clearTimeout(simMoodTimer.current); if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop()); if (videoRef.current) videoRef.current.srcObject = null; setExpression(''); applyMood('neutral'); setCamOn(false); setErrorMsg(''); }, [applyMood]);

  const startSteps = useCallback(async () => {
    try {
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') { const p = await (DeviceMotionEvent as any).requestPermission(); if (p !== 'granted') throw new Error('denied'); }
      if (!('DeviceMotionEvent' in window)) throw new Error('unsupported');
      const { StepDetector } = await import('@/lib/stepDetector'); const det = new StepDetector(); stepDetRef.current = det; det.reset();
      det.onStep = data => { setStepData(data); if (threeRef.current) { threeRef.current.stepBoost = 1; threeRef.current.activityLevel = data.activity === 'RUNNING' ? 2 : data.activity === 'WALKING' ? 1 : 0; } };
      const handler = (e: DeviceMotionEvent) => { const a = e.accelerationIncludingGravity || e.acceleration; if (a?.x != null) det.update(a.x!, a.y!, a.z!); };
      window.addEventListener('devicemotion', handler); motionRef.current = handler; setStepsOn(true); setStepSim(false); setStatusMsg('TRACKING STEPS...'); setErrorMsg('');
    } catch {
      setStepsOn(true); setStepSim(true); setErrorMsg('NO SENSOR — SIMULATING'); setStatusMsg('SIM WALKING...'); let ss = 0; const st: number[] = [];
      const tick = () => { const now = Date.now(); st.push(now); if (st.length > 8) st.shift(); let cad = 0; if (st.length >= 2) { const span = (st[st.length - 1] - st[0]) / 1000; cad = Math.round((st.length - 1) / span * 60); } ss++; const act = cad >= 120 ? 'RUNNING' : cad >= 60 ? 'WALKING' : 'IDLE'; const d: StepData = { steps: ss, cadence: cad, activity: act as any, distance: parseFloat((ss * 0.000762).toFixed(2)), calories: Math.round(ss * 0.04) }; setStepData(d); if (threeRef.current) { threeRef.current.stepBoost = 1; threeRef.current.activityLevel = act === 'RUNNING' ? 2 : act === 'WALKING' ? 1 : 0; } simStepTimer.current = setTimeout(tick, 580 + Math.sin(ss * 0.3) * 120 + Math.random() * 80); }; simStepTimer.current = setTimeout(tick, 600);
    }
  }, []);
  const stopSteps = useCallback(() => { if (motionRef.current) { window.removeEventListener('devicemotion', motionRef.current); motionRef.current = null; } if (simStepTimer.current) clearTimeout(simStepTimer.current); stepDetRef.current?.reset(); setStepData({ steps: 0, cadence: 0, activity: 'IDLE', distance: 0, calories: 0 }); if (threeRef.current) { threeRef.current.activityLevel = 0; threeRef.current.stepBoost = 0; } setStepsOn(false); setStepSim(false); setStatusMsg('VITA ONLINE'); setErrorMsg(''); }, []);

  const goalPct = Math.min(stepData.steps / 10000, 1);
  const circumf = 2 * Math.PI * 44;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100vw', height: '100vh', background: '#050510', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0 }} />
      <video ref={videoRef} autoPlay muted playsInline style={{ position: 'absolute', bottom: 115, left: 24, width: 106, height: 106, borderRadius: '50%', objectFit: 'cover', transform: 'scaleX(-1)', border: '2px solid #00E5FF', display: camOn ? 'block' : 'none' }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: "'Space Mono','Courier New',monospace" }}>
        <div className="hud-corner tl" /><div className="hud-corner tr" /><div className="hud-corner bl" /><div className="hud-corner br" />
        <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', color: '#00E5FF', fontSize: 24, fontWeight: 700, letterSpacing: 16, whiteSpace: 'nowrap' }}>VITA</div>
        <div style={{ position: 'absolute', top: 54, left: '50%', transform: 'translateX(-50%)', color: '#7C3AED', fontSize: 9, letterSpacing: 5, whiteSpace: 'nowrap' }}>HEALTH &amp; FITNESS AI</div>
        <div style={{ position: 'absolute', top: 20, right: 56, color: '#7C3AED', fontSize: 8, letterSpacing: 2 }}>PHASE 4</div>
        {phoneLinked && <div style={{ position: 'absolute', top: 36, right: 56, color: '#00FF88', fontSize: 7, letterSpacing: 2 }}>📱 PHONE LINKED</div>}
        <div className="scan-line" />
        <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: 20, display: 'flex', flexDirection: 'column', gap: 13 }}>
          {[{ label: 'HEART RATE', value: `${heartRate} BPM`, pct: heartRate, color: '#FF2D9A' }, { label: 'STEPS TODAY', value: stepData.steps.toLocaleString(), pct: goalPct * 100, color: '#FFD700' }, { label: 'DISTANCE', value: `${stepData.distance} km`, pct: goalPct * 80, color: '#00E5FF' }, { label: 'CALORIES', value: `${stepData.calories} kcal`, pct: goalPct * 70, color: '#7C3AED' }].map(({ label, value, pct, color }) => <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ fontSize: 8, color: '#7C3AED', letterSpacing: 2 }}>{label}</span><span style={{ fontSize: 13, color, fontWeight: 700 }}>{value}</span><div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${pct}%`, background: color }} /></div></div>)}
        </div>
        <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: 20, display: 'flex', flexDirection: 'column', gap: 13, textAlign: 'right' }}>
          {[{ label: 'MOOD', value: mood.label, color: mood.hex, pct: mood.mw }, { label: 'STRESS INDEX', value: mood.stress, color: '#FF8C00', pct: mood.sw }, { label: 'ACTIVITY', value: stepData.activity, color: ACT_COLOR[stepData.activity], pct: stepData.activity === 'RUNNING' ? 95 : stepData.activity === 'WALKING' ? 50 : 5 }, { label: 'CADENCE', value: `${stepData.cadence} spm`, color: '#FFD700', pct: Math.min(stepData.cadence / 180 * 100, 100) }].map(({ label, value, color, pct }) => <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}><span style={{ fontSize: 8, color: '#7C3AED', letterSpacing: 2 }}>{label}</span><span style={{ fontSize: 13, color, fontWeight: 700 }}>{value}</span><div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${pct}%`, background: color }} /></div></div>)}
        </div>
        {camOn && expression && <div style={{ position: 'absolute', bottom: 226, left: 24, fontSize: 7, letterSpacing: 2, color: mood.hex, border: `1px solid ${mood.hex}`, padding: '3px 8px', borderRadius: 2 }}>{expression}</div>}
        {stepsOn && <div style={{ position: 'absolute', bottom: 115, right: 24, width: 100, height: 100 }}><svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}><circle cx="50" cy="50" r="44" fill="none" stroke="#1a0a2e" strokeWidth="5" /><circle cx="50" cy="50" r="44" fill="none" stroke={goalPct >= 1 ? '#00FF88' : '#FFD700'} strokeWidth="5" strokeDasharray={circumf} strokeDashoffset={circumf * (1 - goalPct)} strokeLinecap="round" transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.5s' }} /><text x="50" y="46" textAnchor="middle" fill="#FFD700" fontSize="9" fontFamily="'Space Mono',monospace" fontWeight="700">{goalPct >= 1 ? 'GOAL!' : 'GOAL'}</text><text x="50" y="60" textAnchor="middle" fill="#00E5FF" fontSize="7" fontFamily="'Space Mono',monospace">{Math.round(goalPct * 100)}%</text></svg></div>}
        {!phoneLinked && localIP && !stepsOn && <div style={{ position: 'absolute', bottom: 115, right: 24, fontSize: 7, color: '#7C3AED55', letterSpacing: 1, textAlign: 'right', lineHeight: 1.6 }}>CONNECT PHONE:<br /><span style={{ color: '#7C3AED99' }}>http://{localIP}:3000/phone</span></div>}
        <div style={{ position: 'absolute', bottom: 112, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 3, alignItems: 'flex-end', height: 20 }}>{Array.from({ length: 14 }).map((_, i) => <div key={i} className={`voice-bar ${micOn ? 'active' : ''}`} style={{ height: micOn ? `${4 + ((i * 7) % 15)}px` : '3px' }} />)}</div>
        {errorMsg && <div style={{ position: 'absolute', bottom: 134, left: '50%', transform: 'translateX(-50%)', color: '#FF8C00', fontSize: 8, letterSpacing: 1, whiteSpace: 'nowrap' }}>{errorMsg}</div>}
        <div style={{ position: 'absolute', bottom: 92, left: '50%', transform: 'translateX(-50%)', color: '#00E5FF66', fontSize: 9, letterSpacing: 2, whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{transcript}</div>
        <div style={{ position: 'absolute', bottom: 52, left: '50%', transform: 'translateX(-50%)', color: '#00E5FF', fontSize: 9, letterSpacing: 3, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}><span className="status-dot" />{statusMsg}</div>
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, pointerEvents: 'auto' }}>
          <button className="hud-btn" onClick={micOn ? stopMic : startMic} style={{ border: `1.5px solid ${micOn ? '#FF2D9A' : '#00E5FF'}`, color: micOn ? '#FF2D9A' : '#00E5FF', background: micOn ? '#FF2D9A11' : 'transparent' }}>{micOn ? '⏹ STOP' : '🎙 VOICE'}</button>
          <button className="hud-btn" onClick={camOn ? stopCam : startCam} style={{ border: `1.5px solid ${camOn ? '#00FF88' : '#7C3AED'}`, color: camOn ? '#00FF88' : '#7C3AED', background: camOn ? '#00FF8811' : 'transparent' }}>{camOn ? '⏹ STOP' : '📷 CAM'}</button>
          <button className="hud-btn" onClick={stepsOn ? stopSteps : startSteps} style={{ border: `1.5px solid ${stepsOn ? (stepSim ? '#FF8C00' : '#00FF88') : '#FFD700'}`, color: stepsOn ? (stepSim ? '#FF8C00' : '#00FF88') : '#FFD700', background: stepsOn ? '#FFD70011' : 'transparent' }}>{stepsOn ? '⏹ STOP' : '👟 STEPS'}</button>
        </div>
      </div>
    </div>
  );
}
