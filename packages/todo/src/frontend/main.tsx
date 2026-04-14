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
  | 'document'
  | 'agenda';
const activeView = signal<View>('projects');

type AgendaSubView = 'today' | 'items' | 'fairness';
const agendaSubView = signal<AgendaSubView>('today');

type AgendaPerson = 'Leo' | 'Elisa' | 'Alex';
const AGENDA_PEOPLE: AgendaPerson[] = ['Leo', 'Elisa', 'Alex'];
const AGENDA_ROOMS = [
  'kitchen',
  'master_bedroom',
  'leos_bedroom',
  'music_room',
  'music_room_balcony',
  'utility_room',
  'living_room',
  'kitchen_balcony',
  'guest_bathroom',
  'main_bathroom',
  'entrance_hall',
] as const;
type AgendaRoom = (typeof AGENDA_ROOMS)[number];

interface AgendaItemRow {
  id: number;
  kind: 'task' | 'event';
  name: string;
  room: AgendaRoom | null;
  points: number;
  time_of_day: string | null;
  recurrence: 'once' | 'daily' | 'weekdays' | 'interval';
  recurrence_data: string;
  notes: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AgendaTodayEntry {
  item: AgendaItemRow;
  daysOverdue: number;
  lastCompletion: { id: number; done_by: string; done_at: string; kind: string } | null;
}

interface AgendaTodayResponse {
  date: string;
  scheduled: AgendaTodayEntry[];
  anytime: AgendaTodayEntry[];
}

interface AgendaFairnessResponse {
  days: number;
  by_person: { done_by: string; completions: number; total_points: number }[];
}

const agendaToday = signal<AgendaTodayResponse | null>(null);
const agendaItemsList = signal<AgendaItemRow[]>([]);
const agendaFairness = signal<AgendaFairnessResponse | null>(null);
const agendaCreating = signal<boolean>(false);
const agendaEditingId = signal<number | null>(null);
const agendaPendingSnooze = signal<Record<number, 'snooze_1d' | 'snooze_3d' | 'snooze_7d'>>({});

const emptyAgendaDraft = (): Record<string, any> => ({
  kind: 'task',
  name: '',
  room: '',
  points: 5,
  time_of_day: '',
  recurrence: 'interval',
  interval_days: 7,
  date: '',
  weekdays: [1, 2, 3, 4, 5],
  notes: '',
});
const agendaCreateDraft = signal<Record<string, any>>(emptyAgendaDraft());
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
  await fetchAgendaToday();
}

async function fetchAgendaToday() {
  const r = await fetch(`${API}/api/agenda/today`);
  agendaToday.value = await r.json();
}

async function fetchAgendaItems() {
  const r = await fetch(`${API}/api/agenda/items`);
  agendaItemsList.value = await r.json();
}

async function fetchAgendaFairness() {
  const r = await fetch(`${API}/api/agenda/fairness`);
  agendaFairness.value = await r.json();
}

async function completeAgendaItem(id: number, doneBy: AgendaPerson, kind: string) {
  await fetch(`${API}/api/agenda/items/${id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done_by: doneBy, kind }),
  });
  await fetchAgendaToday();
}

function startSnooze(id: number, kind: 'snooze_1d' | 'snooze_3d' | 'snooze_7d') {
  agendaPendingSnooze.value = { ...agendaPendingSnooze.value, [id]: kind };
}

function cancelSnooze(id: number) {
  const next = { ...agendaPendingSnooze.value };
  delete next[id];
  agendaPendingSnooze.value = next;
}

async function confirmSnooze(id: number, person: AgendaPerson) {
  const kind = agendaPendingSnooze.value[id];
  if (!kind) return;
  await fetch(`${API}/api/agenda/items/${id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done_by: person, kind }),
  });
  cancelSnooze(id);
  await fetchAgendaToday();
}

async function deleteAgendaItem(id: number) {
  await fetch(`${API}/api/agenda/items/${id}`, { method: 'DELETE' });
  await fetchAgendaItems();
  await fetchAgendaToday();
}

function buildRecurrenceData(draft: Record<string, any>): Record<string, any> | null {
  switch (draft.recurrence) {
    case 'once': {
      if (typeof draft.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
        return null;
      }
      return { date: draft.date };
    }
    case 'daily':
      return {};
    case 'weekdays': {
      const days = Array.isArray(draft.weekdays) ? draft.weekdays : [];
      if (days.length === 0) return null;
      return { days };
    }
    case 'interval': {
      const n = Number(draft.interval_days);
      if (!Number.isInteger(n) || n < 1) return null;
      return { interval_days: n };
    }
    default:
      return null;
  }
}

function startEditAgendaItem(item: AgendaItemRow) {
  let data: Record<string, any> = {};
  try {
    data = JSON.parse(item.recurrence_data);
  } catch (_err) {
    data = {};
  }
  agendaCreateDraft.value = {
    kind: item.kind,
    name: item.name,
    room: item.room ?? '',
    points: item.points,
    time_of_day: item.time_of_day ?? '',
    recurrence: item.recurrence,
    interval_days: typeof data.interval_days === 'number' ? data.interval_days : 7,
    date: typeof data.date === 'string' ? data.date : '',
    weekdays: Array.isArray(data.days) ? data.days : [1, 2, 3, 4, 5],
    notes: item.notes,
  };
  agendaEditingId.value = item.id;
  agendaCreating.value = true;
}

function resetAgendaForm() {
  agendaCreating.value = false;
  agendaEditingId.value = null;
  agendaCreateDraft.value = emptyAgendaDraft();
}

async function saveAgendaItem() {
  const draft = agendaCreateDraft.value;
  const recurrenceData = buildRecurrenceData(draft);
  if (recurrenceData === null) {
    alert('Recurrence data is incomplete or invalid');
    return;
  }
  if (!draft.name || !draft.name.trim()) {
    alert('Name is required');
    return;
  }
  const body: Record<string, any> = {
    kind: draft.kind,
    name: draft.name.trim(),
    points: Number(draft.points) || 1,
    recurrence: draft.recurrence,
    recurrence_data: recurrenceData,
    notes: draft.notes || '',
  };
  if (draft.room && draft.room !== '') body.room = draft.room;
  else body.room = null;
  if (draft.time_of_day && draft.time_of_day !== '') body.time_of_day = draft.time_of_day;
  else body.time_of_day = null;

  const editingId = agendaEditingId.value;
  const url =
    editingId !== null ? `${API}/api/agenda/items/${editingId}` : `${API}/api/agenda/items`;
  const method = editingId !== null ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'unknown' }));
    alert(`Could not save item: ${err.error}`);
    return;
  }
  resetAgendaForm();
  await fetchAgendaItems();
  await fetchAgendaToday();
}

function roomLabel(room: string | null): string {
  if (!room) return '';
  return room
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function escalationClass(daysOverdue: number): string {
  if (daysOverdue >= 8) return 'agenda-escalation-red';
  if (daysOverdue >= 3) return 'agenda-escalation-orange';
  if (daysOverdue >= 1) return 'agenda-escalation-amber';
  return 'agenda-escalation-neutral';
}

function overdueLabel(daysOverdue: number): string {
  if (daysOverdue === 0) return 'due today';
  if (daysOverdue === 1) return '1 day overdue';
  return `${daysOverdue} days overdue`;
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
  if (view === 'agenda') {
    fetchAgendaToday();
    fetchAgendaItems();
    fetchAgendaFairness();
  }
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

function AgendaTodayView() {
  const data = agendaToday.value;
  if (!data) {
    return html`<div class="empty">Loading…</div>`;
  }
  const dateLabel = new Date(`${data.date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return html`
    <div class="agenda-today">
      <h2 class="agenda-date">${dateLabel}</h2>

      <section class="agenda-section">
        <h3>Scheduled</h3>
        ${
          data.scheduled.length === 0
            ? html`<div class="empty">No scheduled items today.</div>`
            : data.scheduled.map(
                (entry) => html`<${AgendaTodayRow} entry=${entry} key=${entry.item.id} />`
              )
        }
      </section>

      <section class="agenda-section">
        <h3>Anytime</h3>
        ${
          data.anytime.length === 0
            ? html`<div class="empty">Nothing pending. ✨</div>`
            : data.anytime.map(
                (entry) => html`<${AgendaTodayRow} entry=${entry} key=${entry.item.id} />`
              )
        }
      </section>
    </div>
  `;
}

function AgendaTodayRow({ entry }: { entry: AgendaTodayEntry }) {
  const item = entry.item;
  const isEvent = item.kind === 'event';
  const escalation =
    item.time_of_day !== null ? 'agenda-escalation-neutral' : escalationClass(entry.daysOverdue);
  const pendingKind = agendaPendingSnooze.value[item.id];
  const snoozeLabels: Record<'snooze_1d' | 'snooze_3d' | 'snooze_7d', string> = {
    snooze_1d: '1 day',
    snooze_3d: '3 days',
    snooze_7d: '7 days',
  };
  return html`
    <div class="agenda-row ${escalation}">
      <div class="agenda-row-meta">
        ${item.time_of_day ? html`<span class="agenda-time">${item.time_of_day}</span>` : null}
        ${item.room ? html`<span class="agenda-room">${roomLabel(item.room)}</span>` : null}
      </div>
      <div class="agenda-row-name">${item.name}</div>
      ${
        item.time_of_day === null
          ? html`<div class="agenda-row-overdue">${overdueLabel(entry.daysOverdue)}</div>`
          : null
      }
      ${
        isEvent
          ? html`<div class="agenda-row-actions agenda-row-event">event</div>`
          : pendingKind
            ? html`
              <div class="agenda-row-actions agenda-row-pending">
                <div class="agenda-action-group">
                  <span class="agenda-action-label">Snooze ${snoozeLabels[pendingKind]} as:</span>
                  ${AGENDA_PEOPLE.map(
                    (person) => html`
                      <button
                        class="btn agenda-snooze-btn"
                        onClick=${() => confirmSnooze(item.id, person)}
                      >${person}</button>
                    `
                  )}
                  <button
                    class="btn agenda-cancel-btn"
                    onClick=${() => cancelSnooze(item.id)}
                  >cancel</button>
                </div>
              </div>
            `
            : html`
              <div class="agenda-row-actions">
                <div class="agenda-action-group">
                  <span class="agenda-action-label">Done by:</span>
                  ${AGENDA_PEOPLE.map(
                    (person) => html`
                      <button
                        class="btn agenda-done-btn"
                        onClick=${() => completeAgendaItem(item.id, person, 'done')}
                      >${person}</button>
                    `
                  )}
                </div>
                <div class="agenda-action-group">
                  <span class="agenda-action-label">Snooze:</span>
                  <button class="btn agenda-snooze-btn" onClick=${() => startSnooze(item.id, 'snooze_1d')}>1d</button>
                  <button class="btn agenda-snooze-btn" onClick=${() => startSnooze(item.id, 'snooze_3d')}>3d</button>
                  <button class="btn agenda-snooze-btn" onClick=${() => startSnooze(item.id, 'snooze_7d')}>7d</button>
                </div>
              </div>
            `
      }
    </div>
  `;
}

function AgendaItemsView() {
  const items = agendaItemsList.value;
  return html`
    <div class="agenda-items">
      <div class="agenda-items-header">
        <h2>Items</h2>
        <button class="btn btn-save" onClick=${() => {
          agendaEditingId.value = null;
          agendaCreateDraft.value = emptyAgendaDraft();
          agendaCreating.value = true;
        }}>+ New item</button>
      </div>
      ${agendaCreating.value ? html`<${AgendaCreateForm} />` : null}
      ${
        items.length === 0
          ? html`<div class="empty">No items yet.</div>`
          : html`
            <table class="agenda-items-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Name</th>
                  <th>Room</th>
                  <th>Time</th>
                  <th>Recurrence</th>
                  <th>Points</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${items.map(
                  (item) => html`
                    <tr key=${item.id}>
                      <td>${item.kind}</td>
                      <td>${item.name}</td>
                      <td>${roomLabel(item.room)}</td>
                      <td>${item.time_of_day ?? '—'}</td>
                      <td>${item.recurrence} <code class="agenda-rdata">${item.recurrence_data}</code></td>
                      <td>${item.points}</td>
                      <td>${item.archived_at ? 'archived' : 'active'}</td>
                      <td class="agenda-row-actions-cell">
                        <button
                          class="btn"
                          onClick=${() => startEditAgendaItem(item)}
                        >Edit</button>
                        <button
                          class="btn btn-delete"
                          onClick=${() => {
                            if (confirm(`Delete "${item.name}"?`)) {
                              deleteAgendaItem(item.id);
                            }
                          }}
                        >Delete</button>
                      </td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          `
      }
    </div>
  `;
}

function AgendaCreateForm() {
  const draft = agendaCreateDraft.value;
  const editing = agendaEditingId.value !== null;
  const setDraft = (patch: Record<string, any>) => {
    agendaCreateDraft.value = { ...agendaCreateDraft.value, ...patch };
  };
  const toggleWeekday = (d: number) => {
    const current: number[] = Array.isArray(draft.weekdays) ? draft.weekdays : [];
    const next = current.includes(d) ? current.filter((x) => x !== d) : [...current, d].sort();
    setDraft({ weekdays: next });
  };
  return html`
    <div class="agenda-form">
      <h3 class="agenda-form-title">${editing ? 'Edit item' : 'New item'}</h3>
      <div class="agenda-form-row">
        <label>Kind</label>
        <select value=${draft.kind} onChange=${(e: any) => setDraft({ kind: e.target.value })}>
          <option value="task">task — actionable, has done buttons</option>
          <option value="event">event — display only (drum class, yoga, pickup)</option>
        </select>
      </div>
      <div class="agenda-form-row">
        <label>Name</label>
        <input
          type="text"
          value=${draft.name}
          onInput=${(e: any) => setDraft({ name: e.target.value })}
          placeholder="Clean kitchen windows"
        />
      </div>
      <div class="agenda-form-row">
        <label>Room (chores)</label>
        <select value=${draft.room} onChange=${(e: any) => setDraft({ room: e.target.value })}>
          <option value="">— none —</option>
          ${AGENDA_ROOMS.map((r) => html`<option value=${r}>${roomLabel(r)}</option>`)}
        </select>
      </div>
      <div class="agenda-form-row">
        <label>Time of day (optional)</label>
        <input
          type="time"
          value=${draft.time_of_day}
          onInput=${(e: any) => setDraft({ time_of_day: e.target.value })}
        />
      </div>
      ${
        draft.kind === 'task'
          ? html`
            <div class="agenda-form-row">
              <label>Points (1–10)</label>
              <input
                type="number"
                min="1"
                max="10"
                value=${draft.points}
                onInput=${(e: any) => setDraft({ points: Number(e.target.value) })}
              />
            </div>
          `
          : null
      }
      <div class="agenda-form-row">
        <label>Recurrence</label>
        <select value=${draft.recurrence} onChange=${(e: any) => setDraft({ recurrence: e.target.value })}>
          <option value="once">once — a single date</option>
          <option value="daily">daily — every day</option>
          <option value="weekdays">weekdays — pick which days</option>
          <option value="interval">interval — every N days, anytime</option>
        </select>
      </div>
      ${
        draft.recurrence === 'once'
          ? html`
            <div class="agenda-form-row">
              <label>Date</label>
              <input
                type="date"
                value=${draft.date}
                onInput=${(e: any) => setDraft({ date: e.target.value })}
              />
            </div>
          `
          : null
      }
      ${
        draft.recurrence === 'weekdays'
          ? html`
            <div class="agenda-form-row">
              <label>Days</label>
              <div class="agenda-weekdays">
                ${[1, 2, 3, 4, 5, 6, 7].map((d) => {
                  const labels: Record<number, string> = {
                    1: 'Mon',
                    2: 'Tue',
                    3: 'Wed',
                    4: 'Thu',
                    5: 'Fri',
                    6: 'Sat',
                    7: 'Sun',
                  };
                  const checked: number[] = Array.isArray(draft.weekdays) ? draft.weekdays : [];
                  return html`
                    <label class="agenda-weekday">
                      <input
                        type="checkbox"
                        checked=${checked.includes(d)}
                        onChange=${() => toggleWeekday(d)}
                      />
                      ${labels[d]}
                    </label>
                  `;
                })}
              </div>
            </div>
          `
          : null
      }
      ${
        draft.recurrence === 'interval'
          ? html`
            <div class="agenda-form-row">
              <label>Interval (days)</label>
              <input
                type="number"
                min="1"
                value=${draft.interval_days}
                onInput=${(e: any) => setDraft({ interval_days: Number(e.target.value) })}
              />
            </div>
          `
          : null
      }
      <div class="agenda-form-row">
        <label>Notes</label>
        <textarea
          rows="2"
          value=${draft.notes}
          onInput=${(e: any) => setDraft({ notes: e.target.value })}
        />
      </div>
      <div class="agenda-form-actions">
        <button class="btn btn-save" onClick=${saveAgendaItem}>${editing ? 'Save' : 'Create'}</button>
        <button class="btn" onClick=${resetAgendaForm}>Cancel</button>
      </div>
    </div>
  `;
}

function AgendaFairnessView() {
  const data = agendaFairness.value;
  if (!data) return html`<div class="empty">Loading…</div>`;
  const totalPoints = data.by_person.reduce((s, p) => s + p.total_points, 0);
  return html`
    <div class="agenda-fairness">
      <h2>Last ${data.days} days</h2>
      ${
        data.by_person.length === 0
          ? html`<div class="empty">No completions yet.</div>`
          : html`
            <table class="agenda-fairness-table">
              <thead>
                <tr><th>Person</th><th>Completions</th><th>Points</th><th>Share</th></tr>
              </thead>
              <tbody>
                ${data.by_person.map((row) => {
                  const share =
                    totalPoints > 0 ? Math.round((row.total_points / totalPoints) * 100) : 0;
                  return html`
                    <tr key=${row.done_by}>
                      <td>${row.done_by}</td>
                      <td>${row.completions}</td>
                      <td>${row.total_points}</td>
                      <td>${share}%</td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          `
      }
    </div>
  `;
}

function AgendaView() {
  return html`
    <div class="agenda">
      <div class="agenda-subnav">
        <button
          class="tab ${agendaSubView.value === 'today' ? 'active' : ''}"
          onClick=${() => {
            agendaSubView.value = 'today';
            fetchAgendaToday();
          }}
        >Today</button>
        <button
          class="tab ${agendaSubView.value === 'items' ? 'active' : ''}"
          onClick=${() => {
            agendaSubView.value = 'items';
            fetchAgendaItems();
          }}
        >Items</button>
        <button
          class="tab ${agendaSubView.value === 'fairness' ? 'active' : ''}"
          onClick=${() => {
            agendaSubView.value = 'fairness';
            fetchAgendaFairness();
          }}
        >Fairness</button>
      </div>
      ${
        agendaSubView.value === 'today'
          ? html`<${AgendaTodayView} />`
          : agendaSubView.value === 'items'
            ? html`<${AgendaItemsView} />`
            : html`<${AgendaFairnessView} />`
      }
    </div>
  `;
}

const TABS: { id: View; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'agenda', label: 'Agenda' },
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

  const agendaTodayCount = computed(() => {
    const t = agendaToday.value;
    if (!t) return 0;
    return t.scheduled.length + t.anytime.length;
  });

  const counts: Record<View, any> = {
    projects: projectCount,
    tasks: openTasks,
    agenda: agendaTodayCount,
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
                : activeView.value === 'agenda'
                  ? html`<${AgendaView} />`
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
