
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { StepDetector, type StepData } from '../../lib/stepDetector';

type ConnState = 'connecting' | 'connected' | 'disconnected' | 'error';
type TrackState = 'idle' | 'active' | 'denied' | 'unsupported';

export default function PhonePage() {
  const [connState, setConnState] = useState<ConnState>('connecting');
  const [trackState, setTrackState] = useState<TrackState>('idle');
  const [stepData, setStepData] = useState<StepData>({ steps: 0, cadence: 0, activity: 'IDLE', distance: 0, calories: 0 });
  const [laptopIP, setLaptopIP] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const detectorRef = useRef(new StepDetector());
  const motionRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequenceRef = useRef(0);
  const disposedRef = useRef(false);

  const connect = useCallback(() => {
    if (disposedRef.current) return;

    if (wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    setConnState('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    const ws = new WebSocket(
      `${protocol}//${window.location.host}/vita-ws?type=phone`
    );
    wsRef.current = ws;

    ws.onopen = () => {
      sequenceRef.current = 0;
      setConnState('connected');
      ws.send(JSON.stringify({
        type: 'phone_ready',
        source: 'phone',
        protocol: 'vita-phone-v1',
        timestamp: Date.now(),
        sequence: ++sequenceRef.current,
      }));
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      setConnState('disconnected');

      if (!disposedRef.current) {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => setConnState('error');
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    connect();
    fetch('/api/local-ip').then(r => r.json()).then(d => setLaptopIP(d.ip)).catch(() => { });

    return () => {
      disposedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  function send(data: Record<string, unknown>) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        ...data,
        source: 'phone',
        protocol: 'vita-phone-v1',
        timestamp: Date.now(),
        sequence: ++sequenceRef.current,
      }));
    }
  }

  const startTracking = useCallback(async () => {
    console.log('[VITA PHONE] START TRACKING clicked');

    try {
      // Check browser support first.
      if (typeof window === 'undefined') return;

      if (!('DeviceMotionEvent' in window)) {
        console.error('[VITA PHONE] DeviceMotionEvent unavailable');
        setTrackState('unsupported');
        return;
      }

      console.log('[VITA PHONE] DeviceMotionEvent available');

      // iOS requires explicit permission.
      const MotionEvent = DeviceMotionEvent as any;

      if (typeof MotionEvent.requestPermission === 'function') {
        console.log('[VITA PHONE] requesting motion permission...');

        const permission = await MotionEvent.requestPermission();

        console.log('[VITA PHONE] motion permission:', permission);

        if (permission !== 'granted') {
          setTrackState('denied');
          return;
        }
      } else {
        // Android/Chrome normally comes through here.
        console.log('[VITA PHONE] explicit motion permission not required');
      }

      const detector = detectorRef.current;

      detector.reset();

      detector.onStep = (data) => {
        console.log('[VITA PHONE] STEP:', data);

        setStepData(data);

        send({
          type: 'steps',
          ...data,
        });
      };

      const handler = (e: DeviceMotionEvent) => {
        const a = e.accelerationIncludingGravity || e.acceleration;

        if (!a) {
          console.warn('[VITA PHONE] motion event received without acceleration');
          return;
        }

        if (a.x == null || a.y == null || a.z == null) {
          console.warn('[VITA PHONE] acceleration values unavailable');
          return;
        }

        detector.update(
          a.x,
          a.y,
          a.z
        );
      };

      // Remove an old listener if one somehow exists.
      if (motionRef.current) {
        window.removeEventListener(
          'devicemotion',
          motionRef.current
        );
      }

      motionRef.current = handler;

      window.addEventListener(
        'devicemotion',
        handler,
        { passive: true }
      );

      // IMPORTANT:
      // Update the UI immediately after successfully registering
      // the sensor listener.
      setTrackState('active');

      send({
        type: 'tracking_started',
      });

      console.log('[VITA PHONE] ✅ motion tracking ACTIVE');

    } catch (error) {
      console.error('[VITA PHONE] START TRACKING ERROR:', error);
      setTrackState('denied');
    }
  }, []);

  const stopTracking = useCallback(() => {
    if (motionRef.current) {
      window.removeEventListener('devicemotion', motionRef.current);
      motionRef.current = null;
    }
    detectorRef.current.reset();
    setStepData({ steps: 0, cadence: 0, activity: 'IDLE', distance: 0, calories: 0 });
    setTrackState('idle');
    send({ type: 'tracking_stopped' });
  }, []);

  const connColour: Record<ConnState, string> = {
    connecting: '#FFD700',
    connected: '#00FF88',
    disconnected: '#FF2D9A',
    error: '#FF2D2D',
  };
  const actColour: Record<string, string> = {
    IDLE: '#00E5FF',
    WALKING: '#00FF88',
    RUNNING: '#FFD700',
  };

  const goalPct = Math.min((stepData.steps / 10000) * 100, 100);
  const circumference = 2 * Math.PI * 44;

  return (
    <div style={{
      minHeight: '100vh', background: '#050510', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px', fontFamily: "'Space Mono','Courier New',monospace", color: '#00E5FF',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 14, color: '#00E5FF', marginBottom: 6 }}>VITA</div>
        <div style={{ fontSize: 9, letterSpacing: 5, color: '#7C3AED' }}>PHONE SENSOR MODULE</div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 9, letterSpacing: 3, marginBottom: 32,
        color: connColour[connState],
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: connColour[connState],
          boxShadow: `0 0 8px ${connColour[connState]}`,
          animation: connState === 'connected' ? 'pulse 1.5s infinite' : 'none',
          flexShrink: 0,
        }} />
        {connState === 'connecting' && 'CONNECTING TO VITA...'}
        {connState === 'connected' && 'LINKED TO LAPTOP ✓'}
        {connState === 'disconnected' && 'RECONNECTING...'}
        {connState === 'error' && 'CONNECTION ERROR'}
      </div>

      <div style={{ position: 'relative', width: 160, height: 160, marginBottom: 28 }}>
        <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
          <circle cx="50" cy="50" r="44" fill="none" stroke="#1a0a2e" strokeWidth="5" />
          <circle
            cx="50" cy="50" r="44"
            fill="none"
            stroke={goalPct >= 100 ? '#00FF88' : '#FFD700'}
            strokeWidth="5"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - goalPct / 100)}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.5s' }}
          />
          <text x="50" y="44" textAnchor="middle" fill="#FFD700" fontSize="9"
            fontFamily="'Space Mono',monospace" fontWeight="700">
            {goalPct >= 100 ? 'GOAL!' : 'GOAL'}
          </text>
          <text x="50" y="56" textAnchor="middle" fill="#00E5FF" fontSize="14"
            fontFamily="'Space Mono',monospace" fontWeight="700">
            {stepData.steps.toLocaleString()}
          </text>
          <text x="50" y="66" textAnchor="middle" fill="#7C3AED" fontSize="7"
            fontFamily="'Space Mono',monospace">
            {Math.round(goalPct)}%
          </text>
        </svg>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: '16px 28px', marginBottom: 32, width: '100%', maxWidth: 280,
      }}>
        {[
          { label: 'ACTIVITY', value: stepData.activity, color: actColour[stepData.activity] },
          { label: 'CADENCE', value: `${stepData.cadence} spm`, color: '#FFD700' },
          { label: 'DISTANCE', value: `${stepData.distance} km`, color: '#00E5FF' },
          { label: 'CALORIES', value: `${stepData.calories} kcal`, color: '#7C3AED' },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: 7, color: '#7C3AED', letterSpacing: 2, marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {trackState === 'idle' && (
        <button
          className="phone-btn"
          onClick={() => {
            console.log('[VITA PHONE] BUTTON CLICKED');

            // Prove the React event is working.
            setTrackState('active');

            // Then start the actual sensor.
            startTracking();
          }}
          style={{
            borderColor: '#FFD700',
            color: '#FFD700',
            cursor: 'pointer',
            touchAction: 'manipulation',
          }}
        >
          👟 START TRACKING
        </button>
      )}

      {trackState === 'active' && (
        <button className="phone-btn" onClick={stopTracking}
          style={{ borderColor: '#FF2D9A', color: '#FF2D9A', animation: 'pulse 1.5s infinite' }}>
          ⏹ STOP TRACKING
        </button>
      )}
      {trackState === 'denied' && (
        <div style={{ color: '#FF8C00', fontSize: 9, letterSpacing: 2, textAlign: 'center' }}>
          MOTION PERMISSION DENIED<br />
          <span style={{ color: '#7C3AED' }}>Enable in iPhone Settings → Safari → Motion</span>
        </div>
      )}
      {trackState === 'unsupported' && (
        <div style={{ color: '#FF2D2D', fontSize: 9, letterSpacing: 2, textAlign: 'center' }}>
          MOTION SENSOR NOT AVAILABLE<br />
          <span style={{ color: '#7C3AED' }}>Try opening in Safari on iPhone</span>
        </div>
      )}

      <div style={{ marginTop: 32, fontSize: 7, color: '#7C3AED33', letterSpacing: 2, textAlign: 'center' }}>
        LAPTOP: {laptopIP}:3000<br />
        VITA PHONE MODULE v1.0
      </div>

      <style>{`
        @keyframes pulse {
          0%,100% { box-shadow: 0 0 0 0 currentColor44; }
          50%      { box-shadow: 0 0 0 8px transparent; }
        }
      `}</style>
    </div>
  );
}