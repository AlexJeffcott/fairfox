// Action registry for The Struggle game engine.
//
// Handlers mutate the storyState and progressState $meshState documents.
// The CRDT sync layer propagates changes to every connected peer.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import type { Choice, GameProgress } from '#src/client/state.ts';
import { progressState, storyState } from '#src/client/state.ts';

interface HandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

function findPassage(passageId: string) {
  for (const chapter of storyState.value.chapters) {
    const passage = chapter.passages.find((p) => p.id === passageId);
    if (passage) {
      return { chapter, passage };
    }
  }
  return undefined;
}

function findChoice(choiceId: string): Choice | undefined {
  for (const chapter of storyState.value.chapters) {
    for (const passage of chapter.passages) {
      const choice = passage.choices.find((c) => c.id === choiceId);
      if (choice) {
        return choice;
      }
    }
  }
  return undefined;
}

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,
  ...buildFreshnessActions,

  'game.init': () => {
    const firstChapter = storyState.value.chapters[0];
    if (!firstChapter) {
      return;
    }
    const startPassage = firstChapter.passages.find((p) => p.id === firstChapter.startPassageId);
    if (!startPassage) {
      return;
    }
    const progress: GameProgress = {
      currentChapterId: firstChapter.id,
      currentPassageId: startPassage.id,
      variables: {},
      litanies: [],
      placeNames: [],
      visitedPassages: [startPassage.id],
    };
    progressState.value = { progress };
  },

  'game.navigate': (ctx) => {
    const choiceId = ctx.data.choiceId;
    if (!choiceId) {
      return;
    }
    const current = progressState.value.progress;
    if (!current) {
      return;
    }
    const choice = findChoice(choiceId);
    if (!choice) {
      return;
    }
    const target = findPassage(choice.targetPassageId);
    if (!target) {
      return;
    }
    const visited = current.visitedPassages.includes(target.passage.id)
      ? current.visitedPassages
      : [...current.visitedPassages, target.passage.id];
    progressState.value = {
      progress: {
        ...current,
        currentChapterId: target.chapter.id,
        currentPassageId: target.passage.id,
        visitedPassages: visited,
      },
    };
  },

  'game.inspect': (ctx) => {
    const choiceId = ctx.data.choiceId;
    if (!choiceId) {
      return;
    }
    // Inspection is a read-only action — the detail panel reacts to
    // a local signal or data attribute. No CRDT mutation needed, but
    // the handler must exist so the delegator does not warn.
  },

  'game.reset': () => {
    progressState.value = { progress: null };
  },

  'game.tab': () => {
    // Tab changes handled by local signal in App — no CRDT mutation.
  },
};
