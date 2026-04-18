// Action registry for Speakwell.
//
// The LLM coaching call lives on the server — the sub-app POSTs a
// session context to /api/llm/speakwell and receives a coach turn
// back. This handler dispatches the fetch but writes the result
// into $meshState so every paired device sees the same transcript.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import type { Format, Language, Session, Turn } from '#src/client/state.ts';
import { sessionsState } from '#src/client/state.ts';

interface HandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

const FORMATS = new Set<string>(['yarn', 'pitch', 'summary']);
const LANGUAGES = new Set<string>(['en-GB', 'it-IT', 'de-DE']);

function isFormat(s: string): s is Format {
  return FORMATS.has(s);
}

function isLanguage(s: string): s is Language {
  return LANGUAGES.has(s);
}

function generateId(): string {
  return `SW${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function updateSession(id: string, mutator: (s: Session) => Session): void {
  sessionsState.value = {
    ...sessionsState.value,
    sessions: sessionsState.value.sessions.map((s) => (s.id === id ? mutator(s) : s)),
  };
}

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,
  ...buildFreshnessActions,

  'session.start': (ctx) => {
    const format = ctx.data.format;
    const language = ctx.data.language;
    const speaker = ctx.data.speaker;
    const topic = ctx.data.topic ?? '';
    if (!format || !isFormat(format) || !language || !isLanguage(language) || !speaker) {
      return;
    }
    const session: Session = {
      id: generateId(),
      format,
      language,
      startedAt: new Date().toISOString(),
      endedAt: null,
      speaker,
      topic,
      turns: [],
      rating: null,
    };
    sessionsState.value = {
      ...sessionsState.value,
      sessions: [...sessionsState.value.sessions, session],
    };
  },

  'session.add-turn': (ctx) => {
    const id = ctx.data.id;
    const role = ctx.data.role === 'coach' ? 'coach' : 'speaker';
    const text = ctx.data.value ?? ctx.data.text;
    if (!id || !text) {
      return;
    }
    const turn: Turn = {
      role,
      text,
      timestamp: new Date().toISOString(),
    };
    updateSession(id, (s) => ({ ...s, turns: [...s.turns, turn] }));
  },

  'session.rate': (ctx) => {
    const id = ctx.data.id;
    const rating = Number(ctx.data.rating);
    if (!id || Number.isNaN(rating) || rating < 1 || rating > 5) {
      return;
    }
    updateSession(id, (s) => ({ ...s, rating }));
  },

  'session.end': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    updateSession(id, (s) => ({ ...s, endedAt: new Date().toISOString() }));
  },

  'speakwell.tab': () => {
    // Tab changes handled by local signal in App — no CRDT mutation.
  },
};
