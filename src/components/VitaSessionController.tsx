
'use client';
import { useCallback, useEffect, useRef } from 'react';

type VitaSpeechRecognitionResult = {
  [index: number]: {
    transcript?: string;
  };
};

type VitaSpeechRecognitionResultList = {
  length: number;
  [index: number]: VitaSpeechRecognitionResult;
};

type VitaSpeechRecognitionEvent = {
  resultIndex: number;
  results: VitaSpeechRecognitionResultList;
};

type VitaSpeechRecognitionErrorEvent = {
  error?: string;
};

type VitaSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onresult: ((event: VitaSpeechRecognitionEvent) => void) | null;
  onerror: ((event: VitaSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => VitaSpeechRecognition;

type VitaWindow = Window & typeof globalThis & {
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
};

const WAKE_PHRASE = /\b(?:hello|hi)\s+(?:vita|veeta|beta|vitta|vida)\b/i;

export default function VitaSessionController() {
  const activeRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const recognitionRef = useRef<VitaSpeechRecognition | null>(null);
  const recognitionStartingRef = useRef(false);
  const micPermissionReadyRef = useRef(false);

  const stopWakeRecognition = useCallback(() => {
    recognitionStartingRef.current = false;

    try {
      recognitionRef.current?.abort();
    } catch { }

    recognitionRef.current = null;
  }, []);

  const armWakeListener = useCallback(async () => {
    if (
      activeRef.current ||
      recognitionRef.current ||
      recognitionStartingRef.current
    ) {
      return;
    }

    const w = window as VitaWindow;
    const Recognition =
      w.SpeechRecognition ?? w.webkitSpeechRecognition;

    if (!Recognition) {
      console.warn(
        '[VITA WAKE] SpeechRecognition unavailable in this browser.',
      );
      return;
    }

    if (!micPermissionReadyRef.current) {
      try {
        const stream =
          await navigator.mediaDevices.getUserMedia({ audio: true });

        stream.getTracks().forEach((track) => track.stop());
        micPermissionReadyRef.current = true;

        console.log('[VITA WAKE] Microphone permission ready.');
      } catch (error) {
        console.warn(
          '[VITA WAKE] Microphone permission unavailable:',
          error,
        );
        return;
      }
    }

    recognitionStartingRef.current = true;

    const recognition = new Recognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      recognitionStartingRef.current = false;
      console.log('[VITA WAKE] LISTENING — say "Hello Vita"');
    };

    recognition.onaudiostart = () => {
      console.log('[VITA WAKE] microphone active');
    };

    recognition.onresult = (event) => {
      let combined = '';

      for (
        let i = event.resultIndex;
        i < event.results.length;
        i += 1
      ) {
        combined += ` ${event.results[i][0]?.transcript ?? ''
          }`;
      }

      const text = combined.trim();

      if (!text || activeRef.current) return;

      const normalized = text
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      console.log('[VITA WAKE]', normalized);

      if (WAKE_PHRASE.test(normalized)) {
        activeRef.current = true;
        stopWakeRecognition();

        console.log('[VITA WAKE] wake phrase accepted');
        window.dispatchEvent(new Event('vita:activate'));
      }
    };

    recognition.onerror = (event) => {
      recognitionStartingRef.current = false;
      recognitionRef.current = null;

      console.warn(
        '[VITA WAKE ERROR]',
        event.error,
      );

      if (activeRef.current) return;

      if (
        event.error === 'not-allowed' ||
        event.error === 'service-not-allowed'
      ) {
        console.warn(
          '[VITA WAKE] Browser blocked passive wake listening; ' +
          'manual VOICE remains available.',
        );
        return;
      }

      if (restartTimerRef.current) {
        window.clearTimeout(restartTimerRef.current);
      }

      restartTimerRef.current = window.setTimeout(
        () => void armWakeListener(),
        900,
      );
    };

    recognition.onend = () => {
      recognitionStartingRef.current = false;
      recognitionRef.current = null;

      if (activeRef.current) return;

      if (restartTimerRef.current) {
        window.clearTimeout(restartTimerRef.current);
      }

      restartTimerRef.current = window.setTimeout(
        () => void armWakeListener(),
        400,
      );
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (error) {
      recognitionStartingRef.current = false;
      recognitionRef.current = null;

      console.warn(
        '[VITA WAKE] start() failed:',
        error,
      );
    }
  }, [stopWakeRecognition]);

  useEffect(() => {
    const onSessionStarted = () => {
      activeRef.current = true;
      stopWakeRecognition();
    };

    const onSessionEnded = () => {
      activeRef.current = false;

      if (restartTimerRef.current) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }

      window.setTimeout(
        () => void armWakeListener(),
        700,
      );
    };

    const onManualStop = () => {
      activeRef.current = false;
      stopWakeRecognition();
    };

    window.addEventListener(
      'vita:session-started',
      onSessionStarted,
    );

    window.addEventListener(
      'vita:session-ended',
      onSessionEnded,
    );

    window.addEventListener(
      'vita:stop-requested',
      onManualStop,
    );

    return () => {
      window.removeEventListener(
        'vita:session-started',
        onSessionStarted,
      );

      window.removeEventListener(
        'vita:session-ended',
        onSessionEnded,
      );

      window.removeEventListener(
        'vita:stop-requested',
        onManualStop,
      );
    };
  }, [armWakeListener, stopWakeRecognition]);

  useEffect(() => {
    const kickoff = window.setTimeout(
      () => void armWakeListener(),
      900,
    );

    return () => {
      window.clearTimeout(kickoff);

      if (restartTimerRef.current) {
        window.clearTimeout(restartTimerRef.current);
      }

      stopWakeRecognition();
    };
  }, [armWakeListener, stopWakeRecognition]);

  return null;
}
