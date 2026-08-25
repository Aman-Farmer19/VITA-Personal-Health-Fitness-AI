'use client';

import { useCallback, useEffect, useRef } from 'react';

type RecognitionCtor = new () => SpeechRecognition;
type VitaWindow = Window & typeof globalThis & {
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
};

const STOP_PHRASE = /\bvita\s+stop\s+now\b/i;
const WAKE_PHRASE = /\bhello\s+(vita|veeta|beta)\b/i;

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning, Boss.';
  if (hour < 17) return 'Good afternoon, Boss.';
  if (hour < 21) return 'Good evening, Boss.';
  return 'Good night, Boss.';
}

function getVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find(v => /aria|jenny|samantha|susan|hazel|zira/i.test(v.name) && /^en(-|_)/i.test(v.lang)) ?? voices.find(v => /^en(-|_)/i.test(v.lang)) ?? null;
}

function getVoiceButton() { return document.querySelector<HTMLButtonElement>('.hud-btn'); }
function getStatusText() {
  const known = new Set(['VITA READY', 'VITA ONLINE', 'LISTENING...', 'TRANSCRIBING...']);
  return Array.from(document.querySelectorAll('div, span')).find(n => known.has(n.textContent?.trim() ?? ''))?.textContent?.trim() ?? '';
}
function getTranscriptText() {
  return Array.from(document.querySelectorAll('div, span')).find(n => {
    const t = n.textContent?.trim() ?? '';
    return t.startsWith('"') && t.endsWith('"') && t.length > 2;
  })?.textContent?.trim() ?? '';
}

export default function VitaSessionController() {
  const activeRef = useRef(false);
  const controllerClickRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const startingRef = useRef(false);
  const micReadyRef = useRef(false);
  const lastTranscriptRef = useRef('');
  const greetingRef = useRef(false);

  const stopWakeRecognition = useCallback(() => {
    startingRef.current = false;
    try { recognitionRef.current?.abort(); } catch {}
    recognitionRef.current = null;
  }, []);

  const clickVoiceButton = useCallback(() => {
    const button = getVoiceButton();
    if (!button) { console.warn('[VITA SESSION] Voice button not found.'); return; }
    controllerClickRef.current = true;
    button.click();
    window.setTimeout(() => { controllerClickRef.current = false; }, 100);
  }, []);

  const speakGreeting = useCallback(async () => {
    if (!('speechSynthesis' in window)) return;
    const speech = window.speechSynthesis;
    speech.cancel();
    speech.resume();
    const voice = getVoice();
    const utterance = new SpeechSynthesisUtterance(`${getGreeting()} What we are gonna do today, Boss?`);
    utterance.voice = voice;
    utterance.lang = voice?.lang ?? 'en-IN';
    utterance.rate = 0.98;
    utterance.pitch = 1.06;
    utterance.volume = 1;
    greetingRef.current = true;
    await new Promise<void>(resolve => {
      utterance.onend = () => { greetingRef.current = false; resolve(); };
      utterance.onerror = () => { greetingRef.current = false; resolve(); };
      window.setTimeout(() => { speech.resume(); speech.speak(utterance); }, 0);
    });
  }, []);

  const activateSession = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    stopWakeRecognition();
    console.log('[VITA SESSION] ACTIVE');
    await speakGreeting();
    if (activeRef.current) window.setTimeout(() => { if (activeRef.current && !greetingRef.current) clickVoiceButton(); }, 180);
  }, [clickVoiceButton, speakGreeting, stopWakeRecognition]);

  const armWakeListener = useCallback(async () => {
    if (activeRef.current || recognitionRef.current || startingRef.current) return;
    const w = window as VitaWindow;
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Recognition) { console.warn('[VITA WAKE] SpeechRecognition unavailable.'); return; }

    if (!micReadyRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        micReadyRef.current = true;
        console.log('[VITA WAKE] Microphone permission ready.');
      } catch (error) {
        console.warn('[VITA WAKE] Microphone permission unavailable:', error);
        return;
      }
    }

    startingRef.current = true;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';
    recognition.maxAlternatives = 3;

    recognition.onstart = () => { startingRef.current = false; console.log('[VITA WAKE] LISTENING — say "Hello Vita"'); };
    recognition.onaudiostart = () => console.log('[VITA WAKE] microphone active');
    recognition.onresult = event => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i++) text += ` ${event.results[i][0]?.transcript ?? ''}`;
      text = text.trim();
      if (!text || activeRef.current) return;
      console.log('[VITA WAKE]', text);
      if (WAKE_PHRASE.test(text)) void activateSession();
    };
    recognition.onerror = event => {
      startingRef.current = false;
      recognitionRef.current = null;
      console.warn('[VITA WAKE ERROR]', event.error);
      if (activeRef.current || event.error === 'not-allowed' || event.error === 'service-not-allowed') return;
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = window.setTimeout(() => { void armWakeListener(); }, 800);
    };
    recognition.onend = () => {
      startingRef.current = false;
      recognitionRef.current = null;
      if (!activeRef.current) {
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => { void armWakeListener(); }, 300);
      }
    };
    recognitionRef.current = recognition;
    try { recognition.start(); }
    catch (error) {
      startingRef.current = false;
      recognitionRef.current = null;
      console.warn('[VITA WAKE] start() failed:', error);
    }
  }, [activateSession]);

  const deactivateSession = useCallback(() => {
    activeRef.current = false;
    greetingRef.current = false;
    stopWakeRecognition();
    const button = getVoiceButton();
    if ((button?.textContent ?? '').includes('STOP')) clickVoiceButton();
    if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); window.speechSynthesis.resume(); }
    console.log('[VITA SESSION] OFF');
    window.setTimeout(() => { void armWakeListener(); }, 500);
  }, [armWakeListener, clickVoiceButton, stopWakeRecognition]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('.hud-btn');
      if (!button || button !== getVoiceButton() || controllerClickRef.current) return;
      const label = button.textContent?.trim() ?? '';
      if (!activeRef.current && label.includes('VOICE')) {
        event.preventDefault(); event.stopImmediatePropagation(); void activateSession(); return;
      }
      if (activeRef.current && label.includes('STOP')) {
        event.preventDefault(); event.stopImmediatePropagation(); deactivateSession();
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
          if (STOP_PHRASE.test(transcript)) { deactivateSession(); return; }
        }
        if (status === 'VITA READY' && lastStatus !== 'VITA READY' && !greetingRef.current) {
          window.setTimeout(() => { if (activeRef.current && !greetingRef.current) clickVoiceButton(); }, 180);
        }
        lastStatus = status;
      }
      statusTimerRef.current = window.setTimeout(tick, 250);
    };
    tick();
    return () => { if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current); };
  }, [clickVoiceButton, deactivateSession]);

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
