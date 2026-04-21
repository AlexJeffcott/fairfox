#!/usr/bin/env bun
// One-shot migration from the legacy /todo SQLite store (served
// from Railway under /todo/api/*) into todo-v2's mesh documents
// (`todo:projects`, `todo:tasks`, `todo:captures`). Idempotent: if
// todo-v2 already has any projects or tasks, the script refuses to
// touch anything so re-running won't duplicate. Use --force to
// override (e.g. after wiping mesh state during dev).
//
// To-buy, city-home, directories, agenda_items, agenda_completions,
// and documents from the legacy backup are NOT migrated — they have
// no todo-v2 equivalents today. Flag those up at the end so nothing
// quietly gets left behind.
//
// Run:
//   bun scripts/migrate-legacy-todo.ts
//   bun scripts/migrate-legacy-todo.ts --force
//   FAIRFOX_URL=https://... bun scripts/migrate-legacy-todo.ts
//
// Requires a paired keyring (~/.fairfox/keyring.json) — the script
// opens the mesh as this device, waits for at least one peer, then
// writes. Kick off `bun dev` in another terminal if you want a
// local peer, otherwise the script talks to the production signalling
// server via the CLI's default FAIRFOX_URL.

import { $meshState } from '@fairfox/polly/mesh';
import {
  derivePeerId,
  flushOutgoing,
  keyringStorage,
  openMeshClient,
  waitForPeer,
} from '../packages/cli/src/mesh.ts';

type ProjectStatus = 'active' | 'paused' | 'done' | 'archived';
type ProjectCategory = 'amboss' | 'personal';
type TaskPriority = 'high' | 'med' | 'low';

interface Project {
  [key: string]: unknown;
  pid: string;
  name: string;
  parent: string | null;
  category: ProjectCategory;
  type: string;
  status: ProjectStatus;
  dirs: string;
  skills: string;
  notes: string;
  sortOrder: number;
}

interface Task {
  [key: string]: unknown;
  tid: string;
  done: boolean;
  description: string;
  project: string;
  priority: TaskPriority;
  links: string;
  notes: string;
}

interface QuickCapture {
  [key: string]: unknown;
  id: string;
  text: string;
  createdAt: string;
}

interface ProjectsDoc {
  [key: string]: unknown;
  projects: Project[];
}
interface TasksDoc {
  [key: string]: unknown;
  tasks: Task[];
}
interface CapturesDoc {
  [key: string]: unknown;
  captures: QuickCapture[];
}

const PROJECTS_INITIAL: ProjectsDoc = { projects: [] };
const TASKS_INITIAL: TasksDoc = { tasks: [] };
const CAPTURES_INITIAL: CapturesDoc = { captures: [] };

function isProjectStatus(s: unknown): s is ProjectStatus {
  return s === 'active' || s === 'paused' || s === 'done' || s === 'archived';
}

function isProjectCategory(s: unknown): s is ProjectCategory {
  return s === 'amboss' || s === 'personal';
}

function isTaskPriority(s: unknown): s is TaskPriority {
  return s === 'high' || s === 'med' || s === 'low';
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function normaliseProject(raw: unknown, fallbackSort: number): Project | null {
  if (!isRecord(raw)) {
    return null;
  }
  const pid = typeof raw.pid === 'string' ? raw.pid : null;
  const name = typeof raw.name === 'string' ? raw.name : null;
  if (!pid || !name) {
    return null;
  }
  return {
    pid,
    name,
    parent: typeof raw.parent === 'string' && raw.parent ? raw.parent : null,
    category: isProjectCategory(raw.category) ? raw.category : 'personal',
    type: typeof raw.type === 'string' ? raw.type : 'coding',
    status: isProjectStatus(raw.status) ? raw.status : 'active',
    dirs: typeof raw.dirs === 'string' ? raw.dirs : '',
    skills: typeof raw.skills === 'string' ? raw.skills : '',
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    sortOrder: typeof raw.sort_order === 'number' ? raw.sort_order : fallbackSort,
  };
}

function normaliseTask(raw: unknown): Task | null {
  if (!isRecord(raw)) {
    return null;
  }
  const tid = typeof raw.tid === 'string' ? raw.tid : null;
  const description = typeof raw.description === 'string' ? raw.description : null;
  if (!tid || !description) {
    return null;
  }
  return {
    tid,
    done: raw.done === true || raw.done === 1,
    description,
    project: typeof raw.project === 'string' ? raw.project : '',
    priority: isTaskPriority(raw.priority) ? raw.priority : 'med',
    links: typeof raw.links === 'string' ? raw.links : '',
    notes: typeof raw.notes === 'string' ? raw.notes : '',
  };
}

function normaliseCapture(raw: unknown): QuickCapture | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : null;
  const text = typeof raw.text === 'string' ? raw.text : null;
  if (!id || !text) {
    return null;
  }
  return {
    id,
    text,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
  };
}

async function loadOwnPeerId(): Promise<string> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    throw new Error('no keyring — run `fairfox pair <token>` first');
  }
  return derivePeerId(keyring.identity.publicKey);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const base = process.env.FAIRFOX_URL ?? 'https://fairfox-production-8273.up.railway.app';
  const backupUrl = `${base.replace(/\/$/, '')}/todo/api/backup`;

  process.stdout.write(`[migrate] fetching ${backupUrl}\n`);
  const res = await fetch(backupUrl);
  if (!res.ok) {
    process.stderr.write(`[migrate] backup fetch failed: HTTP ${res.status}\n`);
    return 1;
  }
  const dump: unknown = await res.json();
  if (!isRecord(dump)) {
    process.stderr.write('[migrate] backup payload is not a JSON object\n');
    return 1;
  }

  const rawProjects = Array.isArray(dump.projects) ? dump.projects : [];
  const rawTasks = Array.isArray(dump.tasks) ? dump.tasks : [];
  const rawCaptures = Array.isArray(dump.quick_capture) ? dump.quick_capture : [];

  const projects: Project[] = rawProjects
    .map((r, i) => normaliseProject(r, i))
    .filter((p): p is Project => p !== null);
  const tasks: Task[] = rawTasks.map(normaliseTask).filter((t): t is Task => t !== null);
  const captures: QuickCapture[] = rawCaptures
    .map(normaliseCapture)
    .filter((c): c is QuickCapture => c !== null);

  process.stdout.write(
    `[migrate] legacy dump: ${projects.length} projects, ${tasks.length} tasks, ${captures.length} captures\n`
  );

  const peerId = await loadOwnPeerId();
  const client = await openMeshClient({ peerId });
  try {
    const peered = await waitForPeer(client, 8000);
    if (!peered) {
      process.stderr.write(
        '[migrate] no mesh peer reached in 8s — writes will land locally and sync later. Continuing.\n'
      );
    }
    const projectsDoc = $meshState<ProjectsDoc>('todo:projects', PROJECTS_INITIAL);
    const tasksDoc = $meshState<TasksDoc>('todo:tasks', TASKS_INITIAL);
    const capturesDoc = $meshState<CapturesDoc>('todo:captures', CAPTURES_INITIAL);
    await Promise.all([projectsDoc.loaded, tasksDoc.loaded, capturesDoc.loaded]);

    const existing =
      projectsDoc.value.projects.length +
      tasksDoc.value.tasks.length +
      capturesDoc.value.captures.length;
    if (existing > 0 && !force) {
      process.stderr.write(
        `[migrate] todo-v2 already has ${projectsDoc.value.projects.length} projects, ${tasksDoc.value.tasks.length} tasks, ${capturesDoc.value.captures.length} captures. Refusing to overwrite. Pass --force to replace.\n`
      );
      return 1;
    }

    projectsDoc.value = { ...projectsDoc.value, projects };
    tasksDoc.value = { ...tasksDoc.value, tasks };
    capturesDoc.value = { ...capturesDoc.value, captures };

    await flushOutgoing(3000);
    process.stdout.write(
      `[migrate] wrote ${projects.length} projects, ${tasks.length} tasks, ${captures.length} captures into mesh\n`
    );

    const notMigrated: string[] = [];
    if (Array.isArray(dump.to_buy) && dump.to_buy.length > 0) {
      notMigrated.push(`${dump.to_buy.length} to_buy`);
    }
    if (Array.isArray(dump.city_home) && dump.city_home.length > 0) {
      notMigrated.push(`${dump.city_home.length} city_home`);
    }
    if (Array.isArray(dump.directories) && dump.directories.length > 0) {
      notMigrated.push(`${dump.directories.length} directories`);
    }
    if (Array.isArray(dump.documents) && dump.documents.length > 0) {
      notMigrated.push(`${dump.documents.length} documents`);
    }
    if (Array.isArray(dump.agenda_items) && dump.agenda_items.length > 0) {
      notMigrated.push(`${dump.agenda_items.length} agenda_items`);
    }
    if (Array.isArray(dump.agenda_completions) && dump.agenda_completions.length > 0) {
      notMigrated.push(`${dump.agenda_completions.length} agenda_completions`);
    }
    if (notMigrated.length > 0) {
      process.stdout.write(
        `[migrate] not migrated (no todo-v2 equivalent): ${notMigrated.join(', ')}\n`
      );
    }

    return 0;
  } finally {
    await client.close();
  }
}

process.exit(await main());
