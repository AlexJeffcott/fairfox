// Action registry for the Todo sub-app.

import type { Project, QuickCapture, Task, TaskPriority } from '#src/client/state.ts';
import { capturesState, projectsState, tasksState } from '#src/client/state.ts';

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

export const registry: Record<string, (ctx: HandlerContext) => void> = {
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
    if (!pid || !status) {
      return;
    }
    projectsState.value = {
      ...projectsState.value,
      projects: projectsState.value.projects.map((p) =>
        p.pid === pid ? { ...p, status: status as Project['status'] } : p
      ),
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
  'todo.tab': () => {
    // Tab changes handled by local signal in App — no CRDT mutation.
  },
};
