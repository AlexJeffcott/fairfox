// Action registry for the Todo sub-app.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import {
  filterPriority,
  filterProjectName,
  setActiveTab,
  setFilterPriority,
  setFilterProjectName,
  setSelectedProjectId,
  setSelectedTaskId,
  showDone,
  toggleShowDone,
} from '#src/client/App.tsx';
import type {
  Project,
  ProjectCategory,
  QuickCapture,
  Task,
  TaskPriority,
} from '#src/client/state.ts';
import { capturesState, projectsState, tasksState } from '#src/client/state.ts';

function isProjectCategory(s: string): s is ProjectCategory {
  return s === 'personal' || s === 'amboss';
}

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

/** Actions that mutate `todo:*` CRDT state and therefore require
 * `todo.write`. View-state toggles (`*.open`, `*.close`, `*.new`,
 * `todo.tab`) only flip local signals and stay unguarded. Exported
 * so the unified shell's dispatcher can gate the same set without
 * duplicating the list. */
export const TODO_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  'project.create',
  'project.update-status',
  'project.delete',
  'project.delete-and-close',
  'project.update',
  'task.create',
  'task.toggle-done',
  'task.set-priority',
  'task.update-notes',
  'task.delete',
  'task.delete-and-close',
  'task.update',
  'capture.add',
  'capture.delete',
  'capture.update',
  'capture.promote',
]);

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
    projectsState.handle?.change((doc) => {
      doc.projects.push(project);
    });
  },

  'project.update-status': (ctx) => {
    const pid = ctx.data.pid;
    const status = ctx.data.status;
    if (!pid || !status || !isProjectStatus(status)) {
      return;
    }
    projectsState.handle?.change((doc) => {
      const target = doc.projects.find((p) => p.pid === pid);
      if (target) {
        target.status = status;
      }
    });
  },

  'project.delete': (ctx) => {
    const pid = ctx.data.pid;
    if (!pid) {
      return;
    }
    projectsState.handle?.change((doc) => {
      const idx = doc.projects.findIndex((p) => p.pid === pid);
      if (idx >= 0) {
        doc.projects.splice(idx, 1);
      }
    });
  },

  // --- Project detail navigation ---

  'project.open': (ctx) => {
    if (ctx.data.pid) {
      setSelectedProjectId(ctx.data.pid);
    }
  },

  'project.close': () => {
    setSelectedProjectId(null);
  },

  'project.new': () => {
    const project: Project = {
      pid: generateId('P'),
      name: '',
      parent: null,
      category: 'personal',
      type: 'coding',
      status: 'active',
      dirs: '',
      skills: '',
      notes: '',
      sortOrder: projectsState.value.projects.length,
    };
    projectsState.handle?.change((doc) => {
      doc.projects.push(project);
    });
    setSelectedProjectId(project.pid);
  },

  'project.delete-and-close': (ctx) => {
    const pid = ctx.data.pid;
    if (!pid) {
      return;
    }
    projectsState.handle?.change((doc) => {
      const idx = doc.projects.findIndex((p) => p.pid === pid);
      if (idx >= 0) {
        doc.projects.splice(idx, 1);
      }
    });
    setSelectedProjectId(null);
  },

  /**
   * Mirror of `task.update`. The detail view fires this for every field on
   * blur or on `<select>` change; the handler dispatches by `field` and
   * validates the narrow enum fields (category, status) before writing.
   * A blank `parent` collapses to null so the mesh doc stays clean.
   */
  'project.update': (ctx) => {
    const pid = ctx.data.pid;
    const field = ctx.data.field;
    if (!pid || !field) {
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
    if (field === 'category' && !isProjectCategory(value)) {
      return;
    }
    if (field === 'status' && !isProjectStatus(value)) {
      return;
    }
    const normalised = field === 'parent' && value === '' ? null : value;
    projectsState.handle?.change((doc) => {
      const target = doc.projects.find((p) => p.pid === pid);
      if (!target) {
        return;
      }
      const fields = target as unknown as Record<string, unknown>;
      fields[field] = normalised;
    });
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
    tasksState.handle?.change((doc) => {
      doc.tasks.push(task);
    });
  },

  'task.toggle-done': (ctx) => {
    const tid = ctx.data.tid;
    if (!tid) {
      return;
    }
    tasksState.handle?.change((doc) => {
      const target = doc.tasks.find((t) => t.tid === tid);
      if (target) {
        target.done = !target.done;
      }
    });
  },

  'task.set-priority': (ctx) => {
    const tid = ctx.data.tid;
    const priority = ctx.data.priority;
    if (!tid || !priority || !isTaskPriority(priority)) {
      return;
    }
    tasksState.handle?.change((doc) => {
      const target = doc.tasks.find((t) => t.tid === tid);
      if (target) {
        target.priority = priority;
      }
    });
  },

  'task.update-notes': (ctx) => {
    const tid = ctx.data.tid;
    const notes = ctx.data.value ?? '';
    if (!tid) {
      return;
    }
    tasksState.handle?.change((doc) => {
      const target = doc.tasks.find((t) => t.tid === tid);
      if (target) {
        target.notes = notes;
      }
    });
  },

  'task.delete': (ctx) => {
    const tid = ctx.data.tid;
    if (!tid) {
      return;
    }
    tasksState.handle?.change((doc) => {
      const idx = doc.tasks.findIndex((t) => t.tid === tid);
      if (idx >= 0) {
        doc.tasks.splice(idx, 1);
      }
    });
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
    tasksState.handle?.change((doc) => {
      doc.tasks.push(task);
    });
    setSelectedTaskId(task.tid);
  },

  'task.delete-and-close': (ctx) => {
    const tid = ctx.data.tid;
    if (!tid) {
      return;
    }
    tasksState.handle?.change((doc) => {
      const idx = doc.tasks.findIndex((t) => t.tid === tid);
      if (idx >= 0) {
        doc.tasks.splice(idx, 1);
      }
    });
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
    tasksState.handle?.change((doc) => {
      const target = doc.tasks.find((t) => t.tid === tid);
      if (!target) {
        return;
      }
      const fields = target as unknown as Record<string, unknown>;
      fields[field] = value;
    });
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
    capturesState.handle?.change((doc) => {
      doc.captures.push(capture);
    });
  },

  'capture.delete': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    capturesState.handle?.change((doc) => {
      const idx = doc.captures.findIndex((c) => c.id === id);
      if (idx >= 0) {
        doc.captures.splice(idx, 1);
      }
    });
  },

  'capture.update': (ctx) => {
    const id = ctx.data.id;
    const text = ctx.data.value;
    if (!id || text === undefined) {
      return;
    }
    capturesState.handle?.change((doc) => {
      const target = doc.captures.find((c) => c.id === id);
      if (target) {
        target.text = text;
      }
    });
  },

  /**
   * Promote a capture into a full task. The new task inherits the capture's
   * text as its description, the capture is deleted (so the same thought
   * doesn't linger in two places), and the UI navigates into the task
   * detail pane so the user can fill in project, priority, and notes.
   */
  'capture.promote': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    const capture = capturesState.value.captures.find((c) => c.id === id);
    if (!capture) {
      return;
    }
    const task: Task = {
      tid: generateId('T'),
      done: false,
      description: capture.text,
      project: '',
      priority: 'med',
      links: '',
      notes: '',
    };
    tasksState.handle?.change((doc) => {
      doc.tasks.push(task);
    });
    capturesState.handle?.change((doc) => {
      const idx = doc.captures.findIndex((c) => c.id === id);
      if (idx >= 0) {
        doc.captures.splice(idx, 1);
      }
    });
    setActiveTab('tasks');
    setSelectedTaskId(task.tid);
  },

  // --- Navigation ---
  'todo.tab': (ctx) => {
    const id = ctx.data.id;
    if (id) {
      setActiveTab(id);
    }
  },

  // --- Tasks-view filters ---
  // Native <select> doesn't surface its value through data-action-*
  // attributes, so we read it off event.target like `project.update`
  // does. ctx.data.value is only populated for ActionInput-style
  // primitives that set data-action-value in the dispatched event.
  'tasks.set-filter-project': (ctx) => {
    const target = ctx.event.target;
    if (target instanceof HTMLSelectElement) {
      setFilterProjectName(target.value);
    }
  },
  'tasks.set-filter-priority': (ctx) => {
    const target = ctx.event.target;
    if (target instanceof HTMLSelectElement) {
      setFilterPriority(target.value);
    }
  },
  'tasks.toggle-show-done': () => {
    toggleShowDone();
  },
  'tasks.clear-filters': () => {
    filterProjectName.value = '';
    filterPriority.value = '';
    showDone.value = false;
  },
};
