#!/usr/bin/env -S NODE_NO_WARNINGS=1 bun
// Two upstream warnings bleed into every invocation:
//   - `TimeoutNegativeWarning` (xstate in polly): a Node process
//     warning. NODE_NO_WARNINGS=1 on the wrapper suppresses it
//     before any JS runs.
//   - "using deprecated parameters for `initSync()`" (automerge-
//     wasm): a plain `console.warn`, not a process warning, so the
//     env var has no effect. The preload import below patches
//     console.warn before any other module imports can fire. It
//     has to be the very first import so its side effect runs
//     before the transitive import of polly → automerge-wasm.

// reflect-metadata MUST be loaded before any module that imports
// `@anthropic-ai/claude-agent-sdk` (used in commands/chat.ts and
// pulled into the bundle by static analysis). The SDK uses tsyringe,
// which calls Reflect.getMetadata at module-init — without the
// polyfill present at evaluation time the bundle errors with
// "tsyringe requires a reflect polyfill" before any of our code runs.
// Bun's bundler doesn't guarantee a stable order between
// reflect-metadata's IIFE and tsyringe's class evaluations unless
// reflect-metadata is the first thing the entry point imports; small
// edits to bin.ts that reshuffle other imports were observed to flip
// the ordering and break startup.
import 'reflect-metadata';
import '#src/preload.ts';

// fairfox — CLI peer for the fairfox mesh.
//
// Verb-first command surface. Goals map to single verbs; sub-verbs
// only appear where the distinction matters (`add device` vs
// `add user` carry different semantics — recovery-blob included
// vs not). Every command accepts `--help` / `-h` and `--verbose` /
// `-v`; `--verbose` is stripped early and turned into a global flag
// the rest of the codebase reads via `isVerbose()` / `vlog()`.

import { agendaAdd, agendaList } from '#src/commands/agenda.ts';
import { chatDump, chatSend, chatServe } from '#src/commands/chat.ts';
import { daemon } from '#src/commands/daemon.ts';
import { deploy } from '#src/commands/deploy.ts';
import { doctor } from '#src/commands/doctor.ts';
import {
  meshAddDevice,
  meshAddUser,
  meshFingerprintCmd,
  meshInit,
  meshInviteList,
} from '#src/commands/mesh.ts';
import { pair } from '#src/commands/pair.ts';
import { peersForget, peersList, peersRenameSelf } from '#src/commands/peers.ts';
import { todo } from '#src/commands/todo.ts';
import { maybeNoticeUpdate, update } from '#src/commands/update.ts';
import { usersList, usersRevoke, usersWhoami } from '#src/commands/users.ts';
import { commandHelp, topLevelHelp, wantsHelp } from '#src/help.ts';
import { setVerbose } from '#src/verbose.ts';

/** Strip --verbose / -v from argv up-front and set the global flag.
 * Strips in place so individual command parsers don't need to know
 * about the flag — they only see their own positional args + flags
 * after this returns. */
function consumeVerboseFlag(argv: string[]): string[] {
  const out: string[] = [];
  let verbose = false;
  for (const a of argv) {
    if (a === '--verbose' || a === '-v') {
      verbose = true;
      continue;
    }
    out.push(a);
  }
  setVerbose(verbose);
  return out;
}

/** Helper: if the user passed --help on a multi-word command, render
 * the matching block; otherwise return null and let the dispatcher
 * call the real handler. */
function helpFor(name: string, args: readonly string[]): number | null {
  if (!wantsHelp(args)) {
    return null;
  }
  const text = commandHelp(name);
  if (text) {
    process.stdout.write(text);
    return 0;
  }
  return null;
}

function main(): Promise<number> {
  const argv = consumeVerboseFlag(process.argv.slice(2));
  const [subcommand, ...rest] = argv;

  if (!subcommand || subcommand === 'help' || wantsHelp([subcommand])) {
    process.stdout.write(topLevelHelp());
    return Promise.resolve(subcommand ? 0 : 1);
  }

  // ── mesh lifecycle ────────────────────────────────────────────────
  if (subcommand === 'init') {
    const help = helpFor('init', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    return meshInit(rest);
  }

  if (subcommand === 'add') {
    const [kind, ...kindArgs] = rest;
    if (kind === 'device') {
      const help = helpFor('add device', kindArgs);
      if (help !== null) {
        return Promise.resolve(help);
      }
      return meshAddDevice();
    }
    if (kind === 'user') {
      const help = helpFor('add user', kindArgs);
      if (help !== null) {
        return Promise.resolve(help);
      }
      return meshAddUser(kindArgs);
    }
    process.stderr.write(
      'fairfox add: expected `device` or `user`. Try `fairfox add device --help`.\n'
    );
    return Promise.resolve(1);
  }

  if (subcommand === 'pair') {
    const help = helpFor('pair', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    return pair(rest);
  }

  // ── identity / membership ────────────────────────────────────────
  if (subcommand === 'whoami') {
    const help = helpFor('whoami', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    // Wired to the user-identity-rich path (userId / roles / grants /
    // effective perms). Mesh-level info — name, fingerprint, peerId —
    // is its own verb (`fairfox fingerprint`) and the doctor output.
    return usersWhoami();
  }

  if (subcommand === 'rename') {
    const help = helpFor('rename', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    const name = rest.join(' ').trim();
    if (!name) {
      process.stderr.write('fairfox rename: expected a name.\n');
      return Promise.resolve(1);
    }
    return peersRenameSelf(name);
  }

  if (subcommand === 'revoke') {
    const help = helpFor('revoke', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    const target = rest[0];
    if (!target) {
      process.stderr.write('fairfox revoke: expected a userId.\n');
      return Promise.resolve(1);
    }
    return usersRevoke(target);
  }

  if (subcommand === 'forget') {
    const help = helpFor('forget', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    const target = rest[0];
    if (!target) {
      process.stderr.write('fairfox forget: expected a peerId.\n');
      return Promise.resolve(1);
    }
    return peersForget(target);
  }

  // ── listing ──────────────────────────────────────────────────────
  if (subcommand === 'peers') {
    const help = helpFor('peers', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    return peersList();
  }

  if (subcommand === 'users') {
    const help = helpFor('users', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    return usersList();
  }

  if (subcommand === 'invites') {
    const help = helpFor('invites', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    return meshInviteList();
  }

  if (subcommand === 'fingerprint') {
    const help = helpFor('fingerprint', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    return meshFingerprintCmd();
  }

  // ── diagnostics + lifecycle ─────────────────────────────────────
  if (subcommand === 'doctor') {
    const help = helpFor('doctor', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    return doctor();
  }

  if (subcommand === 'update') {
    const help = helpFor('update', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    return update();
  }

  if (subcommand === 'deploy') {
    const help = helpFor('deploy', rest);
    if (help !== null) {
      return Promise.resolve(help);
    }
    return deploy(rest);
  }

  // ── sub-app verbs (already verb-shaped — keep) ───────────────────
  if (subcommand === 'chat') {
    if (wantsHelp(rest)) {
      process.stdout.write(commandHelp('chat') ?? '');
      return Promise.resolve(0);
    }
    const verb = rest[0];
    if (verb === 'serve') {
      return chatServe();
    }
    if (verb === 'send') {
      const text = rest.slice(1).join(' ').trim();
      if (!text) {
        process.stderr.write('fairfox chat send: expected message text.\n');
        return Promise.resolve(1);
      }
      return chatSend(text);
    }
    if (verb === 'dump') {
      return chatDump();
    }
    process.stderr.write('fairfox chat: unknown verb. Try `fairfox chat --help`.\n');
    return Promise.resolve(1);
  }

  if (subcommand === 'daemon') {
    if (wantsHelp(rest)) {
      process.stdout.write(commandHelp('daemon') ?? '');
      return Promise.resolve(0);
    }
    return daemon(rest);
  }

  if (subcommand === 'agenda') {
    if (wantsHelp(rest)) {
      process.stdout.write(commandHelp('agenda') ?? '');
      return Promise.resolve(0);
    }
    const verb = rest[0];
    if (verb === 'list') {
      return agendaList();
    }
    if (verb === 'add') {
      const text = rest.slice(1).join(' ').trim();
      if (!text) {
        process.stderr.write('fairfox agenda add: expected a chore name.\n');
        return Promise.resolve(1);
      }
      return agendaAdd(text);
    }
    process.stderr.write('fairfox agenda: unknown verb. Try `fairfox agenda --help`.\n');
    return Promise.resolve(1);
  }

  if (subcommand === 'todo') {
    if (wantsHelp(rest)) {
      process.stdout.write(commandHelp('todo') ?? '');
      return Promise.resolve(0);
    }
    return todo(rest);
  }

  process.stderr.write(`fairfox: unknown command "${subcommand}".\n\n`);
  process.stdout.write(topLevelHelp());
  return Promise.resolve(1);
}

process.on('uncaughtException', (err) => {
  process.stderr.write(`fairfox: uncaught — ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const s = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  process.stderr.write(`fairfox: unhandled rejection — ${s}\n`);
  process.exit(1);
});

async function runWithUpdateNotice(): Promise<number> {
  const code = await main();
  if (process.argv[2] !== 'update') {
    await maybeNoticeUpdate();
  }
  return code;
}

runWithUpdateNotice()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `fairfox: fatal — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
    );
    process.exit(1);
  });
