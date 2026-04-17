// Speakwell state — a fully-spoken coach for storytelling, elevator
// pitches, and summarising. Each attempt is a session with a transcript,
// the coach's feedback, and a rating. Sessions sync across the speaker's
// devices via $meshState so they can pick up a coaching thread on any
// device. See the project note on culturally-tuned per-locale coaching.

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';

export type Format = 'yarn' | 'pitch' | 'summary';
export type Language = 'en-GB' | 'it-IT' | 'de-DE';

export interface Turn {
  [key: string]: unknown;
  role: 'speaker' | 'coach';
  text: string;
  timestamp: string;
}

export interface Session {
  [key: string]: unknown;
  id: string;
  format: Format;
  language: Language;
  startedAt: string;
  endedAt: string | null;
  speaker: string;
  topic: string;
  turns: Turn[];
  rating: number | null;
}

export interface SpeakwellDoc {
  [key: string]: unknown;
  sessions: Session[];
}

export const sessionsState = $meshState<SpeakwellDoc>('speakwell:sessions', { sessions: [] });
