/** @jsxImportSource preact */
// Todo sub-app — project tracker with tasks and quick capture.
// Three views: Projects, Tasks, Capture. All state from $meshState.

import {
  ActionInput,
  ActionSelect,
  Badge,
  Button,
  Checkbox,
  Cluster,
  Code,
  Layout,
  Tabs,
  Text,
} from '@fairfox/polly/ui';
import { HubBack } from '@fairfox/shared/hub-back';
import { setPageContext } from '@fairfox/shared/page-context';
import { effect, signal } from '@preact/signals';
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

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'high' },
  { value: 'med', label: 'med' },
  { value: 'low', label: 'low' },
];

const CATEGORY_OPTIONS = [
  { value: 'personal', label: 'personal' },
  { value: 'amboss', label: 'amboss' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'active' },
  { value: 'paused', label: 'paused' },
  { value: 'done', label: 'done' },
  { value: 'archived', label: 'archived' },
];

function ProjectsView() {
  const activeProjects = projectsState.value.projects.filter((p) => p.status === 'active');
  const pausedProjects = projectsState.value.projects.filter((p) => p.status === 'paused');
  const total = projectsState.value.projects.length;

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <Text tone="muted">
          {total} project{total === 1 ? '' : 's'}
        </Text>
        <Button label="+ New project" tier="primary" size="small" data-action="project.new" />
      </Layout>
      {activeProjects.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <Text as="h3" size="lg" weight="bold">
            Active ({activeProjects.length})
          </Text>
          {activeProjects.map((p) => {
            const taskCount = tasksState.value.tasks.filter(
              (t) => t.project === p.name && !t.done
            ).length;
            return (
              <Layout
                key={p.pid}
                columns="minmax(0, 1fr) auto auto"
                gap="var(--polly-space-sm)"
                alignItems="center"
              >
                <Layout rows="auto" gap="0" data-action="project.open" data-action-pid={p.pid}>
                  <Text weight="bold" data-polly-truncate={true}>
                    {p.name || '(untitled)'}
                  </Text>
                  {p.notes && (
                    <Text tone="muted" size="sm" data-polly-truncate={true}>
                      {p.notes}
                    </Text>
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
          <Text as="h3" size="lg" weight="bold">
            Paused ({pausedProjects.length})
          </Text>
          {pausedProjects.map((p) => (
            <Layout
              key={p.pid}
              columns="minmax(0, 1fr) auto"
              gap="var(--polly-space-sm)"
              alignItems="center"
            >
              <Text
                tone="muted"
                data-action="project.open"
                data-action-pid={p.pid}
                data-polly-truncate={true}
              >
                {p.name || '(untitled)'}
              </Text>
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
  const projectOptions = [
    { value: '', label: '(any)' },
    ...projectNames.map((n) => ({ value: n, label: n })),
  ];
  const priorityOptions = [
    { value: '', label: '(any)' },
    { value: 'high', label: 'high' },
    { value: 'med', label: 'med' },
    { value: 'low', label: 'low' },
  ];
  return (
    <Cluster gap="var(--polly-space-sm)" align="end">
      <ActionSelect
        id="task-filter-project"
        label="Project"
        value={filterProjectName.value}
        options={projectOptions}
        action="tasks.set-filter-project"
      />
      <ActionSelect
        id="task-filter-priority"
        label="Priority"
        value={filterPriority.value}
        options={priorityOptions}
        action="tasks.set-filter-priority"
      />
      <Cluster gap="var(--polly-space-xs)" align="center">
        <span data-action="tasks.toggle-show-done">
          <Checkbox checked={showDone.value} />
        </span>
        <Text size="sm">Show done</Text>
      </Cluster>
    </Cluster>
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
        <Text tone="muted">
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </Text>
        <Button label="+ New task" tier="primary" size="small" data-action="task.new" />
      </Layout>
      <TaskFilters projectNames={projectNames} />
      {filterProjectName.value || filterPriority.value || showDone.value ? (
        <Cluster gap="var(--polly-space-sm)" align="center">
          <Text tone="muted" size="sm">
            Filters on
          </Text>
          <Button label="Clear" size="small" tier="tertiary" data-action="tasks.clear-filters" />
        </Cluster>
      ) : null}
      {(['high', 'med', 'low'] as const).map((prio) => {
        const group = byPriority[prio];
        if (group.length === 0) {
          return null;
        }
        return (
          <Layout key={prio} rows="auto" gap="var(--polly-space-xs)">
            <Text as="h3" size="lg" weight="bold">
              <Badge variant={PRIORITY_COLORS[prio]}>{prio}</Badge> ({group.length})
            </Text>
            {group.map((t) => (
              <Layout
                key={t.tid}
                columns="auto minmax(0, 1fr) auto auto"
                gap="var(--polly-space-sm)"
                alignItems="center"
              >
                <span data-action="task.toggle-done" data-action-tid={t.tid}>
                  <Checkbox checked={t.done} />
                </span>
                <Text data-polly-truncate={true} data-action="task.open" data-action-tid={t.tid}>
                  {t.description || '(untitled)'}
                </Text>
                {t.project ? (
                  <Text size="sm" tone="muted">
                    {t.project}
                  </Text>
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
          <Text as="h3" size="lg" weight="bold">
            Done ({byPriority.done.length})
          </Text>
          {byPriority.done.map((t) => (
            <Layout
              key={t.tid}
              columns="auto minmax(0, 1fr) auto"
              gap="var(--polly-space-sm)"
              alignItems="center"
            >
              <Checkbox checked={t.done} data-action="task.toggle-done" data-action-tid={t.tid} />
              <s data-polly-truncate={true} data-action="task.open" data-action-tid={t.tid}>
                <Text tone="muted">{t.description || '(untitled)'}</Text>
              </s>
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
        <Text as="p" tone="muted">
          Task not found.
        </Text>
      </Layout>
    );
  }
  const projects = projectsState.value.projects;
  const projectOptions = [
    { value: '', label: '(none)' },
    ...projects.map((p) => ({ value: p.name, label: p.name })),
  ];
  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <Layout columns="auto minmax(0, 1fr) auto" gap="var(--polly-space-sm)" alignItems="center">
        <Button label="← Back" tier="tertiary" size="small" data-action="task.close" />
        <Code>{task.tid}</Code>
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
        <Text tone="muted" size="sm">
          Description
        </Text>
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

      <Layout columns="1fr 1fr" gap="var(--polly-space-md)" stackOnMobile={true}>
        <ActionSelect
          id={`project-${task.tid}`}
          label="Project"
          value={task.project}
          options={projectOptions}
          action="task.update"
          actionData={{ field: 'project', tid: task.tid }}
        />
        <ActionSelect
          id={`priority-${task.tid}`}
          label="Priority"
          value={task.priority}
          options={PRIORITY_OPTIONS}
          action="task.update"
          actionData={{ field: 'priority', tid: task.tid }}
        />
      </Layout>

      <Layout columns="auto 1fr" gap="var(--polly-space-sm)" alignItems="center">
        <span data-action="task.toggle-done" data-action-tid={task.tid}>
          <Checkbox checked={task.done} />
        </span>
        <Text>Done</Text>
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <Text tone="muted" size="sm">
          Notes
        </Text>
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
        <Text tone="muted" size="sm">
          Links
        </Text>
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
        <Text as="p" tone="muted">
          Project not found.
        </Text>
      </Layout>
    );
  }
  const otherProjects = projectsState.value.projects.filter((p) => p.pid !== pid);
  const projectTaskCount = tasksState.value.tasks.filter((t) => t.project === project.name).length;
  const parentOptions = [
    { value: '', label: '(none)' },
    ...otherProjects.map((p) => ({ value: p.pid, label: `${p.pid} — ${p.name}` })),
  ];

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <Layout columns="auto minmax(0, 1fr) auto" gap="var(--polly-space-sm)" alignItems="center">
        <Button label="← Back" tier="tertiary" size="small" data-action="project.close" />
        <Code>
          {project.pid} · {projectTaskCount} task{projectTaskCount === 1 ? '' : 's'}
        </Code>
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
        <Text tone="muted" size="sm">
          Name
        </Text>
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

      <Layout columns="1fr 1fr 1fr" gap="var(--polly-space-md)" stackOnMobile={true}>
        <ActionSelect
          id={`category-${project.pid}`}
          label="Category"
          value={project.category}
          options={CATEGORY_OPTIONS}
          action="project.update"
          actionData={{ field: 'category', pid: project.pid }}
        />
        <ActionSelect
          id={`status-${project.pid}`}
          label="Status"
          value={project.status}
          options={STATUS_OPTIONS}
          action="project.update"
          actionData={{ field: 'status', pid: project.pid }}
        />
        <Layout rows="auto" gap="var(--polly-space-xs)">
          <Text tone="muted" size="sm">
            Type
          </Text>
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

      <ActionSelect
        id={`parent-${project.pid}`}
        label="Parent"
        value={project.parent ?? ''}
        options={parentOptions}
        action="project.update"
        actionData={{ field: 'parent', pid: project.pid }}
      />

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <Text tone="muted" size="sm">
          Notes
        </Text>
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

      <Layout columns="1fr 1fr" gap="var(--polly-space-md)" stackOnMobile={true}>
        <Layout rows="auto" gap="var(--polly-space-xs)">
          <Text tone="muted" size="sm">
            Dirs
          </Text>
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
          <Text tone="muted" size="sm">
            Skills
          </Text>
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
        <Text as="h3" size="lg" weight="bold">
          Tasks
        </Text>
        <Text as="p" tone="muted" size="sm">
          No tasks yet. Add one from the Tasks tab and set this project as its parent.
        </Text>
      </Layout>
    );
  }

  return (
    <Layout rows="auto" gap="var(--polly-space-sm)">
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <Text as="h3" size="lg" weight="bold">
          Tasks ({open.length} open{done.length > 0 ? `, ${done.length} done` : ''})
        </Text>
      </Layout>
      {open.map((t) => (
        <Layout
          key={t.tid}
          columns="auto minmax(0, 1fr) auto auto"
          gap="var(--polly-space-sm)"
          alignItems="center"
        >
          <Checkbox checked={t.done} data-action="task.toggle-done" data-action-tid={t.tid} />
          <Text data-polly-truncate={true} data-action="task.open" data-action-tid={t.tid}>
            {t.description || '(untitled)'}
          </Text>
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
          <summary>
            <Text tone="muted" size="sm">
              Done ({done.length})
            </Text>
          </summary>
          <Layout rows="auto" gap="var(--polly-space-xs)" padding="var(--polly-space-xs) 0 0 0">
            {done.map((t) => (
              <Layout
                key={t.tid}
                columns="auto minmax(0, 1fr) auto"
                gap="var(--polly-space-sm)"
                alignItems="center"
              >
                <span data-action="task.toggle-done" data-action-tid={t.tid}>
                  <Checkbox checked={t.done} />
                </span>
                <s data-polly-truncate={true} data-action="task.open" data-action-tid={t.tid}>
                  <Text tone="muted">{t.description || '(untitled)'}</Text>
                </s>
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
        <Layout
          key={c.id}
          columns="minmax(0, 1fr) auto auto"
          gap="var(--polly-space-sm)"
          alignItems="start"
        >
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
            <Text size="xs" tone="muted">
              {new Date(c.createdAt).toLocaleDateString()}
            </Text>
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
        <Text as="p" tone="muted">
          No captures yet.
        </Text>
      )}
    </Layout>
  );
}

let todoEffectsInstalled = false;

/** Publish the current todo view's page-context so the chat widget can
 * pick it up. Previously a useSignalEffect inside App. */
export function installTodoEffects(): void {
  if (todoEffectsInstalled) {
    return;
  }
  todoEffectsInstalled = true;
  effect(() => {
    const tab = activeTab.value;
    if (tab === 'tasks') {
      const tid = selectedTaskId.value;
      if (tid) {
        const task = tasksState.value.tasks.find((t) => t.tid === tid);
        setPageContext({
          kind: 'task',
          id: tid,
          label: task ? `${tid} — ${task.description.slice(0, 40)}` : tid,
        });
      } else {
        // Publish the visible (filtered) task ids so the relay can
        // inject just the subset the user is looking at.
        const project = filterProjectName.value;
        const priority = filterPriority.value;
        const showingDone = showDone.value;
        const visible = tasksState.value.tasks.filter((t) => {
          if (!showingDone && t.done) {
            return false;
          }
          if (project && t.project !== project) {
            return false;
          }
          if (priority && t.priority !== priority) {
            return false;
          }
          return true;
        });
        const parts: string[] = [];
        if (project) {
          parts.push(`project ${project}`);
        }
        if (priority) {
          parts.push(`${priority} priority`);
        }
        parts.push(`${visible.length} tasks`);
        setPageContext({
          kind: 'tasks-list',
          label: parts.join(' · '),
          details: { taskIds: visible.map((t) => t.tid) },
        });
      }
      return;
    }
    if (tab === 'projects') {
      const pid = selectedProjectId.value;
      if (pid) {
        const project = projectsState.value.projects.find((p) => p.pid === pid);
        setPageContext({
          kind: 'project',
          id: pid,
          label: project ? `${pid} — ${project.name}` : pid,
        });
      } else {
        setPageContext({ kind: 'hub', label: 'Projects list' });
      }
      return;
    }
    if (tab === 'capture') {
      setPageContext({ kind: 'hub', label: 'Quick capture' });
      return;
    }
  });
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
          <Text as="h1" size="xl" weight="bold">
            Todo
          </Text>
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
