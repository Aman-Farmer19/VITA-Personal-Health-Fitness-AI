'use client';

import { useEffect } from 'react';

const FEMALE_PATTERNS = [
  /microsoft\s+heera/i,
  /microsoft\s+zira/i,
  /microsoft\s+aria/i,
  /google\s+uk\s+english\s+female/i,
  /jenny/i,
  /samantha/i,
  /susan/i,
  /hazel/i,
  /female|woman|girl/i,
];

function findFemaleVoice(voices: SpeechSynthesisVoice[]) {
  const english = voices.filter((voice) => /^en(?:-|_)/i.test(voice.lang));
  for (const pattern of FEMALE_PATTERNS) {
    const match = english.find((voice) => pattern.test(voice.name) || pattern.test(voice.voiceURI || ''));
    if (match) return match;
  }
  return null;
}

export default function VitaTtsVoiceLock() {
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;

    const synth = window.speechSynthesis;
    const originalSpeak = synth.speak.bind(synth);

    let preferredVoice: SpeechSynthesisVoice | null = null;
    let voicesReady = false;

    const loadVoices = () => {
      const voices = synth.getVoices();
      const female = findFemaleVoice(voices);
      if (female) {
        preferredVoice = female;
        voicesReady = true;
        console.log('[VITA TTS] Locked female voice:', `${female.name} (${female.lang})`);
      } else if (voices.length) {
        voicesReady = true;
        console.warn('[VITA TTS] No matching female English voice exposed by browser.');
      }
    };

    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);

    // Prevent the two existing VITA TTS call sites from selecting different
    // browser voices. Every VITA utterance is normalized here before playback.
    synth.speak = ((utterance: SpeechSynthesisUtterance) => {
      if (preferredVoice) {
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang;
      } else if (!utterance.lang) {
        utterance.lang = 'en-IN';
      }
      utterance.rate = 0.96;
      utterance.pitch = 1.05;
      utterance.volume = 1;
      originalSpeak(utterance);
    }) as typeof synth.speak;

    const retryTimer = window.setTimeout(() => {
      if (!voicesReady) loadVoices();
    }, 2000);

    return () => {
      window.clearTimeout(retryTimer);
      synth.removeEventListener('voiceschanged', loadVoices);
      synth.speak = originalSpeak;
    };
  }, []);

  return null;
}
