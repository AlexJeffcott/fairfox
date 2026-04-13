// --- Game State ---

export interface GameState {
  chapter: string;
  passage: string;
  vars: Record<string, boolean | number | string>;
  visited: string[];
  litanies: string[];
  deaths: number;
}

// --- Chapter Data ---

export interface Litany {
  id: string;
  excerpt: string;
}

export interface PassageChoice {
  0: string; // label
  1: string; // target passage ID
}

export interface PassageBranch {
  body: string;
  choices?: PassageChoice[];
  inspections?: PassageChoice[];
}

export interface Passage {
  body?: string;
  type?: 'prologue';
  title_page?: boolean;
  next?: string;
  choices?: PassageChoice[];
  inspections?: PassageChoice[];
  inspection?: boolean; // marks this passage as inspection-only (right panel)
  set?: Record<string, any>;
  condition?: string;
  preamble?: string;
  ifTrue?: PassageBranch;
  ifFalse?: PassageBranch;
  litany?: Litany;
  death?: string;
  end?: boolean;
}

export interface ChapterData {
  id: string;
  title: string;
  initialState: Record<string, any>;
  start: string;
  passages: Record<string, Passage>;
}

// --- API ---

export interface RenderChoice {
  label: string;
  target: string;
}

export interface MemoryData {
  engravings: string[];
  litanies: { id: string; excerpt: string }[];
  places: string[];
}

export interface RenderData {
  type: 'title' | 'prologue' | 'passage' | 'death' | 'end';
  chapterTitle: string;
  body: string;
  deathText?: string;
  inspections: RenderChoice[];
  choices: RenderChoice[];
  memory: MemoryData;
}

export interface PlayRequest {
  action: 'init' | 'navigate' | 'inspect' | 'reset';
  target?: string;
  state?: GameState;
}

export interface PlayResponse {
  state: GameState;
  render: RenderData;
  inspection?: string;
}

export interface FeedbackEntry {
  chapter: string;
  passage: string;
  paragraphIndex: number;
  paragraphText: string;
  comment: string;
  state: GameState;
  timestamp?: string;
}

// --- Validation ---

export function validateChapter(data: unknown): ChapterData {
  const d = data as any;
  if (!d || typeof d !== 'object') throw new Error('Chapter data must be an object');
  if (typeof d.id !== 'string') throw new Error('Chapter must have a string id');
  if (typeof d.title !== 'string') throw new Error('Chapter must have a string title');
  if (typeof d.start !== 'string') throw new Error('Chapter must have a string start');
  if (!d.passages || typeof d.passages !== 'object') throw new Error('Chapter must have passages');
  if (!d.passages[d.start]) throw new Error(`Start passage "${d.start}" not found in passages`);

  // Validate all passage targets exist
  for (const [id, passage] of Object.entries(d.passages) as [string, any][]) {
    if (passage.next && !d.passages[passage.next]) {
      throw new Error(`Passage "${id}" has next="${passage.next}" but that passage doesn't exist`);
    }
    for (const list of [passage.choices, passage.inspections]) {
      if (Array.isArray(list)) {
        for (const [_label, target] of list) {
          if (target && !d.passages[target]) {
            throw new Error(
              `Passage "${id}" references "${target}" but that passage doesn't exist`
            );
          }
        }
      }
    }
    if (passage.condition) {
      if (!passage.ifTrue || !passage.ifFalse) {
        throw new Error(`Passage "${id}" has condition but missing ifTrue/ifFalse`);
      }
      for (const branch of [passage.ifTrue, passage.ifFalse]) {
        if (Array.isArray(branch.choices)) {
          for (const [_label, target] of branch.choices) {
            if (target && !d.passages[target]) {
              throw new Error(
                `Passage "${id}" branch references "${target}" but that passage doesn't exist`
              );
            }
          }
        }
      }
    }
  }

  return d as ChapterData;
}

export function validateGameState(data: unknown): GameState {
  const d = data as any;
  if (!d || typeof d !== 'object') throw new Error('State must be an object');
  if (typeof d.chapter !== 'string') throw new Error('State must have a string chapter');
  if (typeof d.passage !== 'string') throw new Error('State must have a string passage');
  if (!d.vars || typeof d.vars !== 'object') throw new Error('State must have vars');
  if (!Array.isArray(d.visited)) throw new Error('State must have visited array');
  if (!Array.isArray(d.litanies)) throw new Error('State must have litanies array');
  if (typeof d.deaths !== 'number') throw new Error('State must have a number deaths');
  return d as GameState;
}
