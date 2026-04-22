#!/usr/bin/env bun
// One-shot migration: pulls The Struggle's library data (52 docs,
// 296 refs) from the standalone the-struggle-production deployment
// into fairfox's `library:main` $meshState document. Idempotent via
// stable IDs (doc id = path, ref id = source int as string); re-runs
// overwrite in place.
//
// Story content (chapters / passages / choices) lives in a SQLite
// on the standalone deployment and isn't exposed by any HTTP API,
// so that half of the migration reads ~/projects/the_struggle/data/
// app.db directly — see migrate-struggle-story.ts.
//
// Run:
//   bun scripts/migrate-struggle-library.ts
//
// Requires a paired keyring (~/.fairfox/keyring.json) — the script
// opens the mesh as this device and writes the docs/refs arrays on
// behalf of the current user. The mesh propagates to every paired
// peer via CRDT sync.

import { $meshState } from '@fairfox/polly/mesh';
import {
  derivePeerId,
  flushOutgoing,
  keyringStorage,
  openMeshClient,
  waitForPeer,
} from '../packages/cli/src/mesh.ts';

type RefForm = 'prose' | 'poem';
type DocCategory = 'world' | 'structure' | 'interface';

interface Ref {
  [key: string]: unknown;
  id: string;
  title: string;
  author: string;
  form: RefForm;
  tags: string[];
  body: string;
  notes: string;
}

interface Doc {
  [key: string]: unknown;
  id: string;
  path: string;
  category: DocCategory;
  title: string;
  content: string;
  lastModified: string;
}

interface LibraryDoc {
  [key: string]: unknown;
  refs: Ref[];
  docs: Doc[];
}

const LIBRARY_INITIAL: LibraryDoc = { refs: [], docs: [] };

const SOURCE = process.env.STRUGGLE_URL ?? 'https://the-struggle-production.up.railway.app';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === 'string');
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === 'string');
    }
  } catch {
    // Not JSON — fall through and treat as comma-separated.
  }
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function derivCategory(path: string): DocCategory {
  if (path.startsWith('world/')) return 'world';
  if (path.startsWith('structure/')) return 'structure';
  if (path.startsWith('interface/')) return 'interface';
  // Unknown prefix → fold into world; the UI filters by category
  // and "world" is the safer bucket than interface/structure.
  return 'world';
}

function titleFromPath(path: string): string {
  const basename = path.split('/').pop() ?? path;
  return basename.replace(/\.md$/, '').replace(/-/g, ' ');
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function loadAllDocs(): Promise<Doc[]> {
  const base = SOURCE.replace(/\/$/, '');
  const index = await fetchJson<unknown>(`${base}/api/docs`);
  if (!Array.isArray(index)) {
    throw new Error('/api/docs did not return an array');
  }
  const docs: Doc[] = [];
  for (const entry of index) {
    if (!isRecord(entry)) continue;
    const path = str(entry.path);
    if (!path) continue;
    const full = await fetchJson<unknown>(
      `${base}/api/docs/${path.split('/').map(encodeURIComponent).join('/')}`,
    );
    if (!isRecord(full)) continue;
    docs.push({
      id: path,
      path,
      category: derivCategory(path),
      title: titleFromPath(path),
      content: str(full.content),
      lastModified: str(entry.modified) || new Date().toISOString(),
    });
  }
  return docs;
}

async function loadAllRefs(): Promise<Ref[]> {
  const base = SOURCE.replace(/\/$/, '');
  const index = await fetchJson<unknown>(`${base}/api/refs`);
  if (!Array.isArray(index)) {
    throw new Error('/api/refs did not return an array');
  }
  const refs: Ref[] = [];
  for (const entry of index) {
    if (!isRecord(entry)) continue;
    const rawId = entry.id;
    const id = typeof rawId === 'number' ? String(rawId) : str(rawId);
    if (!id) continue;
    const full = await fetchJson<unknown>(`${base}/api/refs/${encodeURIComponent(id)}`);
    if (!isRecord(full)) continue;
    const form: RefForm = full.form === 'poem' ? 'poem' : 'prose';
    refs.push({
      id,
      title: str(full.title),
      author: str(full.author),
      form,
      tags: parseTags(full.tags),
      body: str(full.body),
      notes: str(full.notes),
    });
  }
  return refs;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  process.stdout.write(`[library] fetching docs + refs from ${SOURCE}\n`);
  const [docs, refs] = await Promise.all([loadAllDocs(), loadAllRefs()]);
  process.stdout.write(`[library] source: ${docs.length} docs, ${refs.length} refs\n`);

  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    process.stderr.write('[library] no keyring — run `fairfox pair <token>` first\n');
    return 1;
  }
  const peerId = derivePeerId(keyring.identity.publicKey);
  const client = await openMeshClient({ peerId });
  try {
    const peered = await waitForPeer(client, 8000);
    if (!peered) {
      process.stderr.write(
        '[library] no mesh peer reached in 8s — writes will land locally and sync later. Continuing.\n',
      );
    }
    const lib = $meshState<LibraryDoc>('library:main', LIBRARY_INITIAL);
    await lib.loaded;

    const existingDocs = lib.value.docs.length;
    const existingRefs = lib.value.refs.length;
    if ((existingDocs > 0 || existingRefs > 0) && !force) {
      process.stderr.write(
        `[library] library:main already has ${existingDocs} docs + ${existingRefs} refs. Pass --force to replace.\n`,
      );
      return 1;
    }

    lib.value = { ...lib.value, docs, refs };
    await flushOutgoing(3000);
    process.stdout.write(`[library] wrote ${docs.length} docs + ${refs.length} refs.\n`);
    return 0;
  } finally {
    await client.close();
  }
}

process.exit(await main());
