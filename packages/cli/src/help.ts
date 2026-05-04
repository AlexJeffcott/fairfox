// Per-command help text. bin.ts checks `--help` / `-h` on every
// subcommand and prints the matching block here; the top-level
// invocation (no args, or `fairfox help`) prints the short index of
// every command with one-liner descriptions.
//
// Help text is the user contract for the CLI — own it in one file so
// renaming a verb or adding a flag is exactly one edit, with no risk
// of `bin.ts` and individual command modules drifting from each other.

interface CommandHelp {
  /** Canonical name; same string the bin.ts dispatcher matches against. */
  readonly name: string;
  /** Single-line summary used in the index of `fairfox --help`. */
  readonly summary: string;
  /** Multi-line detailed help shown by `fairfox <name> --help`. */
  readonly body: string;
}

function renderBody(name: string, body: string): string {
  // Universal flags get appended automatically — every command path
  // accepts `--help` and `--verbose`, so documenting them in one
  // place keeps the per-command block focused on the verb itself.
  const universal = [
    '',
    'Universal flags:',
    '  --help, -h     Show this help.',
    '  --verbose, -v  Stream signalling, sync, and repo diagnostics to stderr.',
  ].join('\n');
  return `fairfox ${name} — ${body.trimEnd()}\n${universal}\n`;
}

const COMMANDS: readonly CommandHelp[] = [
  {
    name: 'init',
    summary: 'Create a brand-new mesh on this machine.',
    body: `Create a brand-new mesh on this machine.

Bootstraps the admin user, writes a fresh keyring, optionally queues
invite blobs for other users, and writes the mesh's name into mesh:meta.
Affects only this machine — other paired devices stay on whatever mesh
they were on until they wipe their own state.

Usage:
  fairfox init <mesh-name> [--admin "Alex"] [--user "Elisa:member"]…
                            [--force]

Examples:
  fairfox init "Holm household" --admin "Alex" --user "Elisa:member"
  fairfox init "tinkering" --admin "Alex" --user "Leo:guest"
  fairfox init "test mesh" --admin "Tester" --force

Roles:
  admin    full control: invite, revoke, grant, remove devices.
  member   day-to-day usage: read+write all mesh docs.
  guest    read-only.
  llm      automation peer with no UI.

Pass --force to wipe this machine's keyring + user identity + pending
invites and start fresh. Other paired devices are unaffected — if you
want them to join the new mesh too, re-pair them after.`,
  },
  {
    name: 'add device',
    summary: 'Add another device for YOU (your phone, another laptop, …).',
    body: `Add another device for YOU.

Opens a live QR + share URL that carries your recovery blob, so the
new device pairs into the mesh AND adopts your identity in one tap.
Holds the signalling socket open until the new device finishes
pairing or you ctrl-c.

Usage:
  fairfox add device

The share URL contains your private key — only share it with yourself.`,
  },
  {
    name: 'add user',
    summary: 'Invite a new user to the mesh and open a live QR for them.',
    body: `Invite a new user to the mesh.

Creates a signed invite blob with the given role, queues it under the
name you choose, and opens a live QR + share URL for it. Hold the
socket open until the invitee scans, or ctrl-c to dismiss (the queued
invite stays around — re-open it later with the same name).

Usage:
  fairfox add user <name> [--role admin|member|guest|llm]
                          [--queue-only]

Examples:
  fairfox add user Elisa --role member
  fairfox add user Leo                       # default role: member

Pass --queue-only to write the invite blob without opening the QR;
useful when bootstrapping a mesh ahead of time. Open it later with
\`fairfox add user <name>\`.`,
  },
  {
    name: 'pair',
    summary: 'Receive a pairing token, share URL, or recovery blob.',
    body: `Receive a pairing token, share URL, or recovery blob.

The receiving side of every onboarding flow. Sniffs the input — pair
tokens, share URLs (\`#pair=…&invite=…\`), and recovery blobs all
route to the right handler. Use this when someone else ran
\`fairfox add device\`, \`fairfox add user\`, or sent you a recovery
blob to import.

Usage:
  fairfox pair <token-or-url-or-blob>

Examples:
  fairfox pair https://fairfox.example/#pair=abc&invite=xyz
  fairfox pair eyJ2IjoxLCJ1c2VySWQiOi…
  fairfox pair $(pbpaste)`,
  },
  {
    name: 'whoami',
    summary: 'Print this device + this user + effective permissions.',
    body: `Print this device + this user + effective permissions.

Reads ~/.fairfox/keyring.json and ~/.fairfox/user-identity.json plus
the live mesh:users / mesh:devices documents to report what this
machine sees as itself: peerId, userId, displayName, roles, and the
permission set those roles grant.

Usage:
  fairfox whoami`,
  },
  {
    name: 'rename',
    summary: "Rename this device's row in mesh:devices.",
    body: `Rename this device's row in mesh:devices.

Updates the human-readable name shown in the Peers tab and in
\`fairfox peers\`. Only renames THIS device; to rename someone else's,
they have to run rename from there.

Usage:
  fairfox rename <new-name>

Examples:
  fairfox rename "Alex laptop"
  fairfox rename kitchen-pi`,
  },
  {
    name: 'revoke',
    summary: 'Revoke a user across the mesh (admin-only, signed).',
    body: `Revoke a user across the mesh.

Writes a signed user revocation into mesh:users and walks
mesh:devices to revoke every peerId whose ownerUserIds is exactly
the target user. Subsequent sync messages from those peers are
dropped at the polly receive hook on every device that's seen the
revocation.

Usage:
  fairfox revoke <userId>

Requires the user.revoke permission (admin role by default).`,
  },
  {
    name: 'forget',
    summary: 'Stop syncing with a peer (local only).',
    body: `Stop syncing with a peer (local only).

Removes the peer from this device's keyring's knownPeers set, so this
device drops every sync message from that peer. The other side keeps
running normally and can still talk to other paired devices. To
remove a peer mesh-wide, use \`fairfox revoke\` on its owning user
instead.

Usage:
  fairfox forget <peerId>`,
  },
  {
    name: 'peers',
    summary: 'List every paired device.',
    body: `List every paired device.

Reads mesh:devices and prints one line per peer: peerId, agent
(browser/cli/extension), name, owners, endorsement count, last-seen.

Usage:
  fairfox peers`,
  },
  {
    name: 'users',
    summary: 'List every user in the mesh (admins first).',
    body: `List every user in the mesh.

Reads mesh:users and prints one line per user: userId, displayName,
roles, grants. Admins are sorted first.

Usage:
  fairfox users`,
  },
  {
    name: 'invites',
    summary: 'Show pending and consumed invites queued on this machine.',
    body: `Show pending and consumed invites queued on this machine.

Reads ~/.fairfox/invites.json. Pending invites can be re-opened with
\`fairfox add user <name>\`. Consumed invites are kept for record-
keeping; remove the file to forget them.

Usage:
  fairfox invites`,
  },
  {
    name: 'fingerprint',
    summary: "Print this mesh's 8-hex fingerprint.",
    body: `Print this mesh's 8-hex fingerprint.

Same value the hub renders in the Help tab's Diagnostics panel.
Compare across two devices to confirm they're paired into the same
cryptographic mesh.

Usage:
  fairfox fingerprint`,
  },
  {
    name: 'doctor',
    summary: 'Diagnose the mesh, relay, and chat documents.',
    body: `Diagnose the mesh, relay, and chat documents.

Reads storage-only — does not connect to signalling, so it's safe to
run while \`fairfox chat serve\` is up. Reports keyring presence,
signalling reachability, mesh identity (including fingerprint),
mesh:devices contents, chat:health relay rows with sync metrics,
daemon:leader lease state, and the chat:main shape with recent
pendings.

Usage:
  fairfox doctor`,
  },
  {
    name: 'update',
    summary: 'Fetch the latest CLI bundle from GitHub Releases.',
    body: `Fetch the latest CLI bundle from GitHub Releases.

Compares the installed version against the latest \`v<x>.<y>.<z>\`
GitHub Release of fairfox; downloads and replaces ~/.fairfox/fairfox.js
when a newer version is available.

Usage:
  fairfox update`,
  },
  {
    name: 'deploy',
    summary: 'Deploy fairfox to Railway.',
    body: `Deploy fairfox to Railway.

Wraps \`railway up\` from the fairfox repo root. Requires the railway
CLI on PATH and a logged-in session.

Usage:
  fairfox deploy [push]
  fairfox deploy status
  fairfox deploy logs`,
  },
  {
    name: 'chat',
    summary: 'Run the chat assistant relay or send / dump messages.',
    body: `Run the chat assistant relay or send / dump messages.

Subcommands:
  fairfox chat serve     Long-lived relay; replies to chat:main
                         pendings via the Anthropic Agent SDK.
  fairfox chat send <t>  Write a pending user message to chat:main.
  fairfox chat dump      Print the chat:main JSON document.

The relay binary is the local \`claude\` if FAIRFOX_CLAUDE_PATH is
unset; install Claude Code so the SDK has a binary to invoke.`,
  },
  {
    name: 'daemon',
    summary: 'launchd / systemd unit that keeps the mesh open.',
    body: `launchd / systemd unit that keeps the mesh open.

Subcommands:
  fairfox daemon install  Install the user-level launchd / systemd unit.
  fairfox daemon start    Start the unit; --foreground to run inline.
  fairfox daemon stop     Stop the unit.
  fairfox daemon status   Unit + pid + log paths.`,
  },
  {
    name: 'agenda',
    summary: 'Read or add agenda chores / events.',
    body: `Read or add agenda chores / events.

Subcommands:
  fairfox agenda list             List chores and events in agenda:main.
  fairfox agenda add <name>       Add a daily-recurring chore.`,
  },
  {
    name: 'todo',
    summary: 'Manage projects, tasks, and quick captures.',
    body: `Manage projects, tasks, and quick captures.

Subcommands:
  fairfox todo tasks                  List open tasks; --done for all.
  fairfox todo task add <desc>        Add a task; --project P --priority H/M/L.
  fairfox todo task done <tid>        Mark a task done.
  fairfox todo projects               List projects.
  fairfox todo capture add <s>        Record a quick capture.
  fairfox todo help                   Full subcommand list.`,
  },
];

export function topLevelHelp(): string {
  const indexLines = COMMANDS.map((c) => `  fairfox ${c.name.padEnd(16)} ${c.summary}`);
  return [
    'fairfox — CLI peer for the fairfox mesh.',
    '',
    'Commands:',
    ...indexLines,
    '',
    'Universal flags on every command:',
    '  --help, -h     Show command-specific help.',
    '  --verbose, -v  Stream signalling, sync, and repo diagnostics to stderr.',
    '',
    'Run `fairfox <command> --help` for full details on any command.',
    '',
    'The keyring lives at ~/.fairfox/keyring.json. The signalling URL',
    'defaults to the fairfox production origin; override with FAIRFOX_URL.',
    '',
  ].join('\n');
}

/** Render help for a specific command name (e.g. "init", "add user").
 * Returns null when no command matches; the caller (bin.ts) decides
 * whether to fall back to the top-level help or print an error. */
export function commandHelp(name: string): string | null {
  const entry = COMMANDS.find((c) => c.name === name);
  if (!entry) {
    return null;
  }
  return renderBody(entry.name, entry.body);
}

/** Detect a help flag in a command's argument list. Returns true iff
 * the user passed `--help` or `-h` anywhere in the args. Commands
 * call this before parsing so help is uniformly available. */
export function wantsHelp(args: readonly string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}
