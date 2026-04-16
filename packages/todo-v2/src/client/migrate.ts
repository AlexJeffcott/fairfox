// Browser-side migration from the legacy todo API into $meshState.
//
// Called from the Capture view's "Migrate from legacy" button. Runs
// inside a paired session so the writes land in the mesh and propagate
// to every connected peer. Fetches projects, tasks, and quick captures
// from the legacy REST endpoints and rewrites them in the new shapes.
//
// Idempotent: running it again overwrites the three $meshState documents
// with the latest API data. Legacy records keep their original ids, so
// anyone referencing a project by name or a task by tid in notes still
// resolves cleanly after the migration.

import type {
  Project,
  ProjectCategory,
  ProjectStatus,
  QuickCapture,
  Task,
  TaskPriority,
} from '#src/client/state.ts';
import { capturesState, projectsState, tasksState } from '#src/client/state.ts';

const LEGACY_BASE = 'https://fairfox-production-8273.up.railway.app/todo';

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

function toCategory(c: string): ProjectCategory {
  return c === 'amboss' ? 'amboss' : 'personal';
}

function toStatus(s: string): ProjectStatus {
  if (s === 'active' || s === 'paused' || s === 'done' || s === 'archived') {
    return s;
  }
  return 'active';
}

function toPriority(p: string): TaskPriority {
  if (p === 'high' || p === 'low') {
    return p;
  }
  return 'med';
}

export interface MigrationResult {
  readonly projects: number;
  readonly tasks: number;
  readonly captures: number;
}

export async function migrateFromLegacy(base: string = LEGACY_BASE): Promise<MigrationResult> {
  const [legacyProjects, legacyTasks, legacyCaptures] = await Promise.all([
    fetch(`${base}/api/projects`).then((r) => r.json() as Promise<LegacyProject[]>),
    fetch(`${base}/api/tasks`).then((r) => r.json() as Promise<LegacyTask[]>),
    fetch(`${base}/api/quick-capture`).then((r) => r.json() as Promise<LegacyCapture[]>),
  ]);

  const projects: Project[] = legacyProjects.map((p) => ({
    pid: p.pid,
    name: p.name,
    parent: p.parent,
    category: toCategory(p.category),
    type: p.type,
    status: toStatus(p.status),
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
    priority: toPriority(t.priority),
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

  return {
    projects: projects.length,
    tasks: tasks.length,
    captures: captures.length,
  };
}
