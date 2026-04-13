import { computed, signal } from '@preact/signals';
import { html } from 'htm/preact';
import { marked } from 'marked';
import { render } from 'preact';

const API = (window as any).BASE_PATH || '';

type View =
  | 'projects'
  | 'project-detail'
  | 'tasks'
  | 'quick-capture'
  | 'chat'
  | 'conversation'
  | 'research'
  | 'document';
const activeView = signal<View>('projects');
const selectedProject = signal<string | null>(null);
const projects = signal<any[]>([]);
const tasks = signal<any[]>([]);
const toBuy = signal<any[]>([]);
const cityHome = signal<any[]>([]);
const directories = signal<any[]>([]);
const quickCapture = signal<any[]>([]);
const editing = signal<string | null>(null);
const editData = signal<any>({});
const creating = signal<boolean>(false);
const createData = signal<any>({});
const filters = signal<Record<string, string>>({});
const conversations = signal<any[]>([]);
const activeConversation = signal<number | null>(null);
const chatMessages = signal<any[]>([]);
const relayConnected = signal<boolean>(false);
const chatInput = signal('');
const documents = signal<any[]>([]);
const activeDocument = signal<any>(null);
const docEditBody = signal('');
const docEditing = signal(false);
let ws: WebSocket | null = null;

async function fetchAll() {
  const [p, t, b, c, d, q, convs, docs, health] = await Promise.all([
    fetch(`${API}/api/projects`).then((r) => r.json()),
    fetch(`${API}/api/tasks`).then((r) => r.json()),
    fetch(`${API}/api/to-buy`).then((r) => r.json()),
    fetch(`${API}/api/city-home`).then((r) => r.json()),
    fetch(`${API}/api/directories`).then((r) => r.json()),
    fetch(`${API}/api/quick-capture`).then((r) => r.json()),
    fetch(`${API}/api/conversations`).then((r) => r.json()),
    fetch(`${API}/api/documents`).then((r) => r.json()),
    fetch(`${API}/health`).then((r) => r.json()),
  ]);
  projects.value = p;
  tasks.value = t;
  toBuy.value = b;
  cityHome.value = c;
  directories.value = d;
  quickCapture.value = q;
  conversations.value = convs;
  documents.value = docs;
  relayConnected.value = health.relay || false;
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}${API}/ws?role=phone`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'new_message' && data.message.conversation_id === activeConversation.value) {
      chatMessages.value = [...chatMessages.value, data.message];
      // Auto-scroll
      setTimeout(() => {
        const el = document.querySelector('.chat-messages');
        if (el) el.scrollTop = el.scrollHeight;
      }, 50);
    }
    if (data.type === 'conversation_created') {
      conversations.value = [...conversations.value, data.conversation];
    }
    if (data.type === 'message_cancelled') {
      chatMessages.value = chatMessages.value.map((m) =>
        m.id === data.message.id ? { ...m, pending: 0 } : m
      );
    }
  };

  ws.onclose = () => setTimeout(connectWS, 3000);
}

async function loadConversation(id: number) {
  activeConversation.value = id;
  activeView.value = 'conversation';
  const msgs = await fetch(`${API}/api/conversations/${id}/messages`).then((r) => r.json());
  chatMessages.value = msgs;
}

async function sendMessage(text: string) {
  if (!activeConversation.value || !text.trim()) return;
  await fetch(`${API}/api/conversations/${activeConversation.value}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: 'user', text: text.trim() }),
  });
}

async function cancelPending() {
  const pending = chatMessages.value.filter((m) => m.pending);
  for (const m of pending) {
    await fetch(`${API}/api/messages/${m.id}/cancel`, { method: 'POST' });
  }
  chatMessages.value = chatMessages.value.map((m) => (m.pending ? { ...m, pending: 0 } : m));
}

async function createConversation(title: string) {
  const res = await fetch(`${API}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const conv = await res.json();
  conversations.value = [conv, ...conversations.value];
  await loadConversation(conv.id);
}

async function save(endpoint: string, id: string, data: any) {
  const url = `${API}/api/${endpoint}/${id}`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(
        `${res.status} PUT ${url}\n${(err as any).error || res.statusText}\n\nData: ${JSON.stringify(data)}`
      );
      return;
    }
    editing.value = null;
    await fetchAll();
  } catch (e: any) {
    alert(`Network error PUT ${url}: ${e.message}`);
  }
}

async function create(endpoint: string, data: any) {
  const url = `${API}/api/${endpoint}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(
        `${res.status} POST ${url}\n${(err as any).error || res.statusText}\n\nData: ${JSON.stringify(data)}`
      );
      return;
    }
    creating.value = false;
    createData.value = {};
    await fetchAll();
  } catch (e: any) {
    alert(`Network error POST ${url}: ${e.message}`);
  }
}

async function remove(endpoint: string, id: string) {
  if (!confirm(`Delete ${id}?`)) return;
  await fetch(`${API}/api/${endpoint}/${id}`, { method: 'DELETE' });
  await fetchAll();
}

function startEdit(id: string, data: any) {
  editing.value = id;
  editData.value = { ...data };
}

function startCreate(defaults: any = {}) {
  creating.value = true;
  createData.value = { ...defaults };
}

function navigate(view: View, projectPid?: string) {
  activeView.value = view;
  selectedProject.value = projectPid || null;
  editing.value = null;
  creating.value = false;
  filters.value = {};
}

// --- Shared components ---

function EditableCell({ field, value }: { field: string; value: string }) {
  return html`<input
    class="edit-input"
    value=${editData.value[field] ?? value}
    onInput=${(e: any) => {
      editData.value = { ...editData.value, [field]: e.target.value };
    }}
  />`;
}

function CreateCell({ field, placeholder }: { field: string; placeholder?: string }) {
  return html`<input
    class="edit-input"
    placeholder=${placeholder || field}
    value=${createData.value[field] || ''}
    onInput=${(e: any) => {
      createData.value = { ...createData.value, [field]: e.target.value };
    }}
  />`;
}

function EditableTextarea({ field, value }: { field: string; value: string }) {
  return html`<textarea
    class="edit-textarea"
    onInput=${(e: any) => {
      editData.value = { ...editData.value, [field]: e.target.value };
    }}
  >${editData.value[field] ?? value}</textarea>`;
}

function CreateTextarea({ field, placeholder }: { field: string; placeholder?: string }) {
  return html`<textarea
    class="edit-textarea"
    placeholder=${placeholder || field}
    onInput=${(e: any) => {
      createData.value = { ...createData.value, [field]: e.target.value };
    }}
  >${createData.value[field] || ''}</textarea>`;
}

function FilterBar({ options }: { options: { key: string; values: string[] }[] }) {
  return html`<div class="filter-bar">
    ${options.map(
      (o) => html`
      <select
        value=${filters.value[o.key] || ''}
        onChange=${(e: any) => {
          const f = { ...filters.value };
          if (e.target.value) f[o.key] = e.target.value;
          else delete f[o.key];
          filters.value = f;
        }}
      >
        <option value="">All ${o.key}</option>
        ${o.values.map((v) => html`<option value=${v}>${v}</option>`)}
      </select>
    `
    )}
  </div>`;
}

// --- Projects list ---

function ProjectsListView() {
  const f = filters.value;
  const items = computed(() =>
    projects.value.filter(
      (p) =>
        (!f.status || p.status === f.status) &&
        (!f.category || p.category === f.category) &&
        (!f.type || p.type === f.type)
    )
  );

  function taskCount(projectName: string) {
    return tasks.value.filter((t) => t.project === projectName && !t.done).length;
  }

  function subItemCount(pid: string): string {
    if (pid === 'P21') {
      const active = toBuy.value.filter(
        (b) => !['purchased', 'abandoned'].includes(b.status)
      ).length;
      return `${active} item${active !== 1 ? 's' : ''}`;
    }
    if (pid === 'P22') {
      const active = cityHome.value.filter((h) => !['done', 'deferred'].includes(h.status)).length;
      return `${active} task${active !== 1 ? 's' : ''}`;
    }
    const open = taskCount(projects.value.find((p) => p.pid === pid)?.name || '');
    return open ? `${open} open` : '';
  }

  return html`
    <${FilterBar} options=${[
      { key: 'status', values: ['active', 'refining', 'paused', 'idea', 'blocked', 'done'] },
      { key: 'category', values: ['personal', 'amboss'] },
      {
        key: 'type',
        values: [
          'coding',
          'work',
          'writing',
          'art',
          'home-life',
          'travel',
          'hardware',
          'health',
          'learning',
        ],
      },
    ]} />
    <table>
      <thead><tr>
        <th>PID</th><th>Name</th><th>Category</th><th>Type</th><th>Status</th><th>Items</th><th>Notes</th><th></th>
      </tr></thead>
      <tbody>
        ${items.value.map((p) => {
          const isEditing = editing.value === p.pid;
          return html`<tr class=${isEditing ? 'editing' : ''}>
            <td class="id-cell">${p.pid}</td>
            <td>
              ${
                isEditing
                  ? html`<${EditableCell} field="name" value=${p.name} />`
                  : html`<a class="project-link" onClick=${() => navigate('project-detail', p.pid)}>${p.name}</a>
                       ${p.parent ? html`<span class="parent-badge">${p.parent}</span>` : null}`
              }
            </td>
            <td>${isEditing ? html`<${EditableCell} field="category" value=${p.category} />` : p.category}</td>
            <td>${isEditing ? html`<${EditableCell} field="type" value=${p.type} />` : p.type}</td>
            <td>
              ${
                isEditing
                  ? html`<${EditableCell} field="status" value=${p.status} />`
                  : html`<span class="status-badge status-${p.status}">${p.status}</span>`
              }
            </td>
            <td class="count-cell">${subItemCount(p.pid)}</td>
            <td class="notes-cell">${isEditing ? html`<${EditableTextarea} field="notes" value=${p.notes} />` : p.notes}</td>
            <td class="actions">
              ${
                isEditing
                  ? html`<button class="btn btn-save" onClick=${() => save('projects', p.pid, editData.value)}>Save</button>
                       <button class="btn btn-cancel" onClick=${() => {
                         editing.value = null;
                       }}>Cancel</button>`
                  : html`<button class="btn btn-edit" onClick=${() => startEdit(p.pid, p)}>Edit</button>
                       <button class="btn btn-delete" onClick=${() => remove('projects', p.pid)}>Del</button>`
              }
            </td>
          </tr>`;
        })}
        ${
          creating.value && activeView.value === 'projects'
            ? html`<tr class="creating">
          <td><${CreateCell} field="pid" placeholder="P31" /></td>
          <td><${CreateCell} field="name" /></td>
          <td><${CreateCell} field="category" placeholder="personal" /></td>
          <td><${CreateCell} field="type" placeholder="coding" /></td>
          <td><${CreateCell} field="status" placeholder="idea" /></td>
          <td></td>
          <td><${CreateTextarea} field="notes" /></td>
          <td class="actions">
            <button class="btn btn-save" onClick=${() => create('projects', createData.value)}>Create</button>
            <button class="btn btn-cancel" onClick=${() => {
              creating.value = false;
            }}>Cancel</button>
          </td>
        </tr>`
            : null
        }
      </tbody>
    </table>
    ${!creating.value ? html`<button class="btn btn-add" onClick=${() => startCreate()}>+ Add project</button>` : null}
  `;
}

// --- Project detail: To Buy (P21) ---

function ToBuyDetailView({ project }: { project: any }) {
  const f = filters.value;
  const items = computed(() => toBuy.value.filter((b) => !f.status || b.status === f.status));

  return html`
    <${FilterBar} options=${[
      { key: 'status', values: ['researching', 'decided', 'purchased', 'abandoned', 'deferred'] },
    ]} />
    <table>
      <thead><tr>
        <th>BID</th><th>Item</th><th>Status</th><th>Price</th><th>Vendor</th><th>Date</th><th>Notes</th><th></th>
      </tr></thead>
      <tbody>
        ${items.value.map((b) => {
          const isEditing = editing.value === b.bid;
          return html`<tr class=${isEditing ? 'editing' : ''}>
            <td class="id-cell">${b.bid}</td>
            <td>${isEditing ? html`<${EditableCell} field="item" value=${b.item} />` : b.item}</td>
            <td>
              ${
                isEditing
                  ? html`<${EditableCell} field="status" value=${b.status} />`
                  : html`<span class="status-badge status-${b.status}">${b.status}</span>`
              }
            </td>
            <td>${isEditing ? html`<${EditableCell} field="price" value=${b.price} />` : b.price}</td>
            <td>${isEditing ? html`<${EditableCell} field="vendor" value=${b.vendor} />` : b.vendor}</td>
            <td>${isEditing ? html`<${EditableCell} field="date" value=${b.date} />` : b.date}</td>
            <td class="notes-cell">${isEditing ? html`<${EditableTextarea} field="notes" value=${b.notes} />` : b.notes}</td>
            <td class="actions">
              ${
                isEditing
                  ? html`<button class="btn btn-save" onClick=${() => save('to-buy', b.bid, editData.value)}>Save</button>
                       <button class="btn btn-cancel" onClick=${() => {
                         editing.value = null;
                       }}>Cancel</button>`
                  : html`<button class="btn btn-edit" onClick=${() => startEdit(b.bid, b)}>Edit</button>
                       <button class="btn btn-delete" onClick=${() => remove('to-buy', b.bid)}>Del</button>`
              }
            </td>
          </tr>`;
        })}
        ${
          creating.value
            ? html`<tr class="creating">
          <td><${CreateCell} field="bid" placeholder="B09" /></td>
          <td><${CreateCell} field="item" /></td>
          <td><${CreateCell} field="status" placeholder="researching" /></td>
          <td><${CreateCell} field="price" /></td>
          <td><${CreateCell} field="vendor" /></td>
          <td><${CreateCell} field="date" /></td>
          <td><${CreateTextarea} field="notes" /></td>
          <td class="actions">
            <button class="btn btn-save" onClick=${() => create('to-buy', createData.value)}>Create</button>
            <button class="btn btn-cancel" onClick=${() => {
              creating.value = false;
            }}>Cancel</button>
          </td>
        </tr>`
            : null
        }
      </tbody>
    </table>
    ${!creating.value ? html`<button class="btn btn-add" onClick=${() => startCreate()}>+ Add item</button>` : null}
  `;
}

// --- Project detail: City Home (P22) ---

function CityHomeDetailView({ project }: { project: any }) {
  const f = filters.value;
  const items = computed(() => cityHome.value.filter((h) => !f.status || h.status === f.status));

  return html`
    <${FilterBar} options=${[
      { key: 'status', values: ['research', 'todo', 'blocked', 'in-progress', 'done', 'deferred'] },
    ]} />
    <table>
      <thead><tr>
        <th>HID</th><th>Task</th><th>Status</th><th>Notes</th><th></th>
      </tr></thead>
      <tbody>
        ${items.value.map((h) => {
          const isEditing = editing.value === h.hid;
          return html`<tr class=${isEditing ? 'editing' : ''}>
            <td class="id-cell">${h.hid}</td>
            <td>${isEditing ? html`<${EditableCell} field="task" value=${h.task} />` : h.task}</td>
            <td>
              ${
                isEditing
                  ? html`<${EditableCell} field="status" value=${h.status} />`
                  : html`<span class="status-badge status-${h.status}">${h.status}</span>`
              }
            </td>
            <td class="notes-cell">${isEditing ? html`<${EditableTextarea} field="notes" value=${h.notes} />` : h.notes}</td>
            <td class="actions">
              ${
                isEditing
                  ? html`<button class="btn btn-save" onClick=${() => save('city-home', h.hid, editData.value)}>Save</button>
                       <button class="btn btn-cancel" onClick=${() => {
                         editing.value = null;
                       }}>Cancel</button>`
                  : html`<button class="btn btn-edit" onClick=${() => startEdit(h.hid, h)}>Edit</button>
                       <button class="btn btn-delete" onClick=${() => remove('city-home', h.hid)}>Del</button>`
              }
            </td>
          </tr>`;
        })}
        ${
          creating.value
            ? html`<tr class="creating">
          <td><${CreateCell} field="hid" placeholder="H19" /></td>
          <td><${CreateCell} field="task" /></td>
          <td><${CreateCell} field="status" placeholder="todo" /></td>
          <td><${CreateTextarea} field="notes" /></td>
          <td class="actions">
            <button class="btn btn-save" onClick=${() => create('city-home', createData.value)}>Create</button>
            <button class="btn btn-cancel" onClick=${() => {
              creating.value = false;
            }}>Cancel</button>
          </td>
        </tr>`
            : null
        }
      </tbody>
    </table>
    ${!creating.value ? html`<button class="btn btn-add" onClick=${() => startCreate()}>+ Add task</button>` : null}
  `;
}

// --- Project detail: generic (tasks filtered to project) ---

function ProjectTasksDetailView({ project }: { project: any }) {
  const f = filters.value;
  const projectTasks = computed(() =>
    tasks.value.filter(
      (t) =>
        t.project === project.name &&
        (!f.done || (f.done === 'open' ? !t.done : !!t.done)) &&
        (!f.priority || t.priority === f.priority)
    )
  );

  return html`
    <${FilterBar} options=${[
      { key: 'done', values: ['open', 'done'] },
      { key: 'priority', values: ['high', 'med', 'low'] },
    ]} />
    <table>
      <thead><tr>
        <th>TID</th><th class="done-col">Done</th><th>Task</th><th>Prio</th><th>Links</th><th>Notes</th><th></th>
      </tr></thead>
      <tbody>
        ${projectTasks.value.map((t) => {
          const isEditing = editing.value === t.tid;
          return html`<tr class="${isEditing ? 'editing' : ''} ${t.done ? 'done-row' : ''}">
            <td class="id-cell">${t.tid}</td>
            <td class="done-col">
              <input type="checkbox" checked=${!!t.done}
                onChange=${() => save('tasks', t.tid, { done: !t.done })} />
            </td>
            <td>${isEditing ? html`<${EditableCell} field="description" value=${t.description} />` : t.description}</td>
            <td>${isEditing ? html`<${EditableCell} field="priority" value=${t.priority} />` : html`<span class="prio-${t.priority}">${t.priority}</span>`}</td>
            <td class="mono">${isEditing ? html`<${EditableCell} field="links" value=${t.links} />` : t.links}</td>
            <td class="notes-cell">${isEditing ? html`<${EditableTextarea} field="notes" value=${t.notes} />` : t.notes}</td>
            <td class="actions">
              ${
                isEditing
                  ? html`<button class="btn btn-save" onClick=${() => save('tasks', t.tid, editData.value)}>Save</button>
                       <button class="btn btn-cancel" onClick=${() => {
                         editing.value = null;
                       }}>Cancel</button>`
                  : html`<button class="btn btn-edit" onClick=${() => startEdit(t.tid, t)}>Edit</button>
                       <button class="btn btn-delete" onClick=${() => remove('tasks', t.tid)}>Del</button>`
              }
            </td>
          </tr>`;
        })}
        ${
          creating.value
            ? html`<tr class="creating">
          <td><${CreateCell} field="tid" placeholder="T230" /></td>
          <td></td>
          <td><${CreateCell} field="description" /></td>
          <td><${CreateCell} field="priority" placeholder="med" /></td>
          <td><${CreateCell} field="links" /></td>
          <td><${CreateTextarea} field="notes" /></td>
          <td class="actions">
            <button class="btn btn-save" onClick=${() => create('tasks', { ...createData.value, project: project.name })}>Create</button>
            <button class="btn btn-cancel" onClick=${() => {
              creating.value = false;
            }}>Cancel</button>
          </td>
        </tr>`
            : null
        }
      </tbody>
    </table>
    ${!creating.value ? html`<button class="btn btn-add" onClick=${() => startCreate()}>+ Add task</button>` : null}
  `;
}

// --- Project detail wrapper ---

function ProjectDetailView() {
  const project = computed(() => projects.value.find((p) => p.pid === selectedProject.value));
  if (!project.value) return html`<p>Project not found</p>`;

  const p = project.value;
  const childProjects = computed(() => projects.value.filter((c) => c.parent === p.pid));
  const dirs = computed(() =>
    p.dirs
      ? p.dirs
          .split(',')
          .map((d: string) => d.trim())
          .filter(Boolean)
          .map(
            (d: string) =>
              directories.value.find((dir: any) => dir.dir === d) || { dir: d, description: '' }
          )
      : []
  );

  const isEditingProject = editing.value === `project-info-${p.pid}`;

  return html`
    <div class="detail-header">
      <div class="detail-title-row">
        <span class="detail-pid">${p.pid}</span>
        <h2 class="detail-name">${p.name}</h2>
        <span class="status-badge status-${p.status}">${p.status}</span>
        <span class="detail-meta">${p.category} / ${p.type}</span>
      </div>

      ${
        p.notes
          ? html`<div class="detail-notes">
        ${isEditingProject ? html`<${EditableTextarea} field="notes" value=${p.notes} />` : p.notes}
      </div>`
          : null
      }

      ${
        p.parent
          ? html`<div class="detail-meta">
        Parent: <a class="project-link" onClick=${() => navigate('project-detail', p.parent)}>${p.parent}</a>
      </div>`
          : null
      }

      ${
        dirs.value.length > 0
          ? html`<div class="detail-dirs">
        ${dirs.value.map((d: any) => html`<span class="dir-badge" title=${d.description}>${d.dir}</span>`)}
      </div>`
          : null
      }

      ${p.skills ? html`<div class="detail-skills"><code>${p.skills}</code></div>` : null}

      ${
        childProjects.value.length > 0
          ? html`<div class="detail-children">
        Sub-projects: ${childProjects.value.map(
          (c: any) => html`
          <a class="project-link" onClick=${() => navigate('project-detail', c.pid)}>
            ${c.name}${' '}
          </a>
        `
        )}
      </div>`
          : null
      }

      <div class="detail-actions">
        ${
          isEditingProject
            ? html`
              <button class="btn btn-save" onClick=${() => {
                save('projects', p.pid, editData.value);
              }}>Save</button>
              <button class="btn btn-cancel" onClick=${() => {
                editing.value = null;
              }}>Cancel</button>`
            : html`<button class="btn btn-edit" onClick=${() => startEdit(`project-info-${p.pid}`, p)}>Edit project</button>`
        }
      </div>
    </div>

    ${
      p.pid === 'P21'
        ? html`<${ToBuyDetailView} project=${p} />`
        : p.pid === 'P22'
          ? html`<${CityHomeDetailView} project=${p} />`
          : html`<${ProjectTasksDetailView} project=${p} />`
    }
  `;
}

// --- All tasks view ---

function AllTasksView() {
  const f = filters.value;
  const items = computed(() =>
    tasks.value.filter(
      (t) =>
        (!f.project || t.project === f.project) &&
        (!f.priority || t.priority === f.priority) &&
        (!f.done || (f.done === 'open' ? !t.done : !!t.done))
    )
  );
  const projectNames = computed(() => [...new Set(tasks.value.map((t) => t.project))].sort());

  return html`
    <${FilterBar} options=${[
      { key: 'done', values: ['open', 'done'] },
      { key: 'priority', values: ['high', 'med', 'low'] },
      { key: 'project', values: projectNames.value },
    ]} />
    <table>
      <thead><tr>
        <th>TID</th><th class="done-col">Done</th><th>Task</th><th>Project</th><th>Prio</th><th>Links</th><th>Notes</th><th></th>
      </tr></thead>
      <tbody>
        ${items.value.map((t) => {
          const isEditing = editing.value === t.tid;
          const proj = projects.value.find((p) => p.name === t.project);
          return html`<tr class="${isEditing ? 'editing' : ''} ${t.done ? 'done-row' : ''}">
            <td class="id-cell">${t.tid}</td>
            <td class="done-col">
              <input type="checkbox" checked=${!!t.done}
                onChange=${() => save('tasks', t.tid, { done: !t.done })} />
            </td>
            <td>${isEditing ? html`<${EditableCell} field="description" value=${t.description} />` : t.description}</td>
            <td>
              ${
                isEditing
                  ? html`<${EditableCell} field="project" value=${t.project} />`
                  : proj
                    ? html`<a class="project-link" onClick=${() => navigate('project-detail', proj.pid)}>${t.project}</a>`
                    : t.project
              }
            </td>
            <td>${isEditing ? html`<${EditableCell} field="priority" value=${t.priority} />` : html`<span class="prio-${t.priority}">${t.priority}</span>`}</td>
            <td class="mono">${isEditing ? html`<${EditableCell} field="links" value=${t.links} />` : t.links}</td>
            <td class="notes-cell">${isEditing ? html`<${EditableTextarea} field="notes" value=${t.notes} />` : t.notes}</td>
            <td class="actions">
              ${
                isEditing
                  ? html`<button class="btn btn-save" onClick=${() => save('tasks', t.tid, editData.value)}>Save</button>
                       <button class="btn btn-cancel" onClick=${() => {
                         editing.value = null;
                       }}>Cancel</button>`
                  : html`<button class="btn btn-edit" onClick=${() => startEdit(t.tid, t)}>Edit</button>
                       <button class="btn btn-delete" onClick=${() => remove('tasks', t.tid)}>Del</button>`
              }
            </td>
          </tr>`;
        })}
        ${
          creating.value && activeView.value === 'tasks'
            ? html`<tr class="creating">
          <td><${CreateCell} field="tid" placeholder="T230" /></td>
          <td></td>
          <td><${CreateCell} field="description" /></td>
          <td><${CreateCell} field="project" /></td>
          <td><${CreateCell} field="priority" placeholder="med" /></td>
          <td><${CreateCell} field="links" /></td>
          <td><${CreateTextarea} field="notes" /></td>
          <td class="actions">
            <button class="btn btn-save" onClick=${() => create('tasks', createData.value)}>Create</button>
            <button class="btn btn-cancel" onClick=${() => {
              creating.value = false;
            }}>Cancel</button>
          </td>
        </tr>`
            : null
        }
      </tbody>
    </table>
    ${!creating.value ? html`<button class="btn btn-add" onClick=${() => startCreate()}>+ Add task</button>` : null}
  `;
}

// --- Quick capture ---

function QuickCaptureView() {
  return html`
    <div class="capture-list">
      ${quickCapture.value.map(
        (q) => html`
        <div class="capture-item">
          <span>${q.text}</span>
          <button class="btn btn-delete" onClick=${() => remove('quick-capture', q.id)}>Del</button>
        </div>
      `
      )}
    </div>
    ${
      creating.value && activeView.value === 'quick-capture'
        ? html`
      <div class="capture-create">
        <input class="edit-input capture-input" placeholder="Quick thought..."
          value=${createData.value.text || ''}
          onInput=${(e: any) => {
            createData.value = { text: e.target.value };
          }}
          onKeyDown=${(e: any) => {
            if (e.key === 'Enter') create('quick-capture', createData.value);
          }}
        />
        <button class="btn btn-save" onClick=${() => create('quick-capture', createData.value)}>Add</button>
        <button class="btn btn-cancel" onClick=${() => {
          creating.value = false;
        }}>Cancel</button>
      </div>
    `
        : html`<button class="btn btn-add" onClick=${() => startCreate()}>+ Capture</button>`
    }
  `;
}

// --- Research ---

async function loadDocument(id: number) {
  const doc = await fetch(`${API}/api/documents/${id}`).then((r) => r.json());
  activeDocument.value = doc;
  docEditBody.value = doc.body;
  docEditing.value = false;
  activeView.value = 'document';
}

async function saveDocument() {
  const doc = activeDocument.value;
  if (!doc) return;
  const res = await fetch(`${API}/api/documents/${doc.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: editData.value.title ?? doc.title,
      body: docEditBody.value,
      project: editData.value.project ?? doc.project,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Error: ${(err as any).error || res.statusText}`);
    return;
  }
  const updated = await res.json();
  activeDocument.value = updated;
  docEditing.value = false;
  await fetchAll();
}

async function createDocument(title: string, project: string) {
  const res = await fetch(`${API}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, project }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Error: ${(err as any).error || res.statusText}`);
    return;
  }
  const doc = await res.json();
  await fetchAll();
  await loadDocument(doc.id);
  docEditing.value = true;
}

function ResearchListView() {
  const f = filters.value;
  const projectNames = computed(() =>
    [...new Set(documents.value.map((d: any) => d.project).filter(Boolean))].sort()
  );
  const items = computed(() =>
    documents.value.filter((d: any) => !f.project || d.project === f.project)
  );

  return html`
    <${FilterBar} options=${[{ key: 'project', values: projectNames.value }]} />
    <div class="doc-list">
      ${items.value.map(
        (d: any) => html`
        <div class="doc-list-item" onClick=${() => loadDocument(d.id)}>
          <div class="doc-list-title">${d.title}</div>
          <div class="doc-list-meta">
            ${d.project ? html`<span class="doc-project">${d.project}</span>` : null}
            <span class="doc-date">${new Date(d.updated_at).toLocaleDateString()}</span>
          </div>
        </div>
      `
      )}
    </div>
    ${
      creating.value && activeView.value === 'research'
        ? html`
      <div class="capture-create">
        <input class="edit-input" placeholder="Document title..."
          value=${createData.value.title || ''}
          onInput=${(e: any) => {
            createData.value = { ...createData.value, title: e.target.value };
          }}
        />
        <input class="edit-input" placeholder="Project (optional)"
          value=${createData.value.project || ''}
          onInput=${(e: any) => {
            createData.value = { ...createData.value, project: e.target.value };
          }}
        />
        <button class="btn btn-save" onClick=${() => {
          createDocument(createData.value.title || 'Untitled', createData.value.project || '');
          creating.value = false;
          createData.value = {};
        }}>Create</button>
        <button class="btn btn-cancel" onClick=${() => {
          creating.value = false;
        }}>Cancel</button>
      </div>
    `
        : html`<button class="btn btn-add" onClick=${() => startCreate()}>+ New document</button>`
    }
  `;
}

function DocumentView() {
  const doc = activeDocument.value;
  if (!doc) return html`<p>Document not found</p>`;

  if (docEditing.value) {
    return html`
      <div class="doc-edit-header">
        <input class="edit-input doc-title-input" value=${editData.value.title ?? doc.title}
          onInput=${(e: any) => {
            editData.value = { ...editData.value, title: e.target.value };
          }}
          placeholder="Title"
        />
        <input class="edit-input" value=${editData.value.project ?? doc.project}
          onInput=${(e: any) => {
            editData.value = { ...editData.value, project: e.target.value };
          }}
          placeholder="Project"
        />
      </div>
      <textarea class="doc-editor"
        value=${docEditBody.value}
        onInput=${(e: any) => {
          docEditBody.value = e.target.value;
        }}
      />
      <div class="doc-edit-actions">
        <button class="btn btn-save" onClick=${saveDocument}>Save</button>
        <button class="btn btn-cancel" onClick=${() => {
          docEditing.value = false;
        }}>Cancel</button>
      </div>
      ${
        docEditBody.value
          ? html`
        <div class="doc-preview-label">Preview</div>
        <div class="doc-rendered" dangerouslySetInnerHTML=${{ __html: marked.parse(docEditBody.value) }} />
      `
          : null
      }
    `;
  }

  return html`
    <div class="doc-header">
      <h2 class="doc-title">${doc.title}</h2>
      <div class="doc-meta">
        ${doc.project ? html`<span class="doc-project">${doc.project}</span>` : null}
        <span class="doc-date">Updated ${new Date(doc.updated_at).toLocaleDateString()}</span>
      </div>
      <div class="doc-actions">
        <button class="btn btn-edit" onClick=${() => {
          editData.value = { title: doc.title, project: doc.project };
          docEditBody.value = doc.body;
          docEditing.value = true;
        }}>Edit</button>
        <button class="btn btn-delete" onClick=${async () => {
          if (!confirm('Delete this document?')) return;
          await fetch(API + '/api/documents/' + doc.id, { method: 'DELETE' });
          activeView.value = 'research';
          activeDocument.value = null;
          await fetchAll();
        }}>Delete</button>
      </div>
    </div>
    ${
      doc.body
        ? html`<div class="doc-rendered" dangerouslySetInnerHTML=${{ __html: marked.parse(doc.body) }} />`
        : html`<p class="doc-empty">No content yet. Click Edit to start writing.</p>`
    }
  `;
}

// --- Chat list ---

function ChatListView() {
  return html`
    <div class="chat-list">
      <div class="relay-status">
        <span class="relay-dot ${relayConnected.value ? 'relay-on' : 'relay-off'}"></span>
        ${relayConnected.value ? 'Claude connected' : 'Claude offline'}
      </div>
      ${conversations.value.map(
        (c) => html`
        <div class="chat-list-item" onClick=${() => loadConversation(c.id)}>
          <div class="chat-list-title">${c.title || 'Untitled'}</div>
          <div class="chat-list-time">${new Date(c.updated_at).toLocaleString()}</div>
        </div>
      `
      )}
    </div>
    ${
      creating.value && activeView.value === 'chat'
        ? html`
      <div class="capture-create">
        <input class="edit-input capture-input" placeholder="Conversation title..."
          value=${createData.value.title || ''}
          onInput=${(e: any) => {
            createData.value = { title: e.target.value };
          }}
          onKeyDown=${(e: any) => {
            if (e.key === 'Enter') createConversation(createData.value.title || '');
          }}
        />
        <button class="btn btn-save" onClick=${() => {
          createConversation(createData.value.title || '');
          creating.value = false;
        }}>Create</button>
        <button class="btn btn-cancel" onClick=${() => {
          creating.value = false;
        }}>Cancel</button>
      </div>
    `
        : html`<button class="btn btn-add" onClick=${() => startCreate()}>+ New conversation</button>`
    }
  `;
}

// --- Conversation view ---

function ConversationView() {
  const conv = computed(() => conversations.value.find((c) => c.id === activeConversation.value));

  function handleSend() {
    const text = chatInput.value.trim();
    if (!text) return;
    sendMessage(text);
    chatInput.value = '';
  }

  if (!conv.value) return html`<p>Conversation not found</p>`;

  return html`
    <div class="relay-status">
      <span class="relay-dot ${relayConnected.value ? 'relay-on' : 'relay-off'}"></span>
      ${relayConnected.value ? 'Claude connected' : 'Claude offline'}
    </div>
    ${chatMessages.value.map(
      (m) => html`
      <div class="chat-msg chat-msg-${m.sender}">
        <div class="chat-msg-sender">${m.sender}</div>
        <div class="chat-msg-text">${m.text}</div>
        <div class="chat-msg-time">${new Date(m.created_at).toLocaleTimeString()}</div>
      </div>
    `
    )}
    ${
      chatMessages.value.some((m) => m.pending)
        ? html`<div class="chat-pending">
          <span class="chat-thinking">waiting for Claude...</span>
          <button class="btn btn-cancel" onClick=${cancelPending}>Cancel</button>
        </div>`
        : null
    }
  `;
}

// --- App ---

const TABS: { id: View; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'research', label: 'Research' },
  { id: 'quick-capture', label: 'Capture' },
  { id: 'chat', label: 'Chat' },
];

function App() {
  const openTasks = computed(() => tasks.value.filter((t) => !t.done).length);
  const captureCount = computed(() => quickCapture.value.length);
  const projectCount = computed(() => projects.value.filter((p) => p.status === 'active').length);
  const convCount = computed(() => conversations.value.length);

  const docCount = computed(() => documents.value.length);

  const counts: Record<View, any> = {
    projects: projectCount,
    tasks: openTasks,
    research: docCount,
    'quick-capture': captureCount,
    chat: convCount,
    'project-detail': null,
    conversation: null,
    document: null,
  };

  const isConversation = activeView.value === 'conversation';

  return html`
    <div class=${isConversation ? 'app-grid' : ''}>
      <div class="app-header">
        <header>
          <h1>TODO</h1>
        </header>
        <nav>
          ${TABS.map(
            (tab) => html`
            <button
              class="tab ${
                activeView.value === tab.id ||
                (tab.id === 'projects' && activeView.value === 'project-detail') ||
                (tab.id === 'chat' && activeView.value === 'conversation') ||
                (tab.id === 'research' && activeView.value === 'document')
                  ? 'active'
                  : ''
              }"
              onClick=${() => navigate(tab.id)}
            >
              ${tab.label}
              ${counts[tab.id] ? html`<span class="count">${counts[tab.id]}</span>` : null}
            </button>
          `
          )}
        </nav>
        ${
          activeView.value === 'project-detail'
            ? html`
          <div class="breadcrumb">
            <a class="project-link" onClick=${() => navigate('projects')}>Projects</a>
            <span class="breadcrumb-sep">/</span>
            <span>${projects.value.find((p) => p.pid === selectedProject.value)?.name || selectedProject.value}</span>
          </div>
        `
            : null
        }
        ${
          isConversation
            ? html`
          <div class="breadcrumb">
            <a class="project-link" onClick=${() => navigate('chat')}>Chat</a>
            <span class="breadcrumb-sep">/</span>
            <span>${conversations.value.find((c) => c.id === activeConversation.value)?.title || 'Conversation'}</span>
          </div>
        `
            : null
        }
        ${
          activeView.value === 'document'
            ? html`
          <div class="breadcrumb">
            <a class="project-link" onClick=${() => navigate('research')}>Research</a>
            <span class="breadcrumb-sep">/</span>
            <span>${activeDocument.value?.title || 'Document'}</span>
          </div>
        `
            : null
        }
      </div>
      <main>
        ${
          activeView.value === 'projects'
            ? html`<${ProjectsListView} />`
            : activeView.value === 'project-detail'
              ? html`<${ProjectDetailView} />`
              : activeView.value === 'tasks'
                ? html`<${AllTasksView} />`
                : activeView.value === 'research'
                  ? html`<${ResearchListView} />`
                  : activeView.value === 'document'
                    ? html`<${DocumentView} />`
                    : activeView.value === 'chat'
                      ? html`<${ChatListView} />`
                      : isConversation
                        ? html`<${ConversationView} />`
                        : html`<${QuickCaptureView} />`
        }
      </main>
      ${
        isConversation
          ? html`
        <div class="chat-input-bar">
          <textarea class="chat-input" placeholder="Message Claude..." rows="4"
            value=${chatInput.value}
            onInput=${(e: any) => {
              chatInput.value = e.target.value;
            }}
            onKeyDown=${(e: any) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const text = chatInput.value.trim();
                if (text) {
                  sendMessage(text);
                  chatInput.value = '';
                }
              }
            }}
          />
          <button class="btn btn-save chat-send" onClick=${() => {
            const text = chatInput.value.trim();
            if (text) {
              sendMessage(text);
              chatInput.value = '';
            }
          }}>Send</button>
        </div>
      `
          : null
      }
    </div>
  `;
}

fetchAll().then(() => {
  connectWS();
  const el = document.getElementById('app');
  if (el) render(html`<${App} />`, el);
});
