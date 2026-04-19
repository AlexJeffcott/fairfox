// Action registry for the Todo sub-app.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { setActiveTab, setSelectedTaskId } from '#src/client/App.tsx';
import { migrateFromLegacy } from '#src/client/migrate.ts';
import type { Project, QuickCapture, Task, TaskPriority } from '#src/client/state.ts';
import { capturesState, projectsState, tasksState } from '#src/client/state.ts';

let migrationInFlight = false;

interface HandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

function generateId(prefix: string): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function isTaskPriority(s: string): s is TaskPriority {
  return s === 'high' || s === 'med' || s === 'low';
}

function isProjectStatus(s: string): s is Project['status'] {
  return s === 'active' || s === 'paused' || s === 'done' || s === 'archived';
}

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,
  ...buildFreshnessActions,

  // --- Projects ---
  'project.create': (ctx) => {
    const name = ctx.data.value ?? ctx.data.name;
    if (!name) {
      return;
    }
    const project: Project = {
      pid: generateId('P'),
      name,
      parent: null,
      category: 'personal',
      type: 'coding',
      status: 'active',
      dirs: '',
      skills: '',
      notes: '',
      sortOrder: projectsState.value.projects.length,
    };
    projectsState.value = {
      ...projectsState.value,
      projects: [...projectsState.value.projects, project],
    };
  },

  'project.update-status': (ctx) => {
    const pid = ctx.data.pid;
    const status = ctx.data.status;
    if (!pid || !status || !isProjectStatus(status)) {
      return;
    }
    projectsState.value = {
      ...projectsState.value,
      projects: projectsState.value.projects.map((p) => (p.pid === pid ? { ...p, status } : p)),
    };
  },

  'project.delete': (ctx) => {
    const pid = ctx.data.pid;
    if (!pid) {
      return;
    }
    projectsState.value = {
      ...projectsState.value,
      projects: projectsState.value.projects.filter((p) => p.pid !== pid),
    };
  },

  // --- Tasks ---
  'task.create': (ctx) => {
    const description = ctx.data.value ?? ctx.data.description;
    const project = ctx.data.project ?? '';
    if (!description) {
      return;
    }
    const task: Task = {
      tid: generateId('T'),
      done: false,
      description,
      project,
      priority: 'med',
      links: '',
      notes: '',
    };
    tasksState.value = {
      ...tasksState.value,
      tasks: [...tasksState.value.tasks, task],
    };
  },

  'task.toggle-done': (ctx) => {
    const tid = ctx.data.tid;
    if (!tid) {
      return;
    }
    tasksState.value = {
      ...tasksState.value,
      tasks: tasksState.value.tasks.map((t) => (t.tid === tid ? { ...t, done: !t.done } : t)),
    };
  },

  'task.set-priority': (ctx) => {
    const tid = ctx.data.tid;
    const priority = ctx.data.priority;
    if (!tid || !priority || !isTaskPriority(priority)) {
      return;
    }
    tasksState.value = {
      ...tasksState.value,
      tasks: tasksState.value.tasks.map((t) => (t.tid === tid ? { ...t, priority } : t)),
    };
  },

  'task.update-notes': (ctx) => {
    const tid = ctx.data.tid;
    const notes = ctx.data.value ?? '';
    if (!tid) {
      return;
    }
    tasksState.value = {
      ...tasksState.value,
      tasks: tasksState.value.tasks.map((t) => (t.tid === tid ? { ...t, notes } : t)),
    };
  },

  'task.delete': (ctx) => {
    const tid = ctx.data.tid;
    if (!tid) {
      return;
    }
    tasksState.value = {
      ...tasksState.value,
      tasks: tasksState.value.tasks.filter((t) => t.tid !== tid),
    };
  },

  // --- Detail-view navigation ---

  'task.open': (ctx) => {
    if (ctx.data.tid) {
      setSelectedTaskId(ctx.data.tid);
    }
  },

  'task.close': () => {
    setSelectedTaskId(null);
  },

  'task.new': () => {
    const task: Task = {
      tid: generateId('T'),
      done: false,
      description: '',
      project: '',
      priority: 'med',
      links: '',
      notes: '',
    };
    tasksState.value = {
      ...tasksState.value,
      tasks: [...tasksState.value.tasks, task],
    };
    setSelectedTaskId(task.tid);
  },

  'task.delete-and-close': (ctx) => {
    const tid = ctx.data.tid;
    if (!tid) {
      return;
    }
    tasksState.value = {
      ...tasksState.value,
      tasks: tasksState.value.tasks.filter((t) => t.tid !== tid),
    };
    setSelectedTaskId(null);
  },

  /**
   * `task.update` is the catch-all field editor used by the detail view.
   * The source element carries `data-action-field` for the field name and
   * `data-action-tid` for the target; the value comes from either
   * `data-action-value` (ActionInput commits) or the event target's own
   * `value` (a native <select> fires change with no data attribute).
   * Unknown or blank fields are ignored so callers can hand-wave missing
   * data without crashing the dispatcher.
   */
  'task.update': (ctx) => {
    const tid = ctx.data.tid;
    const field = ctx.data.field;
    if (!tid || !field) {
      return;
    }
    let value = ctx.data.value;
    if (value === undefined) {
      const target = ctx.event.target;
      if (target instanceof HTMLSelectElement || target instanceof HTMLInputElement) {
        value = target.value;
      }
    }
    if (value === undefined) {
      return;
    }
    if (field === 'priority' && !isTaskPriority(value)) {
      return;
    }
    const patch: Partial<Task> = { [field]: value };
    tasksState.value = {
      ...tasksState.value,
      tasks: tasksState.value.tasks.map((t) => (t.tid === tid ? { ...t, ...patch } : t)),
    };
  },

  // --- Quick Capture ---
  'capture.add': (ctx) => {
    const text = ctx.data.value;
    if (!text) {
      return;
    }
    const capture: QuickCapture = {
      id: generateId('QC'),
      text,
      createdAt: new Date().toISOString(),
    };
    capturesState.value = {
      ...capturesState.value,
      captures: [...capturesState.value.captures, capture],
    };
  },

  'capture.delete': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    capturesState.value = {
      ...capturesState.value,
      captures: capturesState.value.captures.filter((c) => c.id !== id),
    };
  },

  // --- Navigation ---
  'todo.tab': (ctx) => {
    const id = ctx.data.id;
    if (id) {
      setActiveTab(id);
    }
  },

  // --- One-shot migration from the legacy todo REST API. Writes
  // directly into $meshState so the migrated records propagate to
  // every paired device. Idempotent — running it twice overwrites.
  'migrate.from-legacy': () => {
    if (migrationInFlight) {
      return;
    }
    migrationInFlight = true;
    (async () => {
      try {
        const result = await migrateFromLegacy();
        console.log(
          `[migrate] ok — ${result.projects} projects, ${result.tasks} tasks, ${result.captures} captures`
        );
      } catch (err) {
        console.error('[migrate] failed:', err);
      } finally {
        migrationInFlight = false;
      }
    })();
  },
};
