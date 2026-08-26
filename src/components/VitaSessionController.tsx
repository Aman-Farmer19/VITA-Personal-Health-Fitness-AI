'use client';

import { useCallback, useEffect, useRef } from 'react';

interface VitaSpeechRecognitionAlternative { readonly transcript: string; }
interface VitaSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: {
      readonly length: number;
      readonly 0: VitaSpeechRecognitionAlternative;
      readonly isFinal?: boolean;
    };
  };
}
interface VitaSpeechRecognitionErrorEvent extends Event { readonly error: string; }
interface VitaSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onresult: ((event: VitaSpeechRecognitionEvent) => void) | null;
  onerror: ((event: VitaSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = (new () => VitaSpeechRecognition) & {
  available?: (options: { langs: string[]; processLocally?: boolean; quality?: string }) => Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  install?: (options: { langs: string[]; quality?: string }) => Promise<boolean>;
};

type VitaWindow = Window & typeof globalThis & {
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
};

const STOP_PHRASE = /\bvita\s+stop\s+now\b/i;
const WAKE_NAME_VARIANTS = new Set(['vita', 'beta', 'bita', 'veta', 'vida', 'veeta', 'vitta', 'beeta']);

function normalizeSpeech(text: string) {
  return text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isWakePhrase(text: string) {
  const words = normalizeSpeech(text).split(' ').filter(Boolean);
  if (words.length < 2) return false;
  for (let i = 0; i < words.length - 1; i += 1) {
    if (words[i] === 'hello' && WAKE_NAME_VARIANTS.has(words[i + 1])) return true;
  }
  return false;
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

  const patterns = [/google uk english female/i, /microsoft zira/i, /microsoft heera/i, /microsoft aria/i, /jenny/i, /samantha/i, /susan/i, /hazel/i, /female|woman|girl/i];
  const english = voices.filter((voice) => /^en(?:-|_)/i.test(voice.lang));

  for (const pattern of patterns) {
    const voice = english.find((candidate) => pattern.test(candidate.name) || pattern.test(candidate.voiceURI || ''));
    if (voice) return voice;
  }
  return null;
}

function getVoiceButton() { return document.querySelector<HTMLButtonElement>('.hud-btn'); }

function getStatusText() {
  const known = new Set(['VITA READY', 'VITA ONLINE', 'LISTENING...', 'TRANSCRIBING...', 'VITA THINKING...', 'VITA SPEAKING...']);
  return Array.from(document.querySelectorAll('div, span')).find((node) => known.has(node.textContent?.trim() ?? ''))?.textContent?.trim() ?? '';
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
  const wakeBackoffRef = useRef(500);
  const destroyedRef = useRef(false);
  const wakeModeRef = useRef<'local' | 'remote' | 'unknown'>('unknown');

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

    const selectedVoice = await getFemaleVoice();
    const text = `${getGreeting()} What we are gonna do today, Boss?`;
    if (!selectedVoice) {
      console.warn('[VITA SESSION] No female English voice available; greeting skipped.');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang;
    utterance.rate = 0.98;
    utterance.pitch = 1.06;
    utterance.volume = 1;

    console.log('[VITA SESSION] Greeting voice:', `${selectedVoice.name} (${selectedVoice.lang})`);
    greetingRef.current = true;
    ttsCooldownRef.current = true;

    await new Promise<void>((resolve) => {
      let settled = false;
      const clear = () => {
        if (settled) return;
        settled = true;
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
    wakeBackoffRef.current = 500;
    stopWakeRecognition();
    console.log('[VITA SESSION] ACTIVE');

    await speakGreeting();

    if (activeRef.current && !speechBusy()) {
      window.setTimeout(() => {
        if (activeRef.current && !speechBusy()) clickVoiceButton();
      }, 300);
    }
  }, [clickVoiceButton, speakGreeting, speechBusy, stopWakeRecognition]);

  const prepareWakeMode = useCallback(async (Recognition: RecognitionCtor) => {
    if (wakeModeRef.current !== 'unknown') return wakeModeRef.current;

    if (typeof Recognition.available !== 'function') {
      wakeModeRef.current = 'remote';
      console.log('[VITA WAKE] On-device recognition unavailable; using browser service.');
      return wakeModeRef.current;
    }

    try {
      const availability = await Recognition.available({ langs: ['en-US'], processLocally: true });
      if (availability === 'available' || availability === 'downloading') {
        wakeModeRef.current = 'local';
        console.log('[VITA WAKE] MODE: ON-DEVICE');
        return wakeModeRef.current;
      }

      if (availability === 'downloadable' && typeof Recognition.install === 'function') {
        console.log('[VITA WAKE] Installing on-device English language pack...');
        const installed = await Recognition.install({ langs: ['en-US'] });
        if (installed) {
          wakeModeRef.current = 'local';
          console.log('[VITA WAKE] MODE: ON-DEVICE (language pack ready)');
          return wakeModeRef.current;
        }
      }
    } catch (error) {
      console.warn('[VITA WAKE] On-device check failed; falling back to browser service.', error);
    }

    wakeModeRef.current = 'remote';
    console.log('[VITA WAKE] MODE: BROWSER SERVICE');
    return wakeModeRef.current;
  }, []);

  const armWakeListener = useCallback(async () => {
    if (destroyedRef.current || activeRef.current || recognitionRef.current || startingRef.current || speechBusy()) return;

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

    const wakeMode = await prepareWakeMode(Recognition);
    if (destroyedRef.current || activeRef.current || speechBusy()) return;

    startingRef.current = true;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = wakeMode === 'local' ? 'en-US' : 'en-IN';
    recognition.maxAlternatives = 3;
    if (wakeMode === 'local') recognition.processLocally = true;

    recognition.onstart = () => {
      startingRef.current = false;
      wakeBackoffRef.current = 500;
      console.log('[VITA WAKE] LISTENING — say "Hello Vita"');
    };

    recognition.onaudiostart = () => console.log('[VITA WAKE] microphone active');

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result?.[0]?.transcript?.trim() ?? '';
        if (!text || activeRef.current || speechBusy()) continue;
        console.log('[VITA WAKE]', text, result?.isFinal ? '(final)' : '(interim)');

        if (isWakePhrase(text)) {
          stopWakeRecognition();
          void activateSession();
          return;
        }
      }
    };

    recognition.onerror = (event) => {
      startingRef.current = false;
      recognitionRef.current = null;

      if (event.error === 'language-not-supported' && wakeMode === 'local') {
        wakeModeRef.current = 'remote';
        console.warn('[VITA WAKE] Local language pack unavailable; falling back to browser service.');
      } else if (event.error === 'network' && wakeMode === 'local') {
        console.warn('[VITA WAKE] Local recognizer reported network; staying local and retrying slowly.');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('[VITA WAKE ERROR]', event.error);
      }

      if (activeRef.current || event.error === 'not-allowed' || event.error === 'service-not-allowed') return;

      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      const delay = event.error === 'network' ? 5000 : Math.min(wakeBackoffRef.current, 5000);
      wakeBackoffRef.current = Math.min(Math.max(wakeBackoffRef.current * 2, 500), 5000);
      restartTimerRef.current = window.setTimeout(() => { void armWakeListener(); }, delay);
    };

    recognition.onend = () => {
      startingRef.current = false;
      recognitionRef.current = null;
      if (!activeRef.current && !speechBusy() && !destroyedRef.current) {
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        const delay = Math.min(wakeBackoffRef.current, 5000);
        wakeBackoffRef.current = Math.min(wakeBackoffRef.current * 2, 5000);
        restartTimerRef.current = window.setTimeout(() => { void armWakeListener(); }, delay);
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
  }, [activateSession, prepareWakeMode, speechBusy, stopWakeRecognition]);

  const deactivateSession = useCallback(() => {
    activeRef.current = false;
    greetingRef.current = false;
    ttsCooldownRef.current = false;
    wakeBackoffRef.current = 500;
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
    destroyedRef.current = false;
    const kickoff = window.setTimeout(() => { void armWakeListener(); }, 900);

    return () => {
      destroyedRef.current = true;
      window.clearTimeout(kickoff);
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
      stopWakeRecognition();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [armWakeListener, stopWakeRecognition]);

  return null;
}
