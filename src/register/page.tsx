'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const CAPTURES_NEEDED = 5;
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';
const STORAGE_KEY = 'vita_face_identity';

type Stage = 'cam_loading' | 'model_loading' | 'ready' | 'capturing' | 'done' | 'existing' | 'error';

export default function RegisterPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceApiRef = useRef<any>(null);
  const descriptorsRef = useRef<number[][]>([]);

  const [stage, setStage] = useState<Stage>('cam_loading');
  const [status, setStatus] = useState('STARTING CAMERA...');
  const [captures, setCaptures] = useState(0);
  const [progress, setProgress] = useState('');

  // ── Step 1: Start camera immediately ───────────────────────────
  useEffect(() => {
    // Already registered?
    if (localStorage.getItem(STORAGE_KEY)) {
      setStage('existing');
      setStatus('FACE ALREADY REGISTERED');
      return;
    }

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
          };
        }
        setStage('model_loading');
        setStatus('CAMERA READY — LOADING AI...');
        loadModels();
      } catch (err: any) {
        setStage('error');
        setStatus('CAMERA ERROR: ' + err.message);
      }
    }

    async function loadModels() {
      try {
        setProgress('DOWNLOADING MODELS (10-20s on first run)...');
        const fa = await import('face-api.js');
        await fa.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        setProgress('FACE DETECTOR ✓ — LOADING LANDMARKS...');
        await fa.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
        setProgress('LANDMARKS ✓ — LOADING RECOGNITION...');
        await fa.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        setProgress('');
        faceApiRef.current = fa;
        setStage('ready');
        setStatus('LOOK AT THE CAMERA — PRESS CAPTURE');
      } catch (err: any) {
        setStage('error');
        setStatus('MODEL LOAD FAILED: ' + err.message);
        setProgress('Check internet connection and refresh');
      }
    }

    startCamera();
  }, []);

  // ── Capture ─────────────────────────────────────────────────────
  const capture = useCallback(async () => {
    if (!faceApiRef.current || !videoRef.current) return;
    if (stage !== 'ready') return;

    setStage('capturing');
    setStatus('SCANNING FACE...');

    try {
      const fa = faceApiRef.current;
      const vid = videoRef.current;

      const det = await fa
        .detectSingleFace(vid, new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!det) {
        setStage('ready');
        setStatus('NO FACE DETECTED — LOOK DIRECTLY AT CAMERA');
        return;
      }

      const descriptor = Array.from(det.descriptor) as number[];
      descriptorsRef.current.push(descriptor);
      const count = descriptorsRef.current.length;
      setCaptures(count);

      if (count < CAPTURES_NEEDED) {
        setStage('ready');
        const tips = [
          'GOOD! NOW TILT HEAD SLIGHTLY LEFT',
          'GOOD! NOW TILT HEAD SLIGHTLY RIGHT',
          'GOOD! NOW LOOK SLIGHTLY UP',
          'ALMOST DONE! LOOK STRAIGHT AHEAD',
        ];
        setStatus(`CAPTURED ${count}/${CAPTURES_NEEDED} — ${tips[count - 1] || 'CAPTURE AGAIN'}`);
      } else {
        // Save all descriptors
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          label: 'AMAN',
          descriptors: descriptorsRef.current,
          registeredAt: new Date().toISOString(),
        }));
        // Stop camera
        const stream = videoRef.current?.srcObject as MediaStream;
        stream?.getTracks().forEach(t => t.stop());

        setStage('done');
        setStatus('FACE REGISTERED! VITA WILL RECOGNISE YOU.');
      }
    } catch (err: any) {
      setStage('ready');
      setStatus('SCAN ERROR — TRY AGAIN (' + err.message + ')');
    }
  }, [stage]);

  // ── Keyboard shortcut: Space to capture ─────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && stage === 'ready') {
        e.preventDefault();
        void capture();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, capture]);

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  // ── Colours ─────────────────────────────────────────────────────
  const COLOR: Record<Stage, string> = {
    cam_loading: '#7C3AED',
    model_loading: '#FFD700',
    ready: '#00E5FF',
    capturing: '#FF2D9A',
    done: '#00FF88',
    existing: '#00FF88',
    error: '#FF2D2D',
  };
  const color = COLOR[stage];
  const pct = Math.min((captures / CAPTURES_NEEDED) * 100, 100);
  const circ = 2 * Math.PI * 44;

  return (
    <div style={{
      minHeight: '100vh', background: '#050510',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Space Mono','Courier New',monospace",
      color: '#00E5FF', padding: 24, userSelect: 'none',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes flash { 0%{opacity:1} 50%{opacity:.2} 100%{opacity:1} }
      `}</style>

      {/* Title */}
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 14, color: '#00E5FF', marginBottom: 4 }}>
        VITA
      </div>
      <div style={{ fontSize: 9, letterSpacing: 5, color: '#7C3AED', marginBottom: 40 }}>
        FACE REGISTRATION
      </div>

      {/* Camera circle + progress ring */}
      <div style={{ position: 'relative', marginBottom: 28 }}>

        {/* Video feed */}
        <div style={{
          width: 220, height: 220, borderRadius: '50%', overflow: 'hidden',
          border: `2px solid ${color}`, background: '#0a0a1a',
          transition: 'border-color .4s, box-shadow .4s',
          boxShadow: `0 0 30px ${color}33`,
        }}>
          {/* Video — hidden when done */}
          <video
            ref={videoRef}
            autoPlay muted playsInline
            style={{
              width: '100%', height: '100%', objectFit: 'cover',
              transform: 'scaleX(-1)',
              display: (stage === 'done' || stage === 'existing') ? 'none' : 'block',
            }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Checkmark when done */}
          {(stage === 'done' || stage === 'existing') && (
            <div style={{
              width: '100%', height: '100%', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 80, color: '#00FF88',
            }}>✓</div>
          )}

          {/* Loading spinner overlay */}
          {(stage === 'cam_loading' || stage === 'model_loading') && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: '#05051088', borderRadius: '50%',
            }}>
              <div style={{
                width: 36, height: 36,
                border: '2px solid #7C3AED44',
                borderTop: '2px solid #7C3AED',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }} />
            </div>
          )}

          {/* Flash on capture */}
          {stage === 'capturing' && (
            <div style={{
              position: 'absolute', inset: 0, background: '#ffffff22',
              borderRadius: '50%', animation: 'flash .3s ease',
            }} />
          )}
        </div>

        {/* SVG progress ring */}
        <svg viewBox="0 0 100 100"
          style={{ position: 'absolute', inset: -10, width: 240, height: 240, pointerEvents: 'none' }}>
          <circle cx="50" cy="50" r="44" fill="none" stroke="#1a0a2e" strokeWidth="2" />
          <circle cx="50" cy="50" r="44" fill="none"
            stroke={color} strokeWidth="2.5"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct / 100)}
            strokeLinecap="round" transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dashoffset .5s ease, stroke .4s' }}
          />
        </svg>
      </div>

      {/* Status */}
      <div style={{
        fontSize: 9, letterSpacing: 2, color,
        textAlign: 'center', maxWidth: 320,
        minHeight: 40, marginBottom: 6,
        transition: 'color .4s', lineHeight: 1.8,
      }}>
        {status}
      </div>

      {/* Model loading progress */}
      {progress && (
        <div style={{
          fontSize: 7, color: '#7C3AED', letterSpacing: 1,
          textAlign: 'center', marginBottom: 8,
          animation: 'blink 1.5s infinite',
        }}>
          {progress}
        </div>
      )}

      {/* Counter */}
      <div style={{ fontSize: 8, color: '#7C3AED', letterSpacing: 2, marginBottom: 28 }}>
        {(stage === 'done' || stage === 'existing')
          ? '● REGISTRATION COMPLETE'
          : `${captures} / ${CAPTURES_NEEDED} CAPTURES`}
      </div>

      {/* ── CAPTURE BUTTON ── */}
      {stage === 'ready' && (
        <button
          onClick={() => void capture()}
          style={{
            background: 'transparent',
            border: '2px solid #00E5FF',
            color: '#00E5FF',
            fontFamily: "'Space Mono',monospace",
            fontSize: 12, fontWeight: 700, letterSpacing: 4,
            padding: '14px 48px', borderRadius: 3,
            cursor: 'pointer', marginBottom: 10,
            boxShadow: '0 0 20px #00E5FF22',
            transition: 'all .2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#00E5FF22')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          📸 CAPTURE
        </button>
      )}

      {stage === 'capturing' && (
        <div style={{ color: '#FF2D9A', fontSize: 11, letterSpacing: 4, animation: 'blink .5s infinite' }}>
          ● SCANNING...
        </div>
      )}

      {stage === 'model_loading' && (
        <div style={{ color: '#FFD700', fontSize: 9, letterSpacing: 3, animation: 'blink 1s infinite' }}>
          LOADING AI MODELS — PLEASE WAIT
        </div>
      )}

      {stage === 'cam_loading' && (
        <div style={{ color: '#7C3AED', fontSize: 9, letterSpacing: 3 }}>
          REQUESTING CAMERA ACCESS...
        </div>
      )}

      {/* Done / Existing */}
      {(stage === 'done' || stage === 'existing') && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <a href="/"
            style={{
              display: 'inline-block', textDecoration: 'none',
              border: '2px solid #00FF88', color: '#00FF88',
              fontFamily: "'Space Mono',monospace",
              fontSize: 12, fontWeight: 700, letterSpacing: 4,
              padding: '14px 48px', borderRadius: 3,
              background: '#00FF8811',
            }}>
            🔮 LAUNCH VITA
          </a>
          <button onClick={reset} style={{
            background: 'transparent', border: '1px solid #7C3AED22',
            color: '#7C3AED55', fontFamily: "'Space Mono',monospace",
            fontSize: 7, letterSpacing: 2, padding: '6px 16px',
            borderRadius: 2, cursor: 'pointer',
          }}>
            RE-REGISTER FACE
          </button>
        </div>
      )}

      {stage === 'error' && (
        <button onClick={reset} style={{
          background: 'transparent', border: '1.5px solid #FF2D2D',
          color: '#FF2D2D', fontFamily: "'Space Mono',monospace",
          fontSize: 9, letterSpacing: 2,
          padding: '10px 28px', borderRadius: 2, cursor: 'pointer',
        }}>
          RETRY
        </button>
      )}

      {/* Tips */}
      {stage === 'ready' && (
        <div style={{
          marginTop: 32, fontSize: 7, color: '#7C3AED33',
          letterSpacing: 1, textAlign: 'center', lineHeight: 2.4,
        }}>
          FACE CAMERA · PRESS CAPTURE · OR PRESS SPACEBAR<br />
          TAKE 5 PHOTOS FROM SLIGHTLY DIFFERENT ANGLES<br />
          GOOD LIGHTING = BETTER RECOGNITION<br />
          DATA STAYS ON YOUR DEVICE ONLY
        </div>
      )}
    </div>
  );
}