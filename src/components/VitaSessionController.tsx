'use client';

import { useCallback, useEffect, useRef } from 'react';

interface VitaSpeechRecognitionAlternative {
  readonly transcript: string;
}

interface VitaSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: {
      readonly length: number;
      readonly 0: VitaSpeechRecognitionAlternative;
    };
  };
}

interface VitaSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface VitaSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onresult: ((event: VitaSpeechRecognitionEvent) => void) | null;
  onerror: ((event: VitaSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => VitaSpeechRecognition;
type VitaWindow = Window & typeof globalThis & {
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
};

const STOP_PHRASE = /\bvita\s+stop\s+now\b/i;

// Browser Web Speech often hears "Vita" as "beta", "bita", "veta", etc.
// Keep the wake word tolerant, but still require the two-word "hello <name>" shape.
const WAKE_NAME_VARIANTS = new Set([
  'vita',
  'beta',
  'bita',
  'veta',
  'vida',
  'veeta',
  'vitta',
  'beeta',
]);

function isWakePhrase(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length < 2 || words[0] !== 'hello') return false;
  return WAKE_NAME_VARIANTS.has(words[1]);
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning, Boss.';
  if (hour < 17) return 'Good afternoon, Boss.';
  if (hour < 21) return 'Good evening, Boss.';
  return 'Good night, Boss.';
}

async function getFemaleVoice(): Promise<SpeechSynthesisVoice | null> {
  if (!('speechSynthesis' in window)) return null;

  const speech = window.speechSynthesis;
  let voices = speech.getVoices();

  if (!voices.length) {
    voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        speech.removeEventListener('voiceschanged', finish);
        resolve(speech.getVoices());
      };
      speech.addEventListener('voiceschanged', finish);
      window.setTimeout(finish, 2000);
    });
  }

  const patterns = [
    /google uk english female/i,
    /microsoft zira/i,
    /microsoft heera/i,
    /microsoft aria/i,
    /jenny/i,
    /samantha/i,
    /susan/i,
    /hazel/i,
    /female|woman|girl/i,
  ];

  const english = voices.filter((voice) => /^en(?:-|_)/i.test(voice.lang));

  for (const pattern of patterns) {
    const voice = english.find((candidate) => pattern.test(candidate.name) || pattern.test(candidate.voiceURI || ''));
    if (voice) return voice;
  }

  return null;
}

function getVoiceButton() {
  return document.querySelector<HTMLButtonElement>('.hud-btn');
}

function getStatusText() {
  const known = new Set([
    'VITA READY',
    'VITA ONLINE',
    'LISTENING...',
    'TRANSCRIBING...',
    'VITA THINKING...',
    'VITA SPEAKING...',
  ]);
  return Array.from(document.querySelectorAll('div, span')).find(
    (node) => known.has(node.textContent?.trim() ?? ''),
  )?.textContent?.trim() ?? '';
}

function getTranscriptText() {
  return Array.from(document.querySelectorAll('div, span')).find((node) => {
    const text = node.textContent?.trim() ?? '';
    return text.startsWith('"') && text.endsWith('"') && text.length > 2;
  })?.textContent?.trim() ?? '';
}

export default function VitaSessionController() {
  const activeRef = useRef(false);
  const controllerClickRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const recognitionRef = useRef<VitaSpeechRecognition | null>(null);
  const startingRef = useRef(false);
  const micReadyRef = useRef(false);
  const lastTranscriptRef = useRef('');
  const greetingRef = useRef(false);
  const ttsCooldownRef = useRef(false);

  const speechBusy = useCallback(() => {
    if (!('speechSynthesis' in window)) return false;
    const speech = window.speechSynthesis;
    return speech.speaking || speech.pending || greetingRef.current || ttsCooldownRef.current;
  }, []);

  const stopWakeRecognition = useCallback(() => {
    startingRef.current = false;
    try { recognitionRef.current?.abort(); } catch { }
    recognitionRef.current = null;
  }, []);

  const clickVoiceButton = useCallback(() => {
    const button = getVoiceButton();
    if (!button) {
      console.warn('[VITA SESSION] Voice button not found.');
      return;
    }
    controllerClickRef.current = true;
    button.click();
    window.setTimeout(() => { controllerClickRef.current = false; }, 100);
  }, []);

  const speakGreeting = useCallback(async () => {
    if (!('speechSynthesis' in window)) return;

    const speech = window.speechSynthesis;
    speech.cancel();
    speech.resume();

    const voice = await getFemaleVoice();
    const text = `${getGreeting()} What we are gonna do today, Boss?`;
    const utterance = new SpeechSynthesisUtterance(text);

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      const retry = await getFemaleVoice();
      if (!retry) {
        console.warn('[VITA SESSION] No female English voice available; skipping greeting rather than using an arbitrary voice.');
        return;
      }
      utterance.voice = retry;
      utterance.lang = retry.lang;
    }

    utterance.rate = 0.98;
    utterance.pitch = 1.06;
    utterance.volume = 1;

    console.log('[VITA SESSION] Greeting voice:', `${utterance.voice?.name ?? 'unknown'} (${utterance.voice?.lang ?? 'unknown'})`);

    greetingRef.current = true;
    ttsCooldownRef.current = true;

    await new Promise<void>((resolve) => {
      const clear = () => {
        greetingRef.current = false;
        window.setTimeout(() => {
          ttsCooldownRef.current = false;
          resolve();
        }, 900);
      };
      utterance.onend = clear;
      utterance.onerror = clear;
      speech.speak(utterance);
    });
  }, []);

  const activateSession = useCallback(async () => {
    if (activeRef.current || speechBusy()) return;

    activeRef.current = true;
    stopWakeRecognition();
    console.log('[VITA SESSION] ACTIVE');

    await speakGreeting();

    if (activeRef.current && !speechBusy()) {
      window.setTimeout(() => {
        if (activeRef.current && !speechBusy()) clickVoiceButton();
      }, 300);
    }
  }, [clickVoiceButton, speakGreeting, speechBusy, stopWakeRecognition]);

  const armWakeListener = useCallback(async () => {
    if (activeRef.current || recognitionRef.current || startingRef.current || speechBusy()) return;

    const w = window as VitaWindow;
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Recognition) {
      console.warn('[VITA WAKE] SpeechRecognition unavailable.');
      return;
    }

    if (!micReadyRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        micReadyRef.current = true;
      } catch (error) {
        console.warn('[VITA WAKE] Microphone permission unavailable:', error);
        return;
      }
    }

    if (speechBusy()) return;

    startingRef.current = true;
    const recognition = new Recognition();
    // Wake listening is a single short utterance. Continuous mode caused
    // unnecessary no-speech restart churn in Chrome.
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      startingRef.current = false;
      console.log('[VITA WAKE] LISTENING — say "Hello Vita"');
    };

    recognition.onaudiostart = () => console.log('[VITA WAKE] microphone active');

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const text = result?.[0]?.transcript?.trim() ?? '';
      if (!text || activeRef.current || speechBusy()) return;
      console.log('[VITA WAKE]', text);
      if (isWakePhrase(text)) {
        void activateSession();
      }
    };

    recognition.onerror = (event) => {
      startingRef.current = false;
      recognitionRef.current = null;

      if (event.error !== 'no-speech') {
        console.warn('[VITA WAKE ERROR]', event.error);
      }

      if (activeRef.current || event.error === 'not-allowed' || event.error === 'service-not-allowed') return;

      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = window.setTimeout(() => { void armWakeListener(); }, event.error === 'no-speech' ? 2500 : 1200);
    };

    recognition.onend = () => {
      startingRef.current = false;
      recognitionRef.current = null;
      if (!activeRef.current && !speechBusy()) {
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => { void armWakeListener(); }, 500);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (error) {
      startingRef.current = false;
      recognitionRef.current = null;
      console.warn('[VITA WAKE] start() failed:', error);
    }
  }, [activateSession, speechBusy]);

  const deactivateSession = useCallback(() => {
    activeRef.current = false;
    greetingRef.current = false;
    ttsCooldownRef.current = false;
    stopWakeRecognition();

    const button = getVoiceButton();
    if ((button?.textContent ?? '').includes('STOP')) clickVoiceButton();

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    }

    console.log('[VITA SESSION] OFF');
    window.setTimeout(() => { void armWakeListener(); }, 700);
  }, [armWakeListener, clickVoiceButton, stopWakeRecognition]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('.hud-btn');
      if (!button || button !== getVoiceButton() || controllerClickRef.current) return;
      const label = button.textContent?.trim() ?? '';

      if (!activeRef.current && label.includes('VOICE')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void activateSession();
        return;
      }

      if (activeRef.current && label.includes('STOP')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        deactivateSession();
      }
    };

    document.addEventListener('click', onDocumentClick, true);
    return () => document.removeEventListener('click', onDocumentClick, true);
  }, [activateSession, deactivateSession]);

  useEffect(() => {
    let lastStatus = '';

    const tick = () => {
      if (activeRef.current) {
        const status = getStatusText();
        const transcript = getTranscriptText();

        if (transcript && transcript !== lastTranscriptRef.current) {
          lastTranscriptRef.current = transcript;
          if (STOP_PHRASE.test(transcript)) {
            deactivateSession();
            return;
          }
        }

        if (status === 'VITA READY' && lastStatus !== 'VITA READY' && !speechBusy()) {
          window.setTimeout(() => {
            if (activeRef.current && !speechBusy()) clickVoiceButton();
          }, 900);
        }

        lastStatus = status;
      }

      statusTimerRef.current = window.setTimeout(tick, 250);
    };

    tick();
    return () => {
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
    };
  }, [clickVoiceButton, deactivateSession, speechBusy]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => { void armWakeListener(); }, 900);

    return () => {
      window.clearTimeout(kickoff);
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
      stopWakeRecognition();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [armWakeListener, stopWakeRecognition]);

  return null;
}
