// Action registry for The Struggle game engine.
//
// Handlers mutate the storyState and progressState $meshState documents.
// The CRDT sync layer propagates changes to every connected peer.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import type { Choice, GameProgress, TheStruggleTabId } from '#src/client/state.ts';
import { progressState, storyState, theStruggleActiveTab } from '#src/client/state.ts';

const TAB_IDS = new Set<string>(['story', 'memory']);

function isTheStruggleTabId(s: string): s is TheStruggleTabId {
  return TAB_IDS.has(s);
}

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
    // Single-player game state: at any moment exactly one device
    // is the active player. game.init/reset are transactional and
    // re-seed the whole progress object; that's a single field
    // write either way (we're flipping null↔object), so the
    // per-key vs top-level distinction doesn't apply. Per-field
    // writes for the in-progress mutations (game.navigate) DO
    // matter and they live in the handle.change below.
    progressState.handle?.change((doc) => {
      doc.progress = progress;
    });
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
    progressState.handle?.change((doc) => {
      if (!doc.progress) {
        return;
      }
      doc.progress.currentChapterId = target.chapter.id;
      doc.progress.currentPassageId = target.passage.id;
      if (!doc.progress.visitedPassages.includes(target.passage.id)) {
        doc.progress.visitedPassages.push(target.passage.id);
      }
    });
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
    progressState.handle?.change((doc) => {
      doc.progress = null;
    });
  },

  'game.tab': (ctx) => {
    const id = ctx.data.id;
    if (id && isTheStruggleTabId(id)) {
      theStruggleActiveTab.value = id;
    }
  },
};
