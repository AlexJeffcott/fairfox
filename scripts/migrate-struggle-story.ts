#!/usr/bin/env bun
// Story migration: reads the standalone the_struggle SQLite
// (~/projects/the_struggle/data/app.db) and writes its chapters /
// passages / choices into the fairfox mesh's `struggle:story`
// document. The production deployment doesn't expose these over
// HTTP, so this reads the local file directly.
//
// Schema translation (legacy → mesh):
//
//   chapters.start_passage → chapter.startPassageId
//   passages.id + passages.death → isDeath = (death != '')
//   place_names.name keyed by passage → passage.title (where set)
//   passage_content rows (by context):
//     body       → passage.content.body
//     preamble   → passage.content.preamble
//     if_true    → passage.content.ifTrue
//     if_false   → passage.content.ifFalse
//   choices.target → choice.targetPassageId
//   choices.type ('navigate'|'inspect')
//
// litanies and passage type / condition / next / set_vars are
// legacy engine fields the new mesh StoryDoc schema doesn't model.
// They're surfaced in console output at the end so the user can
// decide whether to fold them into the mesh shape later.

import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { $meshState } from '@fairfox/polly/mesh';
import {
  derivePeerId,
  flushOutgoing,
  keyringStorage,
  openMeshClient,
  waitForPeer,
} from '../packages/cli/src/mesh.ts';

interface PassageContent {
  [key: string]: unknown;
  body: string;
  preamble?: string;
  ifTrue?: string;
  ifFalse?: string;
}

interface Choice {
  [key: string]: unknown;
  id: string;
  passageId: string;
  targetPassageId: string;
  label: string;
  type: 'navigate' | 'inspect';
  condition?: string;
}

interface Passage {
  [key: string]: unknown;
  id: string;
  chapterId: string;
  title: string;
  content: PassageContent;
  choices: Choice[];
  isDeath: boolean;
}

interface Chapter {
  [key: string]: unknown;
  id: string;
  title: string;
  startPassageId: string;
  passages: Passage[];
}

interface StoryDoc {
  [key: string]: unknown;
  chapters: Chapter[];
}

const STORY_INITIAL: StoryDoc = { chapters: [] };
const DB_PATH =
  process.env.STRUGGLE_DB ?? join(homedir(), 'projects', 'the_struggle', 'data', 'app.db');

interface ChapterRow {
  id: string;
  title: string;
  start_passage: string;
}
interface PassageRow {
  id: string;
  chapter_id: string;
  death: string | null;
  next: string | null;
}
interface ContentRow {
  passage_id: string;
  chapter_id: string;
  context: string;
  html: string;
}
interface ChoiceRow {
  id: number;
  passage_id: string;
  chapter_id: string;
  label: string;
  target: string;
  type: string;
  sort_order: number;
}
interface PlaceRow {
  passage_id: string;
  chapter_id: string;
  name: string;
}
interface LitanyRow {
  id: string;
  passage_id: string;
  chapter_id: string;
  excerpt: string;
}

function loadFromDb(): {
  chapters: Chapter[];
  litanies: LitanyRow[];
  unmodeled: string[];
} {
  const db = new Database(DB_PATH, { readonly: true });
  const chapterRows = db
    .query('SELECT id, title, start_passage FROM chapters')
    .all() as ChapterRow[];
  const passageRows = db
    .query('SELECT id, chapter_id, death, next FROM passages ORDER BY id')
    .all() as PassageRow[];
  const contentRows = db
    .query('SELECT passage_id, chapter_id, context, html FROM passage_content')
    .all() as ContentRow[];
  const choiceRows = db
    .query(
      'SELECT id, passage_id, chapter_id, label, target, type, sort_order FROM choices ORDER BY passage_id, sort_order, id'
    )
    .all() as ChoiceRow[];
  const placeRows = db
    .query('SELECT passage_id, chapter_id, name FROM place_names')
    .all() as PlaceRow[];
  const litanyRows = db
    .query('SELECT id, passage_id, chapter_id, excerpt FROM litanies')
    .all() as LitanyRow[];
  db.close();

  const titleByPassage = new Map<string, string>();
  for (const p of placeRows) {
    titleByPassage.set(`${p.chapter_id}:${p.passage_id}`, p.name);
  }

  const contentByPassage = new Map<string, Map<string, string>>();
  for (const c of contentRows) {
    const key = `${c.chapter_id}:${c.passage_id}`;
    let m = contentByPassage.get(key);
    if (!m) {
      m = new Map();
      contentByPassage.set(key, m);
    }
    m.set(c.context, c.html);
  }

  const choicesByPassage = new Map<string, Choice[]>();
  for (const c of choiceRows) {
    const key = `${c.chapter_id}:${c.passage_id}`;
    const list = choicesByPassage.get(key) ?? [];
    const type: 'navigate' | 'inspect' = c.type === 'inspect' ? 'inspect' : 'navigate';
    list.push({
      id: String(c.id),
      passageId: c.passage_id,
      targetPassageId: c.target,
      label: c.label,
      type,
    });
    choicesByPassage.set(key, list);
  }

  const passagesByChapter = new Map<string, Passage[]>();
  for (const p of passageRows) {
    const key = `${p.chapter_id}:${p.id}`;
    const contents = contentByPassage.get(key) ?? new Map();
    // Fall back to if_true (and then if_false) when there's no
    // plain body. The new renderer only surfaces `content.body`;
    // the legacy engine branches on passage.condition to pick
    // between if_true / if_false variants. Without a condition
    // evaluator in the new UI, the best we can do at seed time is
    // surface SOMETHING. ifTrue stays on the record for any future
    // condition renderer.
    const body =
      contents.get('body') ??
      contents.get('if_true') ??
      contents.get('if_false') ??
      '';
    const content: PassageContent = { body };
    const preamble = contents.get('preamble');
    if (preamble) {
      content.preamble = preamble;
    }
    const ifTrue = contents.get('if_true');
    if (ifTrue) {
      content.ifTrue = ifTrue;
    }
    const ifFalse = contents.get('if_false');
    if (ifFalse) {
      content.ifFalse = ifFalse;
    }
    // Synthesise a "Continue" choice from passages.next when the
    // legacy engine relied on auto-navigation. Without this, the
    // chapter's title page (id=000, next=001) becomes a dead end
    // because the new schema only models explicit choices.
    const realChoices = choicesByPassage.get(key) ?? [];
    const choices: Choice[] =
      realChoices.length > 0 || !p.next
        ? realChoices
        : [
            {
              id: `${p.id}-continue`,
              passageId: p.id,
              targetPassageId: p.next,
              label: 'Continue',
              type: 'navigate',
            },
          ];
    const passage: Passage = {
      id: p.id,
      chapterId: p.chapter_id,
      title: titleByPassage.get(key) ?? '',
      content,
      choices,
      isDeath: p.death !== null && p.death !== '',
    };
    const list = passagesByChapter.get(p.chapter_id) ?? [];
    list.push(passage);
    passagesByChapter.set(p.chapter_id, list);
  }

  const chapters: Chapter[] = chapterRows.map((c) => ({
    id: c.id,
    title: c.title,
    startPassageId: c.start_passage,
    passages: passagesByChapter.get(c.id) ?? [],
  }));

  const unmodeled: string[] = [];
  // Legacy passage engine fields not represented in the mesh shape:
  // type, next, set_vars, condition, is_end, is_title_page,
  // is_inspection. Surface counts so the user sees what's dropped.
  // (Not fetching them here; just indicating they exist. If the
  // runtime actually needs them, that's a follow-up schema bump.)
  unmodeled.push(
    'passage engine fields (type, next, set_vars, condition, is_end, is_title_page, is_inspection) — not in StoryDoc schema'
  );
  if (litanyRows.length > 0) {
    unmodeled.push(
      `${litanyRows.length} litany row(s) — no direct home in StoryDoc; GameProgress.litanies is runtime-collected.`
    );
  }

  return { chapters, litanies: litanyRows, unmodeled };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  process.stdout.write(`[story] reading ${DB_PATH}\n`);
  const { chapters, litanies, unmodeled } = loadFromDb();
  const passageCount = chapters.reduce((s, c) => s + c.passages.length, 0);
  const choiceCount = chapters.reduce(
    (s, c) => s + c.passages.reduce((s2, p) => s2 + p.choices.length, 0),
    0
  );
  process.stdout.write(
    `[story] source: ${chapters.length} chapter(s), ${passageCount} passage(s), ${choiceCount} choice(s)\n`
  );

  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    process.stderr.write('[story] no keyring — run `fairfox pair <token>` first\n');
    return 1;
  }
  const peerId = derivePeerId(keyring.identity.publicKey);
  const client = await openMeshClient({ peerId });
  try {
    const peered = await waitForPeer(client, 8000);
    if (!peered) {
      process.stderr.write(
        '[story] no mesh peer reached in 8s — writes land locally and sync later. Continuing.\n'
      );
    }
    const story = $meshState<StoryDoc>('struggle:story', STORY_INITIAL);
    await story.loaded;

    if (story.value.chapters.length > 0 && !force) {
      process.stderr.write(
        `[story] struggle:story already has ${story.value.chapters.length} chapter(s). Pass --force to replace.\n`
      );
      return 1;
    }

    story.value = { ...story.value, chapters };
    await flushOutgoing(3000);
    process.stdout.write(`[story] wrote ${chapters.length} chapter(s).\n`);

    if (litanies.length > 0) {
      process.stdout.write(
        `[story] litanies (${litanies.length}) not written — add to the StoryDoc schema if the game needs them.\n`
      );
    }
    if (unmodeled.length > 0) {
      process.stdout.write('[story] skipped legacy data:\n');
      for (const line of unmodeled) {
        process.stdout.write(`  - ${line}\n`);
      }
    }
    return 0;
  } finally {
    await client.close();
  }
}

process.exit(await main());
