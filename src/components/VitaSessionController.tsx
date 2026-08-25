'use client';

import { useCallback, useEffect, useRef } from 'react';

type RecognitionCtor = new () => SpeechRecognition;

type VitaWindow = Window & typeof globalThis & {
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
};

const STOP_PHRASE = /\bvita\s+stop\s+now\b/i;
const WAKE_PHRASE = /\bhello\s+(vita|veeta|beta)\b/i;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning, Boss.';
  if (hour < 17) return 'Good afternoon, Boss.';
  if (hour < 21) return 'Good evening, Boss.';
  return 'Good night, Boss.';
}

function getVoice(): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find(v => /aria|jenny|samantha|susan|hazel|zira/i.test(v.name) && /^en(-|_)/i.test(v.lang)) ??
    voices.find(v => /^en(-|_)/i.test(v.lang)) ??
    null
  );
}

function getVoiceButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.hud-btn');
}

function getStatusText(): string {
  const known = new Set(['VITA READY', 'VITA ONLINE', 'LISTENING...', 'TRANSCRIBING...']);
  const nodes = Array.from(document.querySelectorAll('div, span'));
  return nodes.find(node => known.has(node.textContent?.trim() ?? ''))?.textContent?.trim() ?? '';
}

function getTranscriptText(): string {
  const nodes = Array.from(document.querySelectorAll('div, span'));
  return nodes.find(node => {
    const text = node.textContent?.trim() ?? '';
    return text.startsWith('"') && text.endsWith('"') && text.length > 2;
  })?.textContent?.trim() ?? '';
}

export default function VitaSessionController() {
  const activeRef = useRef(false);
  const controllerClickRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const lastTranscriptRef = useRef('');
  const greetingRef = useRef(false);

  const clickVoiceButton = useCallback(() => {
    const button = getVoiceButton();
    if (!button) return;
    controllerClickRef.current = true;
    button.click();
    window.setTimeout(() => { controllerClickRef.current = false; }, 80);
  }, []);

  const stopWakeRecognition = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    recognitionRef.current = null;
  }, []);

  const speakGreeting = useCallback(async () => {
    if (!('speechSynthesis' in window)) return;

    const speech = window.speechSynthesis;
    speech.cancel();
    speech.resume();

    const voice = getVoice();
    const utterance = new SpeechSynthesisUtterance(
      `${getGreeting()} What we are gonna do today, Boss?`,
    );
    utterance.voice = voice;
    utterance.lang = voice?.lang ?? 'en-IN';
    utterance.rate = 0.98;
    utterance.pitch = 1.06;
    utterance.volume = 1;

    greetingRef.current = true;
    await new Promise<void>(resolve => {
      utterance.onend = () => { greetingRef.current = false; resolve(); };
      utterance.onerror = () => { greetingRef.current = false; resolve(); };
      window.setTimeout(() => {
        speech.resume();
        speech.speak(utterance);
      }, 0);
    });
  }, []);

  const activateSession = useCallback(async () => {
    activeRef.current = true;
    stopWakeRecognition();
    console.log('[VITA SESSION] ACTIVE');
    await speakGreeting();
    if (!activeRef.current) return;
    window.setTimeout(() => {
      if (activeRef.current && !greetingRef.current) clickVoiceButton();
    }, 120);
  }, [clickVoiceButton, speakGreeting, stopWakeRecognition]);

  const startWakeRecognition = useCallback(() => {
    if (activeRef.current || recognitionRef.current) return;

    const vitaWindow = window as VitaWindow;
    const Recognition = vitaWindow.SpeechRecognition ?? vitaWindow.webkitSpeechRecognition;
    if (!Recognition) {
      console.warn('[VITA WAKE] SpeechRecognition unavailable in this browser.');
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';

    recognition.onresult = event => {
      const result = event.results[event.results.length - 1];
      const text = result?.[0]?.transcript?.trim() ?? '';
      if (!text || activeRef.current) return;
      console.log('[VITA WAKE]', text);
      if (WAKE_PHRASE.test(text)) void activateSession();
    };

    recognition.onerror = event => {
      console.warn('[VITA WAKE ERROR]', event.error);
      recognitionRef.current = null;
      if (!activeRef.current) restartTimerRef.current = window.setTimeout(startWakeRecognition, 1200);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (!activeRef.current) restartTimerRef.current = window.setTimeout(startWakeRecognition, 500);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      console.log('[VITA SESSION] Wake listener active — say "Hello Vita"');
    } catch {
      recognitionRef.current = null;
      if (!activeRef.current) restartTimerRef.current = window.setTimeout(startWakeRecognition, 1200);
    }
  }, [activateSession]);

  const deactivateSession = useCallback(() => {
    activeRef.current = false;
    greetingRef.current = false;
    stopWakeRecognition();

    const button = getVoiceButton();
    if ((button?.textContent ?? '').includes('STOP')) clickVoiceButton();

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    }

    console.log('[VITA SESSION] OFF');
    window.setTimeout(startWakeRecognition, 300);
  }, [clickVoiceButton, startWakeRecognition, stopWakeRecognition]);

  // Intercept the VITA voice button so manual activation follows the same
  // session lifecycle as the wake word. The actual recorder remains in
  // VitaOrb; this controller only owns session state and orchestration.
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

  // Keep the active session alive: after each successful response, start the
  // next listening turn automatically. The stop phrase is handled locally.
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

        if (status === 'VITA READY' && lastStatus !== 'VITA READY' && !greetingRef.current) {
          window.setTimeout(() => {
            if (activeRef.current && !greetingRef.current) clickVoiceButton();
          }, 180);
        }

        lastStatus = status;
      }

      statusTimerRef.current = window.setTimeout(tick, 250);
    };

    tick();
    return () => {
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
    };
  }, [clickVoiceButton, deactivateSession]);

  useEffect(() => {
    const kickoff = window.setTimeout(startWakeRecognition, 700);
    return () => {
      window.clearTimeout(kickoff);
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
      stopWakeRecognition();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [startWakeRecognition, stopWakeRecognition]);

  return null;
}
