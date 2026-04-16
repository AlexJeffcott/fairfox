/** @jsxImportSource preact */
// Todo sub-app — project tracker with tasks and quick capture.
// Three views: Projects, Tasks, Capture. All state from $meshState.

import { Badge, Button, Checkbox, Input, Layout, Tabs } from '@fairfox/ui';
import { useSignal } from '@preact/signals';
import { capturesState, projectsState, tasksState } from '#src/client/state.ts';

type ViewId = 'projects' | 'tasks' | 'capture';

const TAB_LIST = [
  { id: 'projects', label: 'Projects' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'capture', label: 'Capture' },
];

const PRIORITY_COLORS = {
  high: 'error',
  med: 'warning',
  low: 'info',
} as const;

function ProjectsView() {
  const activeProjects = projectsState.value.projects.filter((p) => p.status === 'active');
  const pausedProjects = projectsState.value.projects.filter((p) => p.status === 'paused');

  return (
    <Layout rows="auto" gap="var(--space-md)">
      <Input
        value=""
        variant="single"
        action="project.create"
        saveOn="enter"
        placeholder="New project..."
        markdown={false}
      />
      {activeProjects.length > 0 && (
        <Layout rows="auto" gap="var(--space-sm)">
          <h3>Active ({activeProjects.length})</h3>
          {activeProjects.map((p) => {
            const taskCount = tasksState.value.tasks.filter(
              (t) => t.project === p.name && !t.done
            ).length;
            return (
              <Layout key={p.pid} columns="1fr auto auto" gap="var(--space-sm)" align="center">
                <Layout rows="auto" gap="0">
                  <strong>{p.name}</strong>
                  {p.notes && (
                    <span style={{ fontSize: 'var(--font-sm)', color: 'var(--txt-secondary)' }}>
                      {p.notes.slice(0, 80)}
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
        <Layout rows="auto" gap="var(--space-sm)">
          <h3>Paused ({pausedProjects.length})</h3>
          {pausedProjects.map((p) => (
            <Layout key={p.pid} columns="1fr auto" gap="var(--space-sm)" align="center">
              <span style={{ color: 'var(--txt-secondary)' }}>{p.name}</span>
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
    <Layout rows="auto" gap="var(--space-md)">
      <Input
        value=""
        variant="single"
        action="task.create"
        saveOn="enter"
        placeholder="New task..."
        markdown={false}
      />
      {(['high', 'med', 'low'] as const).map((prio) => {
        const group = byPriority[prio];
        if (group.length === 0) {
          return null;
        }
        return (
          <Layout key={prio} rows="auto" gap="var(--space-xs)">
            <h3>
              <Badge variant={PRIORITY_COLORS[prio]}>{prio}</Badge> ({group.length})
            </h3>
            {group.map((t) => (
              <Layout key={t.tid} columns="auto 1fr auto auto" gap="var(--space-sm)" align="center">
                <Checkbox checked={t.done} data-action="task.toggle-done" data-action-tid={t.tid} />
                <Layout rows="auto" gap="0">
                  <span>{t.description}</span>
                  {t.project && (
                    <span style={{ fontSize: 'var(--font-xs)', color: 'var(--txt-tertiary)' }}>
                      {t.project}
                    </span>
                  )}
                </Layout>
                <Badge variant={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
                <Button
                  label="×"
                  size="small"
                  tier="tertiary"
                  color="error"
                  data-action="task.delete"
                  data-action-tid={t.tid}
                />
              </Layout>
            ))}
          </Layout>
        );
      })}
      {byPriority.done.length > 0 && (
        <Layout rows="auto" gap="var(--space-xs)">
          <h3>Done ({byPriority.done.length})</h3>
          {byPriority.done.map((t) => (
            <Layout key={t.tid} columns="auto 1fr auto" gap="var(--space-sm)" align="center">
              <Checkbox checked={t.done} data-action="task.toggle-done" data-action-tid={t.tid} />
              <span style={{ textDecoration: 'line-through', color: 'var(--txt-tertiary)' }}>
                {t.description}
              </span>
              <Button
                label="×"
                size="small"
                tier="tertiary"
                color="error"
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

function CaptureView() {
  return (
    <Layout rows="auto" gap="var(--space-md)">
      <Input
        value=""
        variant="single"
        action="capture.add"
        saveOn="enter"
        placeholder="Quick thought..."
        markdown={false}
      />
      {capturesState.value.captures.map((c) => (
        <Layout key={c.id} columns="1fr auto auto" gap="var(--space-sm)" align="center">
          <Layout rows="auto" gap="0">
            <span>{c.text}</span>
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--txt-tertiary)' }}>
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
            color="error"
            data-action="capture.delete"
            data-action-id={c.id}
          />
        </Layout>
      ))}
      {capturesState.value.captures.length === 0 && (
        <p style={{ color: 'var(--txt-secondary)' }}>No captures yet.</p>
      )}
    </Layout>
  );
}

export function App() {
  const activeTab = useSignal<ViewId>('tasks');

  return (
    <Layout rows="auto 1fr" gap="var(--space-lg)" padding="var(--space-lg)">
      <Layout rows="auto" gap="var(--space-md)">
        <h1>Todo</h1>
        <Tabs tabs={TAB_LIST} activeTab={activeTab.value} action="todo.tab" />
      </Layout>
      <div>
        {activeTab.value === 'projects' && <ProjectsView />}
        {activeTab.value === 'tasks' && <TasksView />}
        {activeTab.value === 'capture' && <CaptureView />}
      </div>
    </Layout>
  );
}
