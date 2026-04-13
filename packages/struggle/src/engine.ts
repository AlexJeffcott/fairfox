import type { Database } from 'bun:sqlite';
import type { GameState, MemoryData, PlayResponse, RenderChoice, RenderData } from './types';
import { validateGameState } from './types';

let db: Database;

export function setDb(database: Database) {
  db = database;
}

// --- DB queries ---

function getChapter(id: string) {
  return db.query('SELECT * FROM chapters WHERE id = $id').get({ $id: id }) as any;
}

function getPassage(id: string, chapterId: string) {
  return db
    .query('SELECT * FROM passages WHERE id = $id AND chapter_id = $ch')
    .get({ $id: id, $ch: chapterId }) as any;
}

function getContent(passageId: string, chapterId: string, context: string): string {
  const row = db
    .query(
      'SELECT html FROM passage_content WHERE passage_id = $pid AND chapter_id = $ch AND context = $ctx'
    )
    .get({ $pid: passageId, $ch: chapterId, $ctx: context }) as any;
  return row?.html || '';
}

function getChoices(passageId: string, chapterId: string, context: string) {
  return db
    .query(
      'SELECT label, target, type FROM choices WHERE passage_id = $pid AND chapter_id = $ch AND context = $ctx ORDER BY sort_order'
    )
    .all({ $pid: passageId, $ch: chapterId, $ctx: context }) as any[];
}

function getLitanyForPassage(passageId: string, chapterId: string) {
  return db
    .query('SELECT id, excerpt FROM litanies WHERE passage_id = $pid AND chapter_id = $ch')
    .get({ $pid: passageId, $ch: chapterId }) as any;
}

function getLitanyById(id: string) {
  return db.query('SELECT id, excerpt FROM litanies WHERE id = $id').get({ $id: id }) as any;
}

function getPlaceName(passageId: string, chapterId: string) {
  return db
    .query('SELECT name FROM place_names WHERE passage_id = $pid AND chapter_id = $ch')
    .get({ $pid: passageId, $ch: chapterId }) as any;
}

// --- Inline inspection processing ---

function processInlineInspections(body: string, vars: Record<string, any>): string {
  // Handle conditional inspection links: <a data-inspect="target" data-condition="var">text</a>
  return body.replace(
    /<a data-inspect="([^"]+)"(?: data-condition="([^"]+)")?>([^<]+)<\/a>/g,
    (_match, target, condition, text) => {
      if (condition && !vars[condition]) return text;
      return `<a data-inspect="${target}">${text}</a>`;
    }
  );
}

// --- Resolve passage ---

function resolvePassage(
  passage: any,
  vars: Record<string, any>,
  chapterId: string
): { body: string; choices: RenderChoice[]; inspections: RenderChoice[] } {
  let bodyHtml: string;
  let allChoices: any[];

  if (passage.condition) {
    const val = vars[passage.condition];
    const context = val ? 'if_true' : 'if_false';
    const preamble = getContent(passage.id, chapterId, 'preamble');
    const branch = getContent(passage.id, chapterId, context);
    bodyHtml = preamble + branch;
    allChoices = getChoices(passage.id, chapterId, context);
  } else {
    bodyHtml = getContent(passage.id, chapterId, 'body');
    allChoices = getChoices(passage.id, chapterId, 'body');
  }

  const body = processInlineInspections(bodyHtml, vars);

  const choices: RenderChoice[] = [];
  const inspections: RenderChoice[] = [];
  for (const c of allChoices) {
    if (c.type === 'inspect') {
      inspections.push({ label: c.label, target: c.target });
    } else {
      choices.push({ label: c.label, target: c.target });
    }
  }

  return { body, choices, inspections };
}

// --- Passage type ---

function getPassageType(passage: any): RenderData['type'] {
  if (passage.is_title_page) return 'title';
  if (passage.type === 'prologue') return 'prologue';
  if (passage.death) return 'death';
  if (passage.is_end) return 'end';
  return 'passage';
}

// --- Litany collection ---

function collectLitany(passageId: string, chapterId: string, state: GameState): void {
  const litany = getLitanyForPassage(passageId, chapterId);
  if (litany && !state.litanies.includes(litany.id)) {
    state.litanies.push(litany.id);
  }
}

// --- Memory data ---

function buildMemory(state: GameState): MemoryData {
  const engravings = Object.entries(state.vars)
    .filter(([k, v]) => k.endsWith('_engraving') && v)
    .map(([k]) => k.replace('_engraving', ''));

  const litanies = state.litanies.map((id) => {
    const l = getLitanyById(id);
    return { id, excerpt: l?.excerpt || id };
  });

  const seen = new Set<string>();
  const places: string[] = [];
  for (const id of state.visited) {
    if (seen.has(id)) continue;
    const pn = getPlaceName(id, state.chapter);
    if (pn) {
      seen.add(id);
      places.push(pn.name);
    }
  }

  return { engravings, litanies, places };
}

// --- Render data ---

function buildRender(
  passage: any,
  _passageId: string,
  chapterId: string,
  state: GameState
): RenderData {
  const chapter = getChapter(chapterId);
  const type = getPassageType(passage);
  const resolved = resolvePassage(passage, state.vars, chapterId);

  let { choices } = resolved;
  const { inspections, body } = resolved;

  if (type === 'title' && passage.next) {
    choices = [{ label: 'Begin', target: passage.next }];
  }

  if (
    type !== 'title' &&
    !passage.death &&
    !passage.is_end &&
    passage.next &&
    choices.length === 0
  ) {
    choices = [{ label: 'Continue', target: passage.next }];
  }

  if (type === 'death') {
    choices = [{ label: 'Begin again.', target: '__reset__' }];
  }

  return {
    type,
    chapterTitle: chapter.title,
    body,
    ...(passage.death ? { deathText: passage.death } : {}),
    inspections,
    choices,
    memory: buildMemory(state),
  };
}

// --- Play ---

export async function play(
  action: string,
  target: string | null,
  inState: GameState | null
): Promise<PlayResponse> {
  if (action === 'init' || !inState) {
    const chapter = getChapter('01');
    if (!chapter) throw new Error('Chapter 01 not found');
    const state: GameState = {
      chapter: '01',
      passage: chapter.start_passage,
      vars: JSON.parse(chapter.initial_state),
      visited: [],
      litanies: [],
      deaths: 0,
    };
    const passage = getPassage(state.passage, state.chapter);
    return { state, render: buildRender(passage, state.passage, state.chapter, state) };
  }

  const state: GameState = {
    ...validateGameState(inState),
    vars: { ...inState.vars },
    visited: [...inState.visited],
    litanies: [...inState.litanies],
  };

  if (action === 'inspect' && target) {
    const passage = getPassage(target, state.chapter);
    if (!passage) throw new Error(`Unknown passage: ${target}`);
    if (!state.visited.includes(target)) state.visited.push(target);
    collectLitany(target, state.chapter, state);
    const currentPassage = getPassage(state.passage, state.chapter);
    return {
      state,
      render: buildRender(currentPassage, state.passage, state.chapter, state),
      inspection: getContent(target, state.chapter, 'body'),
    };
  }

  if (action === 'reset' || target === '__reset__') {
    const chapter = getChapter(state.chapter);
    state.vars = JSON.parse(chapter.initial_state);
    state.passage = chapter.start_passage;
    state.visited = [];
    state.deaths += 1;
    const passage = getPassage(state.passage, state.chapter);
    return { state, render: buildRender(passage, state.passage, state.chapter, state) };
  }

  if (action === 'navigate' && target) {
    const passage = getPassage(target, state.chapter);
    if (!passage) throw new Error(`Unknown passage: ${target}`);

    state.passage = target;
    if (!state.visited.includes(target)) state.visited.push(target);
    if (passage.set_vars) Object.assign(state.vars, JSON.parse(passage.set_vars));
    collectLitany(target, state.chapter, state);

    return { state, render: buildRender(passage, target, state.chapter, state) };
  }

  throw new Error(`Unknown action: ${action}`);
}

// --- Export as JSON ---

export function exportChapter(chapterId: string): any {
  const chapter = getChapter(chapterId);
  if (!chapter) return null;

  const passages: Record<string, any> = {};
  const allPassages = db
    .query('SELECT * FROM passages WHERE chapter_id = $ch')
    .all({ $ch: chapterId }) as any[];

  for (const p of allPassages) {
    const choices = getChoices(p.id, chapterId, 'body');
    const litany = getLitanyForPassage(p.id, chapterId);

    const passage: any = {};
    const body = getContent(p.id, chapterId, 'body');
    if (body) passage.body = body;
    if (p.is_title_page) passage.title_page = true;
    if (p.type) passage.type = p.type;
    if (p.next) passage.next = p.next;
    if (p.set_vars) passage.set = JSON.parse(p.set_vars);
    if (p.condition) {
      passage.condition = p.condition;
      const preamble = getContent(p.id, chapterId, 'preamble');
      if (preamble) passage.preamble = preamble;
      passage.ifTrue = { body: getContent(p.id, chapterId, 'if_true') };
      const itChoices = getChoices(p.id, chapterId, 'if_true');
      if (itChoices.length > 0)
        passage.ifTrue.choices = itChoices.map((c: any) => [c.label, c.target]);
      passage.ifFalse = { body: getContent(p.id, chapterId, 'if_false') };
      const ifChoices = getChoices(p.id, chapterId, 'if_false');
      if (ifChoices.length > 0)
        passage.ifFalse.choices = ifChoices.map((c: any) => [c.label, c.target]);
    }
    if (p.is_inspection) passage.inspection = true;
    if (p.death) passage.death = p.death;
    if (p.is_end) passage.end = true;
    if (litany) passage.litany = { id: litany.id, excerpt: litany.excerpt };

    const navChoices = choices.filter((c: any) => c.type === 'navigate');
    const inspChoices = choices.filter((c: any) => c.type === 'inspect');
    if (navChoices.length > 0 && !p.condition) {
      passage.choices = navChoices.map((c: any) => [c.label, c.target]);
    }
    if (inspChoices.length > 0) {
      passage.inspections = inspChoices.map((c: any) => [c.label, c.target]);
    }

    passages[p.id] = passage;
  }

  return {
    id: chapter.id,
    title: chapter.title,
    initialState: JSON.parse(chapter.initial_state),
    start: chapter.start_passage,
    passages,
  };
}
