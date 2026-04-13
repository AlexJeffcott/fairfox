#!/usr/bin/env bun
// Row-count parity check between captured source JSON files and a live fairfox
// deployment. Used as the gate at Phase 3 step 19 of the plan. Exits 0 on
// exact match across every expected table, non-zero on any mismatch.
//
// Usage:
//   bun scripts/verify-migration.ts \
//     --todo-source /tmp/source-counts-todo.json \
//     --todo-conv-source /tmp/source-counts-todo-conv.json \
//     --struggle-source /tmp/source-counts-struggle.json \
//     --target https://fairfox-production-8273.up.railway.app

interface Args {
  todoSource?: string;
  todoConvSource?: string;
  struggleSource?: string;
  target?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k || !v) {
      continue;
    }
    if (k === '--todo-source') {
      out.todoSource = v;
    } else if (k === '--todo-conv-source') {
      out.todoConvSource = v;
    } else if (k === '--struggle-source') {
      out.struggleSource = v;
    } else if (k === '--target') {
      out.target = v;
    }
  }
  return out;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function readJson<T>(path: string): T {
  return JSON.parse(Bun.file(path).readableSync ? '' : '') as T;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.target) {
    console.error('missing --target');
    process.exit(2);
  }
  const target = args.target.replace(/\/$/, '');

  const failures: string[] = [];
  const expectations: Record<string, number> = {};
  const actual: Record<string, number> = {};

  async function loadSource(path: string, prefix: string): Promise<void> {
    const text = await Bun.file(path).text();
    const data = JSON.parse(text) as Record<string, number>;
    for (const [k, v] of Object.entries(data)) {
      expectations[`${prefix}.${k}`] = typeof v === 'number' ? v : Number(v);
    }
  }

  if (args.todoSource) {
    await loadSource(args.todoSource, 'todo');
  }
  if (args.todoConvSource) {
    await loadSource(args.todoConvSource, 'todo');
  }
  if (args.struggleSource) {
    await loadSource(args.struggleSource, 'struggle');
  }

  if (args.todoSource || args.todoConvSource) {
    const backup = await fetchJson<Record<string, unknown>>(`${target}/todo/api/backup`);
    for (const table of [
      'projects',
      'tasks',
      'to_buy',
      'city_home',
      'directories',
      'quick_capture',
      'documents',
    ]) {
      const rows = backup[table];
      actual[`todo.${table}`] = Array.isArray(rows) ? rows.length : -1;
    }
    const convs = await fetchJson<unknown[]>(`${target}/todo/api/conversations`);
    actual['todo.conversations'] = convs.length;
    let messageCount = 0;
    for (const conv of convs as Array<{ id: number }>) {
      const msgs = await fetchJson<unknown[]>(
        `${target}/todo/api/conversations/${conv.id}/messages`
      );
      messageCount += msgs.length;
    }
    actual['todo.messages'] = messageCount;
  }

  if (args.struggleSource) {
    const full = await fetchJson<Record<string, unknown>>(`${target}/struggle/api/backup/full`);
    for (const table of [
      'chapters',
      'passages',
      'passage_content',
      'choices',
      'litanies',
      'place_names',
      'refs',
      'feedback',
      'rewrites',
    ]) {
      const rows = full[table];
      actual[`struggle.${table}`] = Array.isArray(rows) ? rows.length : -1;
    }
  }

  const keys = Object.keys(expectations).sort();
  const width = Math.max(...keys.map((k) => k.length), 10);
  console.log('table'.padEnd(width), ' source  target  ok');
  console.log('-'.repeat(width + 18));
  for (const k of keys) {
    const want = expectations[k];
    const got = actual[k];
    const ok = want === got;
    if (!ok) {
      failures.push(`${k}: want ${want}, got ${got}`);
    }
    console.log(
      k.padEnd(width),
      String(want ?? '-').padStart(7),
      String(got ?? '-').padStart(7),
      ok ? ' ok' : ' MISMATCH'
    );
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} mismatch(es):`);
    for (const f of failures) {
      console.error(`  ${f}`);
    }
    process.exit(1);
  }
  console.log('\nall table counts match');
}

// Keep the unused helper compilable without suppression — TypeScript complains
// about unused locals but we intentionally left readJson as a reference for a
// future sync read path.
void readJson;

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
