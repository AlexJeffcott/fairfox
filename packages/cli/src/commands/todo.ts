// `fairfox todo …` — read and mutate the three todo-v2 $meshState
// documents (`todo:projects`, `todo:tasks`, `todo:captures`) from the
// command line so the todo skill can stay off the legacy REST API.
//
// The wire shape duplicates packages/todo-v2/src/client/state.ts by
// design: the CLI can't pull a Preact import graph along for the
// ride, and the mesh document itself is the canonical schema.
// Changes on either side must stay structurally identical or the
// CRDT merge will produce ghosts.
//
// Every subcommand opens a fresh mesh client, waits briefly for a
// peer so newly-online CLIs pick up what browsers already wrote,
// reads or mutates the signal, flushes outgoing sync messages, and
// closes. "Brief" means ~8s on the peer-wait and ~2s on the flush —
// long enough for a healthy signalling round-trip, short enough
// that an offline CLI doesn't feel stuck.

import { $meshState } from '@fairfox/polly/mesh';
import {
  derivePeerId,
  flushOutgoing,
  keyringStorage,
  openMeshClient,
  waitForPeer,
} from '#src/mesh.ts';

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

function generateId(prefix: string): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function isTaskPriority(s: string): s is TaskPriority {
  return s === 'high' || s === 'med' || s === 'low';
}

function isProjectStatus(s: string): s is ProjectStatus {
  return s === 'active' || s === 'paused' || s === 'done' || s === 'archived';
}

async function loadOwnPeerId(): Promise<string> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    throw new Error('no keyring — run `fairfox pair <token>` first');
  }
  return derivePeerId(keyring.identity.publicKey);
}

interface MeshHandles {
  projects: ReturnType<typeof $meshState<ProjectsDoc>>;
  tasks: ReturnType<typeof $meshState<TasksDoc>>;
  captures: ReturnType<typeof $meshState<CapturesDoc>>;
}

async function withMesh<T>(
  runner: (mesh: MeshHandles, peered: boolean) => T | Promise<T>
): Promise<T> {
  const peerId = await loadOwnPeerId();
  const client = await openMeshClient({ peerId });
  try {
    const peered = await waitForPeer(client, 8000);
    const projects = $meshState<ProjectsDoc>('todo:projects', PROJECTS_INITIAL);
    const tasks = $meshState<TasksDoc>('todo:tasks', TASKS_INITIAL);
    const captures = $meshState<CapturesDoc>('todo:captures', CAPTURES_INITIAL);
    await Promise.all([projects.loaded, tasks.loaded, captures.loaded]);
    if (peered) {
      await flushOutgoing(2000);
    }
    return await runner({ projects, tasks, captures }, peered);
  } finally {
    await client.close();
  }
}

// --- Tasks ---

interface TaskFilters {
  project?: string;
  priority?: TaskPriority;
  includeDone: boolean;
}

function parseTaskFilters(rest: readonly string[]): TaskFilters {
  const out: TaskFilters = { includeDone: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--done' || arg === '--all') {
      out.includeDone = true;
    } else if (arg === '--project' && rest[i + 1]) {
      out.project = rest[i + 1];
      i += 1;
    } else if (arg === '--priority' && rest[i + 1]) {
      const next = rest[i + 1];
      if (next !== undefined && isTaskPriority(next)) {
        out.priority = next;
        i += 1;
      }
    }
  }
  return out;
}

function formatTask(t: Task): string {
  const box = t.done ? '[x]' : '[ ]';
  const prio = t.priority === 'med' ? '   ' : `${t.priority.padStart(3, ' ')}`;
  const project = t.project ? ` · ${t.project}` : '';
  return `${t.tid}  ${box} ${prio}  ${t.description}${project}`;
}

function tasksList(rest: readonly string[]): Promise<number> {
  const filters = parseTaskFilters(rest);
  return withMesh(({ tasks }, peered) => {
    if (!peered) {
      process.stderr.write(
        'fairfox todo: no mesh peers reachable — showing the local copy (may be stale).\n'
      );
    }
    let list = tasks.value.tasks;
    if (!filters.includeDone) {
      list = list.filter((t) => !t.done);
    }
    if (filters.project) {
      list = list.filter((t) => t.project === filters.project);
    }
    if (filters.priority) {
      list = list.filter((t) => t.priority === filters.priority);
    }
    if (list.length === 0) {
      process.stdout.write('(no matching tasks)\n');
      return 0;
    }
    for (const t of list) {
      process.stdout.write(`${formatTask(t)}\n`);
    }
    return 0;
  });
}

interface TaskAddArgs {
  description: string;
  project?: string;
  priority: TaskPriority;
}

function parseTaskAdd(rest: readonly string[]): TaskAddArgs | null {
  const positional: string[] = [];
  let project: string | undefined;
  let priority: TaskPriority = 'med';
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--project' && rest[i + 1]) {
      project = rest[i + 1];
      i += 1;
    } else if (arg === '--priority') {
      const next = rest[i + 1];
      if (next !== undefined && isTaskPriority(next)) {
        priority = next;
        i += 1;
      }
    } else if (typeof arg === 'string') {
      positional.push(arg);
    }
  }
  const description = positional.join(' ').trim();
  if (!description) {
    return null;
  }
  return { description, project, priority };
}

function taskAdd(rest: readonly string[]): Promise<number> {
  const parsed = parseTaskAdd(rest);
  if (!parsed) {
    process.stderr.write(
      'fairfox todo task add: expected a description. Usage: fairfox todo task add "do X" [--project i18n] [--priority high|med|low]\n'
    );
    return Promise.resolve(1);
  }
  return withMesh(async ({ tasks }) => {
    const task: Task = {
      tid: generateId('T'),
      done: false,
      description: parsed.description,
      project: parsed.project ?? '',
      priority: parsed.priority,
      links: '',
      notes: '',
    };
    tasks.value = { ...tasks.value, tasks: [...tasks.value.tasks, task] };
    await flushOutgoing();
    process.stdout.write(`added ${task.tid}: ${task.description}\n`);
    return 0;
  });
}

function taskMutate(tid: string, mutator: (t: Task) => Task, label: string): Promise<number> {
  return withMesh(async ({ tasks }) => {
    const exists = tasks.value.tasks.find((t) => t.tid === tid);
    if (!exists) {
      process.stderr.write(`fairfox todo: no task with tid "${tid}".\n`);
      return Promise.resolve(1);
    }
    tasks.value = {
      ...tasks.value,
      tasks: tasks.value.tasks.map((t) => (t.tid === tid ? mutator(t) : t)),
    };
    await flushOutgoing();
    process.stdout.write(`${label} ${tid}\n`);
    return 0;
  });
}

function taskDone(tid: string): Promise<number> {
  return taskMutate(tid, (t) => ({ ...t, done: true }), 'done');
}

function taskReopen(tid: string): Promise<number> {
  return taskMutate(tid, (t) => ({ ...t, done: false }), 'reopened');
}

function taskDelete(tid: string): Promise<number> {
  return withMesh(async ({ tasks }) => {
    const before = tasks.value.tasks.length;
    tasks.value = {
      ...tasks.value,
      tasks: tasks.value.tasks.filter((t) => t.tid !== tid),
    };
    if (tasks.value.tasks.length === before) {
      process.stderr.write(`fairfox todo: no task with tid "${tid}".\n`);
      return Promise.resolve(1);
    }
    await flushOutgoing();
    process.stdout.write(`deleted ${tid}\n`);
    return 0;
  });
}

interface FieldPair {
  field: string;
  value: string;
}

function parseFields(rest: readonly string[]): FieldPair[] {
  const out: FieldPair[] = [];
  for (const arg of rest) {
    const eq = arg.indexOf('=');
    if (eq > 0) {
      out.push({ field: arg.slice(0, eq), value: arg.slice(eq + 1) });
    }
  }
  return out;
}

function taskUpdate(tid: string, rest: readonly string[]): Promise<number> {
  const pairs = parseFields(rest);
  if (pairs.length === 0) {
    process.stderr.write(
      'fairfox todo task update: expected one or more field=value pairs (description, project, priority, links, notes).\n'
    );
    return Promise.resolve(1);
  }
  return taskMutate(
    tid,
    (t) => {
      const patch: Partial<Task> = {};
      for (const pair of pairs) {
        if (pair.field === 'priority' && !isTaskPriority(pair.value)) {
          continue;
        }
        patch[pair.field] = pair.value;
      }
      return { ...t, ...patch };
    },
    'updated'
  );
}

// --- Projects ---

function formatProject(p: Project, taskCount: number): string {
  const status = p.status.padEnd(8, ' ');
  const category = p.category === 'amboss' ? 'amboss' : 'person';
  return `${p.pid}  ${status} ${category}  ${p.name}  (${taskCount} open)`;
}

interface ProjectFilters {
  status?: ProjectStatus;
}

function parseProjectFilters(rest: readonly string[]): ProjectFilters {
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--status') {
      const next = rest[i + 1];
      if (next !== undefined && isProjectStatus(next)) {
        return { status: next };
      }
    }
  }
  return {};
}

function projectsList(rest: readonly string[]): Promise<number> {
  const filters = parseProjectFilters(rest);
  return withMesh(({ projects, tasks }) => {
    let list = projects.value.projects;
    if (filters.status) {
      list = list.filter((p) => p.status === filters.status);
    }
    if (list.length === 0) {
      process.stdout.write('(no matching projects)\n');
      return 0;
    }
    for (const p of list) {
      const openTasks = tasks.value.tasks.filter((t) => t.project === p.name && !t.done).length;
      process.stdout.write(`${formatProject(p, openTasks)}\n`);
    }
    return 0;
  });
}

function projectAdd(rest: readonly string[]): Promise<number> {
  const positional: string[] = [];
  let category: ProjectCategory = 'personal';
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--category') {
      const next = rest[i + 1];
      if (next === 'personal' || next === 'amboss') {
        category = next;
        i += 1;
      }
    } else if (typeof arg === 'string') {
      positional.push(arg);
    }
  }
  const name = positional.join(' ').trim();
  if (!name) {
    process.stderr.write(
      'fairfox todo project add: expected a name. Usage: fairfox todo project add "i18n" [--category amboss|personal]\n'
    );
    return Promise.resolve(1);
  }
  return withMesh(async ({ projects }) => {
    const project: Project = {
      pid: generateId('P'),
      name,
      parent: null,
      category,
      type: 'coding',
      status: 'active',
      dirs: '',
      skills: '',
      notes: '',
      sortOrder: projects.value.projects.length,
    };
    projects.value = {
      ...projects.value,
      projects: [...projects.value.projects, project],
    };
    await flushOutgoing();
    process.stdout.write(`added ${project.pid}: ${project.name}\n`);
    return 0;
  });
}

function projectUpdate(pid: string, rest: readonly string[]): Promise<number> {
  const pairs = parseFields(rest);
  if (pairs.length === 0) {
    process.stderr.write(
      'fairfox todo project update: expected field=value pairs (name, category, status, notes, dirs, skills).\n'
    );
    return Promise.resolve(1);
  }
  return withMesh(async ({ projects }) => {
    const exists = projects.value.projects.find((p) => p.pid === pid);
    if (!exists) {
      process.stderr.write(`fairfox todo: no project with pid "${pid}".\n`);
      return Promise.resolve(1);
    }
    projects.value = {
      ...projects.value,
      projects: projects.value.projects.map((p) => {
        if (p.pid !== pid) {
          return p;
        }
        const patch: Partial<Project> = {};
        for (const pair of pairs) {
          if (pair.field === 'status' && !isProjectStatus(pair.value)) {
            continue;
          }
          if (pair.field === 'category' && pair.value !== 'personal' && pair.value !== 'amboss') {
            continue;
          }
          patch[pair.field] = pair.field === 'parent' && pair.value === '' ? null : pair.value;
        }
        return { ...p, ...patch };
      }),
    };
    await flushOutgoing();
    process.stdout.write(`updated ${pid}\n`);
    return 0;
  });
}

function projectDelete(pid: string): Promise<number> {
  return withMesh(async ({ projects }) => {
    const before = projects.value.projects.length;
    projects.value = {
      ...projects.value,
      projects: projects.value.projects.filter((p) => p.pid !== pid),
    };
    if (projects.value.projects.length === before) {
      process.stderr.write(`fairfox todo: no project with pid "${pid}".\n`);
      return Promise.resolve(1);
    }
    await flushOutgoing();
    process.stdout.write(`deleted ${pid}\n`);
    return 0;
  });
}

// --- Captures ---

function captureAdd(text: string): Promise<number> {
  if (!text.trim()) {
    process.stderr.write('fairfox todo capture add: expected text.\n');
    return Promise.resolve(1);
  }
  return withMesh(async ({ captures }) => {
    const capture: QuickCapture = {
      id: generateId('C'),
      text,
      createdAt: new Date().toISOString(),
    };
    captures.value = {
      ...captures.value,
      captures: [...captures.value.captures, capture],
    };
    await flushOutgoing();
    process.stdout.write(`added ${capture.id}: ${text}\n`);
    return 0;
  });
}

function captureList(): Promise<number> {
  return withMesh(({ captures }) => {
    if (captures.value.captures.length === 0) {
      process.stdout.write('(no captures)\n');
      return 0;
    }
    for (const c of captures.value.captures) {
      const when = new Date(c.createdAt).toISOString().slice(0, 10);
      process.stdout.write(`${c.id}  ${when}  ${c.text}\n`);
    }
    return 0;
  });
}

function captureDelete(id: string): Promise<number> {
  return withMesh(async ({ captures }) => {
    const before = captures.value.captures.length;
    captures.value = {
      ...captures.value,
      captures: captures.value.captures.filter((c) => c.id !== id),
    };
    if (captures.value.captures.length === before) {
      process.stderr.write(`fairfox todo: no capture with id "${id}".\n`);
      return Promise.resolve(1);
    }
    await flushOutgoing();
    process.stdout.write(`deleted ${id}\n`);
    return 0;
  });
}

// --- Legacy import ---
//
// One-shot pull from the legacy REST `/todo` sub-app into the three
// mesh documents. Mirrors the browser's `migrateFromLegacy` but runs
// from the CLI so there's no click-through required. Idempotent:
// re-running overwrites the three mesh docs with the latest legacy
// state. Legacy records keep their original ids so anything
// referencing a project by name or a task by tid still resolves.

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

function toProjectCategory(c: string): ProjectCategory {
  return c === 'amboss' ? 'amboss' : 'personal';
}

function toProjectStatusOrActive(s: string): ProjectStatus {
  return isProjectStatus(s) ? s : 'active';
}

function toTaskPriorityOrMed(p: string): TaskPriority {
  return isTaskPriority(p) ? p : 'med';
}

function importLegacy(rest: readonly string[]): Promise<number> {
  const baseArg = rest[0] ?? 'https://fairfox-production-8273.up.railway.app/todo';
  const base = baseArg.replace(/\/$/, '');
  return withMesh(async ({ projects, tasks, captures }, peered) => {
    if (!peered) {
      process.stderr.write(
        'fairfox todo import-legacy: no mesh peers reachable; the mesh writes land locally and will propagate on next sync.\n'
      );
    }
    const [legacyProjects, legacyTasks, legacyCaptures] = await Promise.all([
      fetch(`${base}/api/projects`).then((r) => r.json() as Promise<LegacyProject[]>),
      fetch(`${base}/api/tasks`).then((r) => r.json() as Promise<LegacyTask[]>),
      fetch(`${base}/api/quick-capture`).then((r) => r.json() as Promise<LegacyCapture[]>),
    ]);

    const nextProjects: Project[] = legacyProjects.map((p) => ({
      pid: p.pid,
      name: p.name,
      parent: p.parent,
      category: toProjectCategory(p.category),
      type: p.type,
      status: toProjectStatusOrActive(p.status),
      dirs: p.dirs,
      skills: p.skills,
      notes: p.notes,
      sortOrder: p.sort_order,
    }));
    const nextTasks: Task[] = legacyTasks.map((t) => ({
      tid: t.tid,
      done: t.done === 1,
      description: t.description,
      project: t.project,
      priority: toTaskPriorityOrMed(t.priority),
      links: t.links,
      notes: t.notes,
    }));
    const nextCaptures: QuickCapture[] = legacyCaptures.map((c) => ({
      id: String(c.id),
      text: c.text,
      createdAt: c.created_at,
    }));

    projects.value = { projects: nextProjects };
    tasks.value = { tasks: nextTasks };
    captures.value = { captures: nextCaptures };

    await flushOutgoing(2000);

    process.stdout.write(
      `imported ${nextProjects.length} projects, ${nextTasks.length} tasks, ${nextCaptures.length} captures from ${base}\n`
    );
    return 0;
  });
}

// --- Dispatcher ---

export function todoUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    [
      'fairfox todo — mesh-backed todo commands',
      '',
      'Usage:',
      '  fairfox todo tasks [--done] [--project P] [--priority high|med|low]',
      '  fairfox todo task add <description> [--project P] [--priority high|med|low]',
      '  fairfox todo task done <tid>',
      '  fairfox todo task reopen <tid>',
      '  fairfox todo task delete <tid>',
      '  fairfox todo task update <tid> <field>=<value> ...',
      '',
      '  fairfox todo projects [--status active|paused|done|archived]',
      '  fairfox todo project add <name> [--category personal|amboss]',
      '  fairfox todo project update <pid> <field>=<value> ...',
      '  fairfox todo project delete <pid>',
      '',
      '  fairfox todo capture add <text>',
      '  fairfox todo captures',
      '  fairfox todo capture delete <id>',
      '',
      '  fairfox todo import-legacy [base]   Pull the legacy REST /todo into the mesh.',
      '                                      Default base: https://fairfox-production-8273',
      '                                      .up.railway.app/todo',
      '',
    ].join('\n')
  );
}

export function todo(rest: readonly string[]): Promise<number> {
  const [verb, ...args] = rest;
  if (!verb) {
    todoUsage();
    return Promise.resolve(1);
  }

  if (verb === 'tasks') {
    return tasksList(args);
  }
  if (verb === 'task') {
    const [subverb, ...subargs] = args;
    if (subverb === 'add') {
      return taskAdd(subargs);
    }
    if (subverb === 'done' && subargs[0]) {
      return taskDone(subargs[0]);
    }
    if (subverb === 'reopen' && subargs[0]) {
      return taskReopen(subargs[0]);
    }
    if (subverb === 'delete' && subargs[0]) {
      return taskDelete(subargs[0]);
    }
    if (subverb === 'update' && subargs[0]) {
      return taskUpdate(subargs[0], subargs.slice(1));
    }
    todoUsage();
    return Promise.resolve(1);
  }

  if (verb === 'projects') {
    return projectsList(args);
  }
  if (verb === 'project') {
    const [subverb, ...subargs] = args;
    if (subverb === 'add') {
      return projectAdd(subargs);
    }
    if (subverb === 'update' && subargs[0]) {
      return projectUpdate(subargs[0], subargs.slice(1));
    }
    if (subverb === 'delete' && subargs[0]) {
      return projectDelete(subargs[0]);
    }
    todoUsage();
    return Promise.resolve(1);
  }

  if (verb === 'import-legacy') {
    return importLegacy(args);
  }

  if (verb === 'captures') {
    return captureList();
  }
  if (verb === 'capture') {
    const [subverb, ...subargs] = args;
    if (subverb === 'add') {
      return captureAdd(subargs.join(' '));
    }
    if (subverb === 'list') {
      return captureList();
    }
    if (subverb === 'delete' && subargs[0]) {
      return captureDelete(subargs[0]);
    }
    todoUsage();
    return Promise.resolve(1);
  }

  todoUsage();
  return Promise.resolve(1);
}
