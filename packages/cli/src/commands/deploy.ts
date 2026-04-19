// `fairfox deploy` — push the current repo working tree to Railway.
//
// Wraps `railway up --detach` so the day-to-day deploy command is the
// same one the paired CLI already runs to pair, manage the agenda, and
// (eventually) everything else. A linked-in-place CLI therefore becomes
// the single surface for fairfox operations: one binary, one set of
// habits, no context switch to a separate Railway workflow.
//
// The wrapper is thin. It resolves the fairfox repo root — the nearest
// ancestor of the current working directory that contains a
// `package.json` whose `name` is `fairfox` — so the command works from
// any sub-package, spawns `railway up --detach` inside that directory,
// and streams the child's stdout / stderr through unchanged so the
// build-logs URL lands in the terminal the user is watching. A missing
// `railway` binary surfaces as a clear error rather than an opaque
// spawn failure.
//
// `fairfox deploy status` shells out to `railway deployment list` and
// prints the last few rows, so a user can check what they shipped
// without remembering the Railway CLI's own vocabulary.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

async function findFairfoxRoot(start: string): Promise<string | null> {
  let dir = resolve(start);
  // Walk up looking for the repo root. A nested package.json with a
  // different name stops the walk early, so we read every one.
  while (true) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const raw: unknown = JSON.parse(await readFile(candidate, 'utf8'));
      if (typeof raw === 'object' && raw !== null && 'name' in raw && raw.name === 'fairfox') {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function railwayAvailable(): boolean {
  const result = Bun.spawnSync(['which', 'railway'], { stdout: 'pipe', stderr: 'pipe' });
  return result.exitCode === 0;
}

function run(args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn('railway', args, { cwd, stdio: 'inherit' });
    child.on('exit', (code) => {
      resolvePromise(code ?? 0);
    });
    child.on('error', (err) => {
      process.stderr.write(`fairfox deploy: ${err.message}\n`);
      resolvePromise(1);
    });
  });
}

function resolveRoot(): Promise<string | null> {
  const override = process.env.FAIRFOX_REPO;
  if (override && existsSync(join(override, 'package.json'))) {
    return Promise.resolve(override);
  }
  return findFairfoxRoot(process.cwd());
}

export async function deploy(rest: readonly string[]): Promise<number> {
  const [sub = 'push', ...args] = rest;
  if (!railwayAvailable()) {
    process.stderr.write(
      'fairfox deploy: `railway` CLI is not on PATH. Install it from https://docs.railway.app/guides/cli and sign in with `railway login`.\n'
    );
    return 1;
  }
  const root = await resolveRoot();
  if (!root) {
    process.stderr.write(
      'fairfox deploy: could not find the fairfox repo. Run this from inside the checkout or set FAIRFOX_REPO=/path/to/fairfox.\n'
    );
    return 1;
  }
  if (sub === 'push' || sub === 'up') {
    process.stdout.write(`fairfox deploy: railway up --detach (from ${root})\n`);
    return run(['up', '--detach', ...args], root);
  }
  if (sub === 'status') {
    return run(['deployment', 'list', ...args], root);
  }
  if (sub === 'logs') {
    return run(['logs', ...args], root);
  }
  process.stderr.write(`fairfox deploy: unknown subcommand "${sub}". Try push, status, or logs.\n`);
  return 1;
}
