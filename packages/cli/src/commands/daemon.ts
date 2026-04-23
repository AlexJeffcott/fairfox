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
import {
  currentOs,
  DAEMON_LOG_DIR,
  DAEMON_STDERR,
  DAEMON_STDOUT,
  fairfoxBinPath,
  LAUNCH_AGENT_LABEL,
  LAUNCH_AGENT_PATH,
  removeUnitFile,
  SYSTEMD_UNIT_PATH,
  writeLaunchAgent,
  writeSystemdUnit,
} from '#src/daemon-install.ts';
import { derivePeerId, flushOutgoing, keyringStorage, openMeshClient } from '#src/mesh.ts';

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
  process.stderr.write(`fairfox daemon: unknown verb "${verb}".\n\n`);
  usage();
  return Promise.resolve(1);
}
