// The Struggle game state — chapters, passages, choices, game progress.
// The game engine reads this CRDT to determine what the player sees and
// writes to it when the player makes choices or inspects the world.

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';

export interface PassageContent {
  [key: string]: unknown;
  body: string;
  preamble?: string;
  ifTrue?: string;
  ifFalse?: string;
}

export interface Choice {
  [key: string]: unknown;
  id: string;
  passageId: string;
  targetPassageId: string;
  label: string;
  type: 'navigate' | 'inspect';
  condition?: string;
}

export interface Passage {
  [key: string]: unknown;
  id: string;
  chapterId: string;
  title: string;
  content: PassageContent;
  choices: Choice[];
  isDeath: boolean;
}

export interface Chapter {
  [key: string]: unknown;
  id: string;
  title: string;
  startPassageId: string;
  passages: Passage[];
}

export interface GameProgress {
  [key: string]: unknown;
  currentChapterId: string;
  currentPassageId: string;
  variables: Record<string, string>;
  litanies: string[];
  placeNames: string[];
  visitedPassages: string[];
}

export interface StoryDoc {
  [key: string]: unknown;
  chapters: Chapter[];
}

export interface ProgressDoc {
  [key: string]: unknown;
  progress: GameProgress | null;
}

export const storyState = $meshState<StoryDoc>('struggle:story', { chapters: [] });
export const progressState = $meshState<ProgressDoc>('struggle:progress', { progress: null });
