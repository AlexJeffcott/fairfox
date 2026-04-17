// Todo state — project tracker with tasks and quick capture.
//
// Three $meshState documents keep each entity type in its own CRDT
// so that large task lists don't bloat the project metadata document.

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';

export type ProjectStatus = 'active' | 'paused' | 'done' | 'archived';
export type ProjectCategory = 'amboss' | 'personal';
export type TaskPriority = 'high' | 'med' | 'low';

export interface Project {
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

export interface Task {
  [key: string]: unknown;
  tid: string;
  done: boolean;
  description: string;
  project: string;
  priority: TaskPriority;
  links: string;
  notes: string;
}

export interface QuickCapture {
  [key: string]: unknown;
  id: string;
  text: string;
  createdAt: string;
}

export interface ProjectsDoc {
  [key: string]: unknown;
  projects: Project[];
}

export interface TasksDoc {
  [key: string]: unknown;
  tasks: Task[];
}

export interface CapturesDoc {
  [key: string]: unknown;
  captures: QuickCapture[];
}

export const projectsState = $meshState<ProjectsDoc>('todo:projects', { projects: [] });
export const tasksState = $meshState<TasksDoc>('todo:tasks', { tasks: [] });
export const capturesState = $meshState<CapturesDoc>('todo:captures', { captures: [] });
