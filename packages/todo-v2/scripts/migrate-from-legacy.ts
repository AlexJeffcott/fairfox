#!/usr/bin/env bun
// Migrate data from the legacy todo API (SQLite-backed REST) into the
// new $meshState CRDT documents. Reads from the live API, writes into
// a locally-configured Automerge Repo, and prints a summary.
//
// Usage:
//   FAIRFOX_TODO_URL=https://fairfox-production-8273.up.railway.app/todo \
//     bun packages/todo-v2/scripts/migrate-from-legacy.ts
//
// The script is idempotent: running it again overwrites the local
// documents with the latest API data.

import { Repo } from '@automerge/automerge-repo';
import { configureMeshState } from '@fairfox/polly/mesh';
import type {
  CapturesDoc,
  Project,
  ProjectsDoc,
  QuickCapture,
  Task,
  TasksDoc,
} from '../src/client/state.ts';

const BASE = process.env.FAIRFOX_TODO_URL ?? 'https://fairfox-production-8273.up.railway.app/todo';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`${path}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

interface LegacyProject {
  pid: string;
  name: string;
  parent: string | null;
  category: string;
  type: string;
  status: string;
  dirs: string;
  skills: string;
  notes: string;
  sort_order: number;
}

interface LegacyTask {
  tid: string;
  done: number;
  description: string;
  project: string;
  priority: string;
  links: string;
  notes: string;
}

interface LegacyCapture {
  id: number;
  text: string;
  created_at: string;
}

async function main(): Promise<void> {
  // Set up a local Repo for the migration
  const repo = new Repo({ network: [] });
  configureMeshState(repo);

  // Dynamic import so $meshState resolves against the configured Repo
  const { projectsState, tasksState, capturesState } = await import('../src/client/state.ts');

  console.log(`Fetching from ${BASE}...`);

  const [legacyProjects, legacyTasks, legacyCaptures] = await Promise.all([
    fetchJson<LegacyProject[]>('/api/projects'),
    fetchJson<LegacyTask[]>('/api/tasks'),
    fetchJson<LegacyCapture[]>('/api/quick-capture'),
  ]);

  const projects: Project[] = legacyProjects.map((p) => ({
    pid: p.pid,
    name: p.name,
    parent: p.parent,
    category: p.category === 'amboss' ? 'amboss' : 'personal',
    type: p.type,
    status:
      p.status === 'active'
        ? 'active'
        : p.status === 'paused'
          ? 'paused'
          : p.status === 'done'
            ? 'done'
            : 'archived',
    dirs: p.dirs,
    skills: p.skills,
    notes: p.notes,
    sortOrder: p.sort_order,
  }));

  const tasks: Task[] = legacyTasks.map((t) => ({
    tid: t.tid,
    done: t.done === 1,
    description: t.description,
    project: t.project,
    priority: t.priority === 'high' ? 'high' : t.priority === 'low' ? 'low' : 'med',
    links: t.links,
    notes: t.notes,
  }));

  const captures: QuickCapture[] = legacyCaptures.map((c) => ({
    id: String(c.id),
    text: c.text,
    createdAt: c.created_at,
  }));

  projectsState.value = { projects };
  tasksState.value = { tasks };
  capturesState.value = { captures };

  console.log(
    `Migrated: ${projects.length} projects, ${tasks.length} tasks, ${captures.length} captures`
  );
  console.log('Done. The $meshState documents are now populated in the local Repo.');
}

main();
