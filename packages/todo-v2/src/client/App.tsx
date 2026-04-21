/** @jsxImportSource preact */
// Todo sub-app — project tracker with tasks and quick capture.
// Three views: Projects, Tasks, Capture. All state from $meshState.

import { ActionInput, Badge, Button, Checkbox, Layout, Tabs } from '@fairfox/polly/ui';
import { HubBack } from '@fairfox/shared/hub-back';
import { signal } from '@preact/signals';
import { capturesState, projectsState, tasksState } from '#src/client/state.ts';

export type ViewId = 'projects' | 'tasks' | 'capture';

export const activeTab = signal<ViewId>('tasks');

function isViewId(v: string): v is ViewId {
  return v === 'projects' || v === 'tasks' || v === 'capture';
}

export function setActiveTab(v: string): void {
  if (isViewId(v)) {
    activeTab.value = v;
  }
}

/**
 * Selected task id drives the Tasks pane. When null the pane shows the list;
 * when set to a tid the pane shows the detail view for that task, whether it
 * exists or was just created via `task.new`. Navigation back clears the
 * signal; the detail view and the list never render simultaneously.
 */
export const selectedTaskId = signal<string | null>(null);

export function setSelectedTaskId(v: string | null): void {
  selectedTaskId.value = v;
}

/** Same shape for the Projects pane — list versus detail toggle. */
export const selectedProjectId = signal<string | null>(null);

export function setSelectedProjectId(v: string | null): void {
  selectedProjectId.value = v;
}

/**
 * Filter state for the Tasks pane. Module-level so the selector UI
 * can drive it through `data-action` handlers without inline
 * onChange props (which the lint rule bans).
 *
 * `filterProjectName` is empty-string for "any project"; otherwise
 * the exact project name — tasks carry their parent as a string,
 * not a pid, so we match on name. `filterPriority` is '' for any.
 * `showDone` toggles whether completed tasks appear in the list.
 */
export const filterProjectName = signal<string>('');
export const filterPriority = signal<'' | 'high' | 'med' | 'low'>('');
export const showDone = signal<boolean>(false);

export function setFilterProjectName(v: string): void {
  filterProjectName.value = v;
}

export function setFilterPriority(v: string): void {
  if (v === '' || v === 'high' || v === 'med' || v === 'low') {
    filterPriority.value = v;
  }
}

export function toggleShowDone(): void {
  showDone.value = !showDone.value;
}

const TAB_LIST = [
  { id: 'projects', label: 'Projects' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'capture', label: 'Capture' },
];

const PRIORITY_COLORS = {
  high: 'danger',
  med: 'warning',
  low: 'info',
} as const;

function ProjectsView() {
  const activeProjects = projectsState.value.projects.filter((p) => p.status === 'active');
  const pausedProjects = projectsState.value.projects.filter((p) => p.status === 'paused');
  const total = projectsState.value.projects.length;

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <span style={{ color: 'var(--polly-text-muted)' }}>
          {total} project{total === 1 ? '' : 's'}
        </span>
        <Button label="+ New project" tier="primary" size="small" data-action="project.new" />
      </Layout>
      {activeProjects.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <h3>Active ({activeProjects.length})</h3>
          {activeProjects.map((p) => {
            const taskCount = tasksState.value.tasks.filter(
              (t) => t.project === p.name && !t.done
            ).length;
            return (
              <Layout
                key={p.pid}
                columns="1fr auto auto"
                gap="var(--polly-space-sm)"
                alignItems="center"
              >
                <div
                  data-action="project.open"
                  data-action-pid={p.pid}
                  style={{ cursor: 'pointer', display: 'grid', gap: 0 }}
                >
                  <strong>{p.name || '(untitled)'}</strong>
                  {p.notes && (
                    <span
                      data-polly-clamp={true}
                      style={{
                        fontSize: 'var(--polly-text-sm)',
                        color: 'var(--polly-text-muted)',
                        '--polly-clamp': 1,
                      }}
                    >
                      {p.notes}
                    </span>
                  )}
                </div>
                <Badge variant="default">{taskCount} tasks</Badge>
                <Button
                  label="Pause"
                  size="small"
                  tier="tertiary"
                  data-action="project.update-status"
                  data-action-pid={p.pid}
                  data-action-status="paused"
                />
              </Layout>
            );
          })}
        </Layout>
      )}
      {pausedProjects.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <h3>Paused ({pausedProjects.length})</h3>
          {pausedProjects.map((p) => (
            <Layout key={p.pid} columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
              <span
                data-action="project.open"
                data-action-pid={p.pid}
                style={{ color: 'var(--polly-text-muted)', cursor: 'pointer' }}
              >
                {p.name || '(untitled)'}
              </span>
              <Button
                label="Resume"
                size="small"
                tier="tertiary"
                color="success"
                data-action="project.update-status"
                data-action-pid={p.pid}
                data-action-status="active"
              />
            </Layout>
          ))}
        </Layout>
      )}
    </Layout>
  );
}

function TaskFilters({ projectNames }: { projectNames: string[] }) {
  const SELECT_STYLE = {
    font: 'inherit',
    padding: 'var(--polly-space-xs) var(--polly-space-sm)',
    border: '1px solid var(--polly-border)',
    borderRadius: 'var(--polly-radius-md)',
    background: 'var(--polly-surface)',
    color: 'var(--polly-text)',
  };
  return (
    <Layout
      columns="auto auto auto"
      gap="var(--polly-space-sm)"
      alignItems="center"
      justifyContent="start"
    >
      <Layout columns="auto auto" gap="var(--polly-space-xs)" alignItems="center">
        <label
          for="task-filter-project"
          style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}
        >
          Project
        </label>
        <select
          id="task-filter-project"
          data-action="tasks.set-filter-project"
          value={filterProjectName.value}
          style={SELECT_STYLE}
        >
          <option value="">(any)</option>
          {projectNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Layout>
      <Layout columns="auto auto" gap="var(--polly-space-xs)" alignItems="center">
        <label
          for="task-filter-priority"
          style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}
        >
          Priority
        </label>
        <select
          id="task-filter-priority"
          data-action="tasks.set-filter-priority"
          value={filterPriority.value}
          style={SELECT_STYLE}
        >
          <option value="">(any)</option>
          <option value="high">high</option>
          <option value="med">med</option>
          <option value="low">low</option>
        </select>
      </Layout>
      <Layout columns="auto auto" gap="var(--polly-space-xs)" alignItems="center">
        <span data-action="tasks.toggle-show-done">
          <Checkbox checked={showDone.value} />
        </span>
        <span style={{ fontSize: 'var(--polly-text-sm)' }}>Show done</span>
      </Layout>
    </Layout>
  );
}

function TasksView() {
  const tasks = tasksState.value.tasks.filter((t) => {
    if (!showDone.value && t.done) {
      return false;
    }
    if (filterProjectName.value && t.project !== filterProjectName.value) {
      return false;
    }
    if (filterPriority.value && t.priority !== filterPriority.value) {
      return false;
    }
    return true;
  });

  const byPriority = {
    high: tasks.filter((t) => t.priority === 'high' && !t.done),
    med: tasks.filter((t) => t.priority === 'med' && !t.done),
    low: tasks.filter((t) => t.priority === 'low' && !t.done),
    done: tasks.filter((t) => t.done),
  };

  const projectNames = Array.from(
    new Set(projectsState.value.projects.map((p) => p.name).filter((n): n is string => Boolean(n)))
  ).sort();

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <span style={{ color: 'var(--polly-text-muted)' }}>
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </span>
        <Button label="+ New task" tier="primary" size="small" data-action="task.new" />
      </Layout>
      <TaskFilters projectNames={projectNames} />
      {filterProjectName.value || filterPriority.value || showDone.value ? (
        <Layout columns="auto auto 1fr" gap="var(--polly-space-sm)" alignItems="center">
          <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
            Filters on
          </span>
          <Button label="Clear" size="small" tier="tertiary" data-action="tasks.clear-filters" />
          <span />
        </Layout>
      ) : null}
      {(['high', 'med', 'low'] as const).map((prio) => {
        const group = byPriority[prio];
        if (group.length === 0) {
          return null;
        }
        return (
          <Layout key={prio} rows="auto" gap="var(--polly-space-xs)">
            <h3>
              <Badge variant={PRIORITY_COLORS[prio]}>{prio}</Badge> ({group.length})
            </h3>
            {group.map((t) => (
              <Layout
                key={t.tid}
                columns="auto 1fr auto auto"
                gap="var(--polly-space-sm)"
                alignItems="center"
              >
                <span data-action="task.toggle-done" data-action-tid={t.tid}>
                  <Checkbox checked={t.done} />
                </span>
                <span
                  data-polly-truncate={true}
                  data-action="task.open"
                  data-action-tid={t.tid}
                  style={{ cursor: 'pointer' }}
                >
                  {t.description || '(untitled)'}
                </span>
                {t.project ? (
                  <span
                    style={{
                      fontSize: 'var(--polly-text-sm)',
                      color: 'var(--polly-text-muted)',
                    }}
                  >
                    {t.project}
                  </span>
                ) : (
                  <span />
                )}
                <Button
                  label="×"
                  size="small"
                  tier="tertiary"
                  color="danger"
                  data-action="task.delete"
                  data-action-tid={t.tid}
                />
              </Layout>
            ))}
          </Layout>
        );
      })}
      {byPriority.done.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-xs)">
          <h3>Done ({byPriority.done.length})</h3>
          {byPriority.done.map((t) => (
            <Layout
              key={t.tid}
              columns="auto 1fr auto"
              gap="var(--polly-space-sm)"
              alignItems="center"
            >
              <Checkbox checked={t.done} data-action="task.toggle-done" data-action-tid={t.tid} />
              <span
                data-polly-truncate={true}
                data-action="task.open"
                data-action-tid={t.tid}
                style={{
                  textDecoration: 'line-through',
                  color: 'var(--polly-text-muted)',
                  cursor: 'pointer',
                }}
              >
                {t.description || '(untitled)'}
              </span>
              <Button
                label="×"
                size="small"
                tier="tertiary"
                color="danger"
                data-action="task.delete"
                data-action-tid={t.tid}
              />
            </Layout>
          ))}
        </Layout>
      )}
    </Layout>
  );
}

function TaskDetail({ tid }: { tid: string }) {
  const task = tasksState.value.tasks.find((t) => t.tid === tid);
  if (!task) {
    return (
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Button label="← Back" tier="tertiary" size="small" data-action="task.close" />
        <p style={{ color: 'var(--polly-text-muted)' }}>Task not found.</p>
      </Layout>
    );
  }
  const projects = projectsState.value.projects;
  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <Layout columns="auto 1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <Button label="← Back" tier="tertiary" size="small" data-action="task.close" />
        <span style={{ color: 'var(--polly-text-muted)', fontFamily: 'var(--polly-font-mono)' }}>
          {task.tid}
        </span>
        <Button
          label="Delete"
          tier="tertiary"
          color="danger"
          size="small"
          data-action="task.delete-and-close"
          data-action-tid={task.tid}
        />
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
          Description
        </span>
        <ActionInput
          value={task.description}
          variant="single"
          action="task.update"
          saveOn="blur"
          placeholder="What needs doing?"
          ariaLabel="Description"
          actionData={{ field: 'description', tid: task.tid }}
        />
      </Layout>

      <Layout columns="1fr 1fr" gap="var(--polly-space-md)">
        <Layout rows="auto" gap="var(--polly-space-xs)">
          <label
            for={`project-${task.tid}`}
            style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}
          >
            Project
          </label>
          <select
            id={`project-${task.tid}`}
            data-action="task.update"
            data-action-field="project"
            data-action-tid={task.tid}
            value={task.project}
            style={{
              font: 'inherit',
              padding: 'var(--polly-space-sm) var(--polly-space-md)',
              border: '1px solid var(--polly-border)',
              borderRadius: 'var(--polly-radius-md)',
              background: 'var(--polly-surface)',
              color: 'var(--polly-text)',
            }}
          >
            <option value="">(none)</option>
            {projects.map((p) => (
              <option key={p.pid} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </Layout>

        <Layout rows="auto" gap="var(--polly-space-xs)">
          <label
            for={`priority-${task.tid}`}
            style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}
          >
            Priority
          </label>
          <select
            id={`priority-${task.tid}`}
            data-action="task.update"
            data-action-field="priority"
            data-action-tid={task.tid}
            value={task.priority}
            style={{
              font: 'inherit',
              padding: 'var(--polly-space-sm) var(--polly-space-md)',
              border: '1px solid var(--polly-border)',
              borderRadius: 'var(--polly-radius-md)',
              background: 'var(--polly-surface)',
              color: 'var(--polly-text)',
            }}
          >
            <option value="high">high</option>
            <option value="med">med</option>
            <option value="low">low</option>
          </select>
        </Layout>
      </Layout>

      <Layout columns="auto 1fr" gap="var(--polly-space-sm)" alignItems="center">
        <span data-action="task.toggle-done" data-action-tid={task.tid}>
          <Checkbox checked={task.done} />
        </span>
        <span>Done</span>
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
          Notes
        </span>
        <ActionInput
          value={task.notes}
          variant="multi"
          action="task.update"
          saveOn="blur"
          placeholder="Context, references, decisions..."
          ariaLabel="Notes"
          actionData={{ field: 'notes', tid: task.tid }}
        />
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
          Links
        </span>
        <ActionInput
          value={task.links}
          variant="single"
          action="task.update"
          saveOn="blur"
          placeholder="One or more URLs"
          ariaLabel="Links"
          actionData={{ field: 'links', tid: task.tid }}
        />
      </Layout>
    </Layout>
  );
}

function ProjectDetail({ pid }: { pid: string }) {
  const project = projectsState.value.projects.find((p) => p.pid === pid);
  if (!project) {
    return (
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Button label="← Back" tier="tertiary" size="small" data-action="project.close" />
        <p style={{ color: 'var(--polly-text-muted)' }}>Project not found.</p>
      </Layout>
    );
  }
  const otherProjects = projectsState.value.projects.filter((p) => p.pid !== pid);
  const projectTaskCount = tasksState.value.tasks.filter((t) => t.project === project.name).length;

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <Layout columns="auto 1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <Button label="← Back" tier="tertiary" size="small" data-action="project.close" />
        <span style={{ color: 'var(--polly-text-muted)', fontFamily: 'var(--polly-font-mono)' }}>
          {project.pid} · {projectTaskCount} task{projectTaskCount === 1 ? '' : 's'}
        </span>
        <Button
          label="Delete"
          tier="tertiary"
          color="danger"
          size="small"
          data-action="project.delete-and-close"
          data-action-pid={project.pid}
        />
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
          Name
        </span>
        <ActionInput
          value={project.name}
          variant="single"
          action="project.update"
          saveOn="blur"
          placeholder="What's this project called?"
          ariaLabel="Name"
          actionData={{ field: 'name', pid: project.pid }}
        />
      </Layout>

      <Layout columns="1fr 1fr 1fr" gap="var(--polly-space-md)">
        <Layout rows="auto" gap="var(--polly-space-xs)">
          <label
            for={`category-${project.pid}`}
            style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}
          >
            Category
          </label>
          <select
            id={`category-${project.pid}`}
            data-action="project.update"
            data-action-field="category"
            data-action-pid={project.pid}
            value={project.category}
            style={{
              font: 'inherit',
              padding: 'var(--polly-space-sm) var(--polly-space-md)',
              border: '1px solid var(--polly-border)',
              borderRadius: 'var(--polly-radius-md)',
              background: 'var(--polly-surface)',
              color: 'var(--polly-text)',
            }}
          >
            <option value="personal">personal</option>
            <option value="amboss">amboss</option>
          </select>
        </Layout>

        <Layout rows="auto" gap="var(--polly-space-xs)">
          <label
            for={`status-${project.pid}`}
            style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}
          >
            Status
          </label>
          <select
            id={`status-${project.pid}`}
            data-action="project.update"
            data-action-field="status"
            data-action-pid={project.pid}
            value={project.status}
            style={{
              font: 'inherit',
              padding: 'var(--polly-space-sm) var(--polly-space-md)',
              border: '1px solid var(--polly-border)',
              borderRadius: 'var(--polly-radius-md)',
              background: 'var(--polly-surface)',
              color: 'var(--polly-text)',
            }}
          >
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="done">done</option>
            <option value="archived">archived</option>
          </select>
        </Layout>

        <Layout rows="auto" gap="var(--polly-space-xs)">
          <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
            Type
          </span>
          <ActionInput
            value={project.type}
            variant="single"
            action="project.update"
            saveOn="blur"
            placeholder="coding, research, …"
            ariaLabel="Type"
            actionData={{ field: 'type', pid: project.pid }}
          />
        </Layout>
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <label
          for={`parent-${project.pid}`}
          style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}
        >
          Parent
        </label>
        <select
          id={`parent-${project.pid}`}
          data-action="project.update"
          data-action-field="parent"
          data-action-pid={project.pid}
          value={project.parent ?? ''}
          style={{
            font: 'inherit',
            padding: 'var(--polly-space-sm) var(--polly-space-md)',
            border: '1px solid var(--polly-border)',
            borderRadius: 'var(--polly-radius-md)',
            background: 'var(--polly-surface)',
            color: 'var(--polly-text)',
          }}
        >
          <option value="">(none)</option>
          {otherProjects.map((p) => (
            <option key={p.pid} value={p.pid}>
              {p.pid} — {p.name}
            </option>
          ))}
        </select>
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
          Notes
        </span>
        <ActionInput
          value={project.notes}
          variant="multi"
          action="project.update"
          saveOn="blur"
          placeholder="Why does this project exist?"
          ariaLabel="Notes"
          actionData={{ field: 'notes', pid: project.pid }}
        />
      </Layout>

      <Layout columns="1fr 1fr" gap="var(--polly-space-md)">
        <Layout rows="auto" gap="var(--polly-space-xs)">
          <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
            Dirs
          </span>
          <ActionInput
            value={project.dirs}
            variant="single"
            action="project.update"
            saveOn="blur"
            placeholder="comma-separated repo dirs"
            ariaLabel="Dirs"
            actionData={{ field: 'dirs', pid: project.pid }}
          />
        </Layout>

        <Layout rows="auto" gap="var(--polly-space-xs)">
          <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
            Skills
          </span>
          <ActionInput
            value={project.skills}
            variant="single"
            action="project.update"
            saveOn="blur"
            placeholder="`lib:railway` `proj:x/*`"
            ariaLabel="Skills"
            actionData={{ field: 'skills', pid: project.pid }}
          />
        </Layout>
      </Layout>

      <ProjectTasks projectName={project.name} />
    </Layout>
  );
}

function ProjectTasks({ projectName }: { projectName: string }) {
  // Tasks carry their parent as a project *name*, not a pid. Match
  // on name — this is the same shape the Tasks tab uses — and split
  // open/done so the detail view reads as a focused punch list.
  const matches = tasksState.value.tasks.filter((t) => t.project === projectName);
  const open = matches.filter((t) => !t.done);
  const done = matches.filter((t) => t.done);

  if (matches.length === 0) {
    return (
      <Layout rows="auto" gap="var(--polly-space-sm)">
        <h3 style={{ margin: 0 }}>Tasks</h3>
        <p style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
          No tasks yet. Add one from the Tasks tab and set this project as its parent.
        </p>
      </Layout>
    );
  }

  return (
    <Layout rows="auto" gap="var(--polly-space-sm)">
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <h3 style={{ margin: 0 }}>
          Tasks ({open.length} open{done.length > 0 ? `, ${done.length} done` : ''})
        </h3>
      </Layout>
      {open.map((t) => (
        <Layout
          key={t.tid}
          columns="auto 1fr auto auto"
          gap="var(--polly-space-sm)"
          alignItems="center"
        >
          <Checkbox checked={t.done} data-action="task.toggle-done" data-action-tid={t.tid} />
          <span
            data-polly-truncate={true}
            data-action="task.open"
            data-action-tid={t.tid}
            style={{ cursor: 'pointer' }}
          >
            {t.description || '(untitled)'}
          </span>
          <Badge variant={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
          <Button
            label="×"
            size="small"
            tier="tertiary"
            color="danger"
            data-action="task.delete"
            data-action-tid={t.tid}
          />
        </Layout>
      ))}
      {done.length > 0 && (
        <details>
          <summary
            style={{
              cursor: 'pointer',
              color: 'var(--polly-text-muted)',
              fontSize: 'var(--polly-text-sm)',
            }}
          >
            Done ({done.length})
          </summary>
          <Layout rows="auto" gap="var(--polly-space-xs)" padding="var(--polly-space-xs) 0 0 0">
            {done.map((t) => (
              <Layout
                key={t.tid}
                columns="auto 1fr auto"
                gap="var(--polly-space-sm)"
                alignItems="center"
              >
                <span data-action="task.toggle-done" data-action-tid={t.tid}>
                  <Checkbox checked={t.done} />
                </span>
                <span
                  data-polly-truncate={true}
                  data-action="task.open"
                  data-action-tid={t.tid}
                  style={{
                    textDecoration: 'line-through',
                    color: 'var(--polly-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {t.description || '(untitled)'}
                </span>
                <Button
                  label="×"
                  size="small"
                  tier="tertiary"
                  color="danger"
                  data-action="task.delete"
                  data-action-tid={t.tid}
                />
              </Layout>
            ))}
          </Layout>
        </details>
      )}
    </Layout>
  );
}

function CaptureView() {
  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <ActionInput
        value=""
        variant="single"
        action="capture.add"
        saveOn="enter"
        placeholder="Quick thought..."
      />
      {capturesState.value.captures.map((c) => (
        <Layout key={c.id} columns="1fr auto auto" gap="var(--polly-space-sm)" alignItems="start">
          <Layout rows="auto auto" gap="var(--polly-space-xs)">
            <ActionInput
              value={c.text}
              variant="multi"
              action="capture.update"
              saveOn="blur"
              placeholder="(empty)"
              ariaLabel="Capture text"
              actionData={{ id: c.id }}
            />
            <span style={{ fontSize: 'var(--polly-text-xs)', color: 'var(--polly-text-muted)' }}>
              {new Date(c.createdAt).toLocaleDateString()}
            </span>
          </Layout>
          <Button
            label="→ Task"
            size="small"
            tier="secondary"
            data-action="capture.promote"
            data-action-id={c.id}
          />
          <Button
            label="×"
            size="small"
            tier="tertiary"
            color="danger"
            data-action="capture.delete"
            data-action-id={c.id}
          />
        </Layout>
      ))}
      {capturesState.value.captures.length === 0 && (
        <p style={{ color: 'var(--polly-text-muted)' }}>No captures yet.</p>
      )}
      <Layout rows="auto" gap="var(--polly-space-sm)" padding="var(--polly-space-md) 0 0 0">
        <p style={{ fontSize: 'var(--polly-text-sm)', color: 'var(--polly-text-muted)' }}>
          One-shot legacy import — pulls from the old /todo API into this mesh.
        </p>
        <Button
          label="Migrate from legacy"
          tier="secondary"
          size="small"
          data-action="migrate.from-legacy"
        />
      </Layout>
    </Layout>
  );
}

export function App() {
  return (
    <Layout
      rows="auto 1fr"
      gap="var(--polly-space-lg)"
      padding="var(--polly-space-lg)"
      maxInlineSize="var(--polly-measure-page)"
    >
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Layout columns="1fr auto" gap="var(--polly-space-sm)">
          <h1 style={{ margin: 0 }}>Todo</h1>
          <HubBack />
        </Layout>
        <Tabs tabs={TAB_LIST} activeTab={activeTab.value} action="todo.tab" />
      </Layout>
      <div>
        {activeTab.value === 'projects' &&
          (selectedProjectId.value === null ? (
            <ProjectsView />
          ) : (
            <ProjectDetail pid={selectedProjectId.value} />
          ))}
        {activeTab.value === 'tasks' &&
          (selectedTaskId.value === null ? (
            <TasksView />
          ) : (
            <TaskDetail tid={selectedTaskId.value} />
          ))}
        {activeTab.value === 'capture' && <CaptureView />}
      </div>
    </Layout>
  );
}
