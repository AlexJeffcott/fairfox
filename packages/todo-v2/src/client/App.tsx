/** @jsxImportSource preact */
// Todo sub-app — project tracker with tasks and quick capture.
// Three views: Projects, Tasks, Capture. All state from $meshState.

import { ActionInput, Badge, Button, Checkbox, Layout, Tabs } from '@fairfox/polly/ui';
import { MeshControls } from '@fairfox/shared/mesh-controls';
import { signal, useSignal } from '@preact/signals';
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

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <ActionInput
        value=""
        variant="single"
        action="project.create"
        saveOn="enter"
        placeholder="New project..."
      />
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
                <Layout rows="auto" gap="0">
                  <strong>{p.name}</strong>
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
                </Layout>
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
              <span style={{ color: 'var(--polly-text-muted)' }}>{p.name}</span>
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

function TasksView() {
  const filterProject = useSignal('');
  const showDone = useSignal(false);

  const tasks = tasksState.value.tasks.filter((t) => {
    if (!showDone.value && t.done) {
      return false;
    }
    if (filterProject.value && t.project !== filterProject.value) {
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

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <span style={{ color: 'var(--polly-text-muted)' }}>
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </span>
        <Button label="+ New task" tier="primary" size="small" data-action="task.new" />
      </Layout>
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
                <Checkbox checked={t.done} data-action="task.toggle-done" data-action-tid={t.tid} />
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
        <Checkbox checked={task.done} data-action="task.toggle-done" data-action-tid={task.tid} />
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
        <Layout key={c.id} columns="1fr auto auto" gap="var(--polly-space-sm)" alignItems="center">
          <Layout rows="auto" gap="0">
            <span>{c.text}</span>
            <span style={{ fontSize: 'var(--polly-text-xs)', color: 'var(--polly-text-muted)' }}>
              {new Date(c.createdAt).toLocaleDateString()}
            </span>
          </Layout>
          <Button
            label="→ Task"
            size="small"
            tier="secondary"
            data-action="task.create"
            data-action-value={c.text}
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
          <MeshControls />
        </Layout>
        <Tabs tabs={TAB_LIST} activeTab={activeTab.value} action="todo.tab" />
      </Layout>
      <div>
        {activeTab.value === 'projects' && <ProjectsView />}
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
