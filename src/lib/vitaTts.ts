'use client';

const FEMALE_VOICE_PATTERNS = [
  /microsoft\s+heera/i,
  /google\s+uk\s+english\s+female/i,
  /microsoft\s+zira/i,
  /microsoft\s+aria/i,
  /google\s+us\s+english/i,
  /jenny/i,
  /samantha/i,
  /susan/i,
  /hazel/i,
  /female|woman|girl/i,
];

function isEnglish(voice: SpeechSynthesisVoice) {
  return /^en(?:-|_)/i.test(voice.lang);
}

export async function getPreferredFemaleVoice(): Promise<SpeechSynthesisVoice | null> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;

  const synth = window.speechSynthesis;
  let voices = synth.getVoices();

  if (!voices.length) {
    voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        synth.removeEventListener('voiceschanged', finish);
        resolve(synth.getVoices());
      };

      synth.addEventListener('voiceschanged', finish);
      window.setTimeout(finish, 2000);
    });
  }

  const english = voices.filter(isEnglish);

  for (const pattern of FEMALE_VOICE_PATTERNS) {
    const exact = english.find((voice) => pattern.test(voice.name));
    if (exact) return exact;
  }

  // Some browsers expose gender-like names only in voiceURI.
  for (const pattern of FEMALE_VOICE_PATTERNS) {
    const uriMatch = english.find((voice) => pattern.test(voice.voiceURI || ''));
    if (uriMatch) return uriMatch;
  }

  return null;
}

export async function speakVitaText(
  text: string,
  options: { rate?: number; pitch?: number; onStart?: (voice: SpeechSynthesisVoice | null) => void } = {},
): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  const synth = window.speechSynthesis;
  synth.cancel();
  synth.resume();

  const voice = await getPreferredFemaleVoice();
  const utterance = new SpeechSynthesisUtterance(text);

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = 'en-IN';
  }

  utterance.rate = options.rate ?? 0.96;
  utterance.pitch = options.pitch ?? 1.05;
  utterance.volume = 1;

  options.onStart?.(voice);

  await new Promise<void>((resolve) => {
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synth.speak(utterance);
  });
}
