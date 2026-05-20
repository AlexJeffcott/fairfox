// Action registry for The Struggle game engine.
//
// Handlers mutate the storyState and progressState $meshState documents.
// The CRDT sync layer propagates changes to every connected peer.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import type {
  Chapter,
  Choice,
  GameProgress,
  Passage,
  TheStruggleTabId,
} from '#src/client/state.ts';
import {
  editChapterId,
  editPassageId,
  progressState,
  storyState,
  theStruggleActiveTab,
} from '#src/client/state.ts';

const TAB_IDS = new Set<string>(['story', 'memory', 'edit']);

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

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Read an edited value from an action: ActionInput surfaces it as
 * `ctx.data.value`; a native <select> only carries it on the event
 * target. */
function readValue(ctx: HandlerContext): string | undefined {
  if (ctx.data.value !== undefined) {
    return ctx.data.value;
  }
  const target = ctx.event.target;
  if (
    target instanceof HTMLSelectElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return target.value;
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

  // --- Editor navigation ---------------------------------------
  'struggle.edit-open-chapter': (ctx) => {
    const chapterId = ctx.data.chapterId;
    if (chapterId) {
      editChapterId.value = chapterId;
      editPassageId.value = null;
    }
  },

  'struggle.edit-close-chapter': () => {
    editChapterId.value = null;
    editPassageId.value = null;
  },

  'struggle.edit-open-passage': (ctx) => {
    const passageId = ctx.data.passageId;
    if (passageId) {
      editPassageId.value = passageId;
    }
  },

  'struggle.edit-close-passage': () => {
    editPassageId.value = null;
  },

  // --- Chapter editing -----------------------------------------
  'chapter.create': () => {
    const chapter: Chapter = {
      id: generateId('ch'),
      title: 'New chapter',
      startPassageId: '',
      passages: [],
    };
    storyState.handle?.change((doc) => {
      doc.chapters.push(chapter);
    });
    editChapterId.value = chapter.id;
    editPassageId.value = null;
  },

  'chapter.update': (ctx) => {
    const chapterId = ctx.data.chapterId;
    const field = ctx.data.field;
    const value = readValue(ctx);
    if (!chapterId || !field || value === undefined) {
      return;
    }
    storyState.handle?.change((doc) => {
      const chapter = doc.chapters.find((c) => c.id === chapterId);
      if (!chapter) {
        return;
      }
      if (field === 'title') {
        chapter.title = value;
      } else if (field === 'startPassageId') {
        chapter.startPassageId = value;
      }
    });
  },

  'chapter.delete': (ctx) => {
    const chapterId = ctx.data.chapterId;
    if (!chapterId) {
      return;
    }
    storyState.handle?.change((doc) => {
      const idx = doc.chapters.findIndex((c) => c.id === chapterId);
      if (idx >= 0) {
        doc.chapters.splice(idx, 1);
      }
    });
    if (editChapterId.value === chapterId) {
      editChapterId.value = null;
      editPassageId.value = null;
    }
  },

  // --- Passage editing -----------------------------------------
  'passage.create': () => {
    const chapterId = editChapterId.value;
    if (!chapterId) {
      return;
    }
    const passage: Passage = {
      id: generateId('p'),
      chapterId,
      title: 'New passage',
      content: { body: '' },
      choices: [],
      isDeath: false,
    };
    storyState.handle?.change((doc) => {
      const chapter = doc.chapters.find((c) => c.id === chapterId);
      if (chapter) {
        chapter.passages.push(passage);
      }
    });
    editPassageId.value = passage.id;
  },

  'passage.update': (ctx) => {
    const passageId = ctx.data.passageId;
    const field = ctx.data.field;
    const value = readValue(ctx);
    if (!passageId || !field || value === undefined) {
      return;
    }
    storyState.handle?.change((doc) => {
      for (const chapter of doc.chapters) {
        const passage = chapter.passages.find((p) => p.id === passageId);
        if (!passage) {
          continue;
        }
        if (field === 'title') {
          passage.title = value;
        } else if (field === 'body') {
          passage.content.body = value;
        } else if (field === 'preamble') {
          passage.content.preamble = value;
        } else if (field === 'ifTrue') {
          passage.content.ifTrue = value;
        } else if (field === 'ifFalse') {
          passage.content.ifFalse = value;
        }
        return;
      }
    });
  },

  'passage.toggle-death': (ctx) => {
    const passageId = ctx.data.passageId;
    if (!passageId) {
      return;
    }
    storyState.handle?.change((doc) => {
      for (const chapter of doc.chapters) {
        const passage = chapter.passages.find((p) => p.id === passageId);
        if (passage) {
          passage.isDeath = !passage.isDeath;
          return;
        }
      }
    });
  },

  'passage.delete': (ctx) => {
    const passageId = ctx.data.passageId;
    if (!passageId) {
      return;
    }
    storyState.handle?.change((doc) => {
      for (const chapter of doc.chapters) {
        const idx = chapter.passages.findIndex((p) => p.id === passageId);
        if (idx >= 0) {
          chapter.passages.splice(idx, 1);
          return;
        }
      }
    });
    if (editPassageId.value === passageId) {
      editPassageId.value = null;
    }
  },

  // --- Choice editing ------------------------------------------
  'choice.create': (ctx) => {
    const passageId = ctx.data.passageId;
    if (!passageId) {
      return;
    }
    const choice: Choice = {
      id: generateId('c'),
      passageId,
      targetPassageId: '',
      label: 'New choice',
      type: 'navigate',
    };
    storyState.handle?.change((doc) => {
      for (const chapter of doc.chapters) {
        const passage = chapter.passages.find((p) => p.id === passageId);
        if (passage) {
          passage.choices.push(choice);
          return;
        }
      }
    });
  },

  'choice.update': (ctx) => {
    const choiceId = ctx.data.choiceId;
    const field = ctx.data.field;
    const value = readValue(ctx);
    if (!choiceId || !field || value === undefined) {
      return;
    }
    storyState.handle?.change((doc) => {
      for (const chapter of doc.chapters) {
        for (const passage of chapter.passages) {
          const choice = passage.choices.find((c) => c.id === choiceId);
          if (!choice) {
            continue;
          }
          if (field === 'label') {
            choice.label = value;
          } else if (field === 'type' && (value === 'navigate' || value === 'inspect')) {
            choice.type = value;
          } else if (field === 'targetPassageId') {
            choice.targetPassageId = value;
          }
          return;
        }
      }
    });
  },

  'choice.delete': (ctx) => {
    const choiceId = ctx.data.choiceId;
    if (!choiceId) {
      return;
    }
    storyState.handle?.change((doc) => {
      for (const chapter of doc.chapters) {
        for (const passage of chapter.passages) {
          const idx = passage.choices.findIndex((c) => c.id === choiceId);
          if (idx >= 0) {
            passage.choices.splice(idx, 1);
            return;
          }
        }
      }
    });
  },
};
