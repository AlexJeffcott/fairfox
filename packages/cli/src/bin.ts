#!/usr/bin/env bun
// fairfox — CLI peer for the fairfox mesh.
//
// Participates in the same mesh the browser sub-apps do, reads and
// writes $meshState documents, and persists a keyring under
// ~/.fairfox/keyring.json. Pairing is the same asymmetric ceremony the
// browser flow uses: the CLI accepts a `#pair=...` share URL or a raw
// base64 token, applies it to its keyring, and prints its own share
// URL so the browser side can scan it back.
//
// Usage:
//   fairfox pair <token-or-url>   Apply a pairing token; print our share URL.
//   fairfox agenda list           List chores and events in the agenda doc.
//   fairfox agenda add <name>     Add a chore (daily recurrence) to the agenda doc.
//
// Every command that touches the mesh opens a brief connection, waits
// for the Automerge sync handshake against whichever peers are online,
// mutates or reads, flushes, and exits. Long-running peer mode is a
// follow-up (see ISSUE).

import { parseArgs } from 'node:util';
import { agendaAdd, agendaList } from '#src/commands/agenda.ts';
import { deploy } from '#src/commands/deploy.ts';
import { pair } from '#src/commands/pair.ts';
import { peers } from '#src/commands/peers.ts';
import { todo } from '#src/commands/todo.ts';
import { users } from '#src/commands/users.ts';

function printUsage(): void {
  process.stderr.write(
    [
      'fairfox — CLI peer for the fairfox mesh',
      '',
      'Usage:',
      '  fairfox pair <token-or-url>   Apply a pairing token; print our share URL.',
      '  fairfox agenda list           List chores and events in the agenda doc.',
      '  fairfox agenda add <name>     Add a chore (daily recurrence).',
      '  fairfox peers                 List every paired device.',
      '  fairfox peers rename <name>   Rename this device in the mesh.',
      '  fairfox peers forget <pid>    Stop syncing with a peer (local).',
      '  fairfox users                 List every user in the mesh (admins first).',
      '  fairfox todo tasks            List open tasks (add --done for all).',
      '  fairfox todo task add <desc>  Add a task; --project P --priority high|med|low.',
      '  fairfox todo task done <tid>  Mark a task done.',
      '  fairfox todo projects         List projects (add --status ...).',
      '  fairfox todo capture add <s>  Record a quick capture.',
      '  fairfox todo help             Full list of todo subcommands.',
      '  fairfox deploy [push]         `railway up --detach` from the fairfox repo.',
      '  fairfox deploy status         List recent Railway deployments.',
      '  fairfox deploy logs           Tail Railway logs for the current service.',
      '',
      'The keyring is stored at ~/.fairfox/keyring.json and is created on',
      'first run. The signalling URL defaults to the fairfox production',
      'origin; override with FAIRFOX_URL.',
      '',
    ].join('\n')
  );
}

function main(): Promise<number> {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printUsage();
    return Promise.resolve(subcommand ? 0 : 1);
  }

  if (subcommand === 'pair') {
    const token = rest[0];
    if (!token) {
      process.stderr.write(
        'fairfox pair: expected a pairing token or URL as the first argument.\n'
      );
      return Promise.resolve(1);
    }
    return pair(token);
  }

  if (subcommand === 'agenda') {
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
    process.stderr.write(`fairfox agenda: unknown verb "${verb ?? ''}". Try "list" or "add".\n`);
    return Promise.resolve(1);
  }

  if (subcommand === 'deploy') {
    return deploy(rest);
  }

  if (subcommand === 'todo') {
    return todo(rest);
  }

  if (subcommand === 'peers') {
    return peers(rest);
  }

  if (subcommand === 'users') {
    return users(rest);
  }

  process.stderr.write(`fairfox: unknown subcommand "${subcommand}".\n\n`);
  printUsage();
  return Promise.resolve(1);
}

// parseArgs is imported so future subcommands can adopt it; the v1
// subcommands do positional parsing only.
void parseArgs;

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`fairfox: fatal — ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
