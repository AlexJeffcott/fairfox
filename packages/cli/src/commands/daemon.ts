// `fairfox daemon` — a single supervised process that keeps the mesh
// open on this machine. Phase 1: mesh only (no assistant yet).
//
// Verbs:
//   start [--foreground]   — open the mesh client and block until
//                            SIGTERM/SIGINT. launchd/systemd invoke
//                            this with --foreground on login.
//                            Without --foreground it shells the OS
//                            supervisor to start the already-installed
//                            unit.
//   stop                   — ask the OS supervisor to stop the unit.
//   status                 — print whether the unit is registered +
//                            running + the log path.
//   install                — write ~/Library/LaunchAgents/com.fairfox.daemon.plist
//                            (macOS) or ~/.config/systemd/user/fairfox-daemon.service
//                            (linux); print the next command to run.
//   uninstall              — remove the unit file; leave logs alone.
//   reload                 — send SIGHUP to a running daemon so it
//                            re-reads ~/.fairfox/daemon/config.json.
//                            Phase 1 has no config, so this is a
//                            placeholder that just prints "no-op".

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type {
  SessionAnnouncement,
  SessionAnnouncementState,
  SessionsActive,
} from '@fairfox/shared/assistant-state';
import {
  SESSIONS_ACTIVE_DOC_ID,
  toAbsolutePath,
  toSessionId,
} from '@fairfox/shared/assistant-state';
import { $meshState } from '@fairfox/shared/polly';
import {
  currentOs,
  DAEMON_LOG_DIR,
  DAEMON_STDERR,
  DAEMON_STDOUT,
  fairfoxBinPath,
  LAUNCH_AGENT_LABEL,
  LAUNCH_AGENT_PATH,
  removeUnitFile,
  renderCcHookSnippet,
  SYSTEMD_UNIT_PATH,
  writeLaunchAgent,
  writeSystemdUnit,
} from '#src/daemon-install.ts';
import { derivePeerId, flushOutgoing, keyringStorage, openMeshClient } from '#src/mesh.ts';

const HOOK_FLUSH_MS = 500;
const HOOK_STDIN_TIMEOUT_MS = 2000;

type HookKind = 'session-start' | 'prompt-submit' | 'pre-tool' | 'post-tool' | 'session-stop';

const HOOK_KIND_TO_STATE: Record<HookKind, SessionAnnouncementState> = {
  'session-start': 'started',
  'prompt-submit': 'prompt-submit',
  'pre-tool': 'pre-tool',
  'post-tool': 'post-tool',
  'session-stop': 'stopped',
};

function isHookKind(v: string): v is HookKind {
  return (
    v === 'session-start' ||
    v === 'prompt-submit' ||
    v === 'pre-tool' ||
    v === 'post-tool' ||
    v === 'session-stop'
  );
}

async function readStdinJson(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) {
    return {};
  }
  const chunks: Buffer[] = [];
  let raw = '';
  const done = new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => resolve(), HOOK_STDIN_TIMEOUT_MS);
    process.stdin.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      clearTimeout(to);
      resolve();
    });
    process.stdin.on('error', (err) => {
      clearTimeout(to);
      reject(err);
    });
  });
  await done;
  raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to empty
  }
  return {};
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function upsertSession(prev: SessionsActive, entry: SessionAnnouncement): SessionsActive {
  const filtered = prev.sessions.filter((s) => s.sessionId !== entry.sessionId);
  return { sessions: [...filtered, entry] };
}

function removeSessionById(prev: SessionsActive, sessionId: string): SessionsActive {
  return { sessions: prev.sessions.filter((s) => `${s.sessionId}` !== sessionId) };
}

async function daemonHook(kindRaw: string): Promise<number> {
  if (!isHookKind(kindRaw)) {
    process.stderr.write(
      `fairfox daemon hook: unknown kind "${kindRaw}" — expected session-start|prompt-submit|pre-tool|post-tool|session-stop.\n`
    );
    return 1;
  }
  const payload = await readStdinJson();
  const sessionIdRaw = readString(payload, 'session_id') ?? readString(payload, 'sessionId');
  const cwdRaw = readString(payload, 'cwd') ?? process.cwd();
  const transcriptPathRaw =
    readString(payload, 'transcript_path') ?? readString(payload, 'transcriptPath') ?? cwdRaw;
  if (!sessionIdRaw) {
    process.stderr.write('fairfox daemon hook: stdin payload missing session_id.\n');
    return 1;
  }
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    process.stderr.write('fairfox daemon hook: no keyring; run `fairfox pair` first.\n');
    return 1;
  }
  const peerId = derivePeerId(keyring.identity.publicKey);
  const client = await openMeshClient({ peerId });
  try {
    const signal = $meshState<SessionsActive>(SESSIONS_ACTIVE_DOC_ID, { sessions: [] });
    await signal.loaded;
    const nowIso = new Date().toISOString();
    const state = HOOK_KIND_TO_STATE[kindRaw];
    const promptPreview = readString(payload, 'prompt');
    const toolName = readString(payload, 'tool_name') ?? readString(payload, 'toolName');

    let sessionId: SessionAnnouncement['sessionId'];
    try {
      sessionId = toSessionId(sessionIdRaw);
    } catch (err) {
      process.stderr.write(
        `fairfox daemon hook: invalid session_id (${err instanceof Error ? err.message : String(err)}).\n`
      );
      return 1;
    }
    let cwd: SessionAnnouncement['cwd'];
    let transcriptPath: SessionAnnouncement['transcriptPath'];
    try {
      cwd = toAbsolutePath(cwdRaw);
      transcriptPath = toAbsolutePath(transcriptPathRaw);
    } catch (err) {
      process.stderr.write(
        `fairfox daemon hook: bad path (${err instanceof Error ? err.message : String(err)}).\n`
      );
      return 1;
    }

    if (kindRaw === 'session-stop') {
      // Drop the session from sessions:active on stop. Future phase
      // may keep a short tombstone window; v1 removes immediately.
      signal.value = removeSessionById(signal.value, sessionIdRaw);
    } else {
      const entry: SessionAnnouncement = {
        sessionId,
        deviceId: peerId,
        cwd,
        transcriptPath,
        state,
        updatedAt: nowIso,
        ...(promptPreview ? { lastPromptPreview: promptPreview.slice(0, 200) } : {}),
        ...(toolName ? { lastToolName: toolName } : {}),
      };
      signal.value = upsertSession(signal.value, entry);
    }

    await flushOutgoing(HOOK_FLUSH_MS);
    process.stdout.write(`fairfox daemon hook ${kindRaw}: wrote ${sessionIdRaw}\n`);
    return 0;
  } finally {
    try {
      await client.close();
    } catch {
      // best-effort
    }
  }
}

function usage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    [
      'fairfox daemon — supervised mesh peer',
      '',
      'Usage:',
      '  fairfox daemon install        Write the launchd plist (macOS) or',
      '                                systemd unit (linux) + log directory.',
      '  fairfox daemon uninstall      Remove the unit file (keeps logs).',
      '  fairfox daemon start          Ask the OS supervisor to start the unit.',
      '  fairfox daemon start --foreground',
      '                                Run the supervisor loop in this shell',
      '                                (launchd/systemd invoke this form).',
      '  fairfox daemon stop           Ask the OS supervisor to stop the unit.',
      '  fairfox daemon status         Print unit registration + pid + log path.',
      '  fairfox daemon reload         SIGHUP the daemon (reloads config).',
      '  fairfox daemon hook <kind>    Read a Claude Code hook payload from',
      '                                stdin and publish a SessionAnnouncement',
      '                                into the mesh. Kinds: session-start,',
      '                                prompt-submit, pre-tool, post-tool,',
      '                                session-stop.',
      '',
      'Unit file paths:',
      `  macOS:  ${LAUNCH_AGENT_PATH}`,
      `  linux:  ${SYSTEMD_UNIT_PATH}`,
      `Logs:     ${DAEMON_LOG_DIR}`,
      '',
    ].join('\n')
  );
}

async function daemonRunForeground(): Promise<number> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    process.stderr.write(
      'fairfox daemon start: no keyring — run `fairfox mesh init` or pair first.\n'
    );
    return 1;
  }
  const peerId = derivePeerId(keyring.identity.publicKey);
  const client = await openMeshClient({ peerId });

  const startedIso = new Date().toISOString();
  process.stdout.write(
    `fairfox daemon — peerId ${peerId} · started ${startedIso}. Holding the mesh open.\n`
  );

  const heartbeat = setInterval(() => {
    const peers = client.repo.peers.length;
    const now = new Date().toISOString().slice(11, 19);
    process.stdout.write(`[${now}] peers=${peers}\n`);
  }, 15_000);

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });

  clearInterval(heartbeat);
  process.stdout.write('\ndaemon: closing.\n');
  try {
    await flushOutgoing(2000);
  } catch {
    // best-effort
  }
  await client.close();
  return 0;
}

function daemonInstall(): Promise<number> {
  const os = currentOs();
  if (os === 'other') {
    process.stderr.write(
      `fairfox daemon install: unsupported platform "${process.platform}" (macOS + linux only).\n`
    );
    return Promise.resolve(2);
  }
  const bin = fairfoxBinPath();
  if (!existsSync(bin)) {
    process.stderr.write(
      `fairfox daemon install: expected the fairfox wrapper at ${bin}. ` +
        'Install the CLI via the pairing flow first.\n'
    );
    return Promise.resolve(1);
  }
  const result = os === 'darwin' ? writeLaunchAgent(bin) : writeSystemdUnit(bin);
  process.stdout.write(`wrote ${result.unitPath}\n`);
  process.stdout.write('next:\n');
  for (const cmd of result.next) {
    process.stdout.write(`  ${cmd}\n`);
  }
  process.stdout.write('\n');
  process.stdout.write('to bridge Claude Code sessions into the mesh, merge this\n');
  process.stdout.write('into ~/.claude/settings.json under "hooks":\n\n');
  process.stdout.write(renderCcHookSnippet(bin));
  process.stdout.write('\n');
  return Promise.resolve(0);
}

function daemonUninstall(): Promise<number> {
  const os = currentOs();
  if (os === 'other') {
    process.stderr.write('fairfox daemon uninstall: unsupported platform.\n');
    return Promise.resolve(2);
  }
  if (os === 'darwin') {
    // Bring the unit down first; ignore errors (it may already be down).
    spawnSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? 0}/${LAUNCH_AGENT_LABEL}`], {
      stdio: 'ignore',
    });
  } else {
    spawnSync('systemctl', ['--user', 'disable', '--now', 'fairfox-daemon.service'], {
      stdio: 'ignore',
    });
  }
  const r = removeUnitFile(os);
  if (r.removed) {
    process.stdout.write(`removed ${r.path}\n`);
  } else {
    process.stdout.write(`no unit file at ${r.path} (nothing to remove)\n`);
  }
  process.stdout.write(`logs at ${DAEMON_LOG_DIR} left in place.\n`);
  return Promise.resolve(0);
}

function daemonStart(args: readonly string[]): Promise<number> {
  if (args.includes('--foreground')) {
    return daemonRunForeground();
  }
  const os = currentOs();
  if (os === 'darwin') {
    const uid = process.getuid?.() ?? 0;
    const r = spawnSync('launchctl', ['kickstart', '-k', `gui/${uid}/${LAUNCH_AGENT_LABEL}`], {
      stdio: 'inherit',
    });
    return Promise.resolve(r.status ?? 1);
  }
  if (os === 'linux') {
    const r = spawnSync('systemctl', ['--user', 'start', 'fairfox-daemon.service'], {
      stdio: 'inherit',
    });
    return Promise.resolve(r.status ?? 1);
  }
  process.stderr.write('fairfox daemon start: unsupported platform.\n');
  return Promise.resolve(2);
}

function daemonStop(): Promise<number> {
  const os = currentOs();
  if (os === 'darwin') {
    const uid = process.getuid?.() ?? 0;
    const r = spawnSync('launchctl', ['bootout', `gui/${uid}/${LAUNCH_AGENT_LABEL}`], {
      stdio: 'inherit',
    });
    return Promise.resolve(r.status ?? 1);
  }
  if (os === 'linux') {
    const r = spawnSync('systemctl', ['--user', 'stop', 'fairfox-daemon.service'], {
      stdio: 'inherit',
    });
    return Promise.resolve(r.status ?? 1);
  }
  process.stderr.write('fairfox daemon stop: unsupported platform.\n');
  return Promise.resolve(2);
}

function daemonStatus(): Promise<number> {
  const os = currentOs();
  const unitPath = os === 'darwin' ? LAUNCH_AGENT_PATH : SYSTEMD_UNIT_PATH;
  const installed = existsSync(unitPath);
  process.stdout.write(`unit file: ${installed ? unitPath : '(not installed)'}\n`);
  process.stdout.write(`stdout:    ${DAEMON_STDOUT}\n`);
  process.stdout.write(`stderr:    ${DAEMON_STDERR}\n`);
  if (!installed) {
    return Promise.resolve(0);
  }
  if (os === 'darwin') {
    const uid = process.getuid?.() ?? 0;
    const r = spawnSync('launchctl', ['print', `gui/${uid}/${LAUNCH_AGENT_LABEL}`], {
      encoding: 'utf8',
    });
    const out = r.stdout ?? '';
    const stateMatch = out.match(/state = (\w+)/);
    const pidMatch = out.match(/pid = (\d+)/);
    process.stdout.write(`state:     ${stateMatch?.[1] ?? 'unknown'}\n`);
    process.stdout.write(`pid:       ${pidMatch?.[1] ?? '-'}\n`);
    return Promise.resolve(0);
  }
  if (os === 'linux') {
    const r = spawnSync('systemctl', ['--user', 'status', 'fairfox-daemon.service'], {
      encoding: 'utf8',
    });
    const out = r.stdout ?? '';
    const activeMatch = out.match(/Active: (\S+)/);
    const pidMatch = out.match(/Main PID: (\d+)/);
    process.stdout.write(`state:     ${activeMatch?.[1] ?? 'unknown'}\n`);
    process.stdout.write(`pid:       ${pidMatch?.[1] ?? '-'}\n`);
    return Promise.resolve(0);
  }
  return Promise.resolve(0);
}

function daemonReload(): Promise<number> {
  // Phase 1 has no on-disk config; reload is a no-op placeholder so
  // the verb exists from day one and future phases can wire SIGHUP
  // handling without breaking callers.
  process.stdout.write('fairfox daemon reload: no-op in Phase 1 (no config yet).\n');
  return Promise.resolve(0);
}

export function daemon(rest: readonly string[]): Promise<number> {
  const [verb, ...args] = rest;
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    usage(verb ? process.stdout : process.stderr);
    return Promise.resolve(verb ? 0 : 1);
  }
  if (verb === 'install') {
    return daemonInstall();
  }
  if (verb === 'uninstall') {
    return daemonUninstall();
  }
  if (verb === 'start') {
    return daemonStart(args);
  }
  if (verb === 'stop') {
    return daemonStop();
  }
  if (verb === 'status') {
    return daemonStatus();
  }
  if (verb === 'reload') {
    return daemonReload();
  }
  if (verb === 'hook') {
    const kind = args[0];
    if (!kind) {
      process.stderr.write('fairfox daemon hook: missing kind argument.\n');
      return Promise.resolve(1);
    }
    return daemonHook(kind);
  }
  process.stderr.write(`fairfox daemon: unknown verb "${verb}".\n\n`);
  usage();
  return Promise.resolve(1);
}
