// Install-side helpers for `fairfox daemon install`.
//
// Writes per-user service files that run `fairfox daemon start
// --foreground` at login:
//
//   - macOS: ~/Library/LaunchAgents/com.fairfox.daemon.plist
//            loaded via `launchctl bootstrap gui/$UID <plist>`.
//   - Linux: ~/.config/systemd/user/fairfox-daemon.service
//            enabled via `systemctl --user enable --now fairfox-daemon`.
//
// No per-user root/admin dance: both paths live under $HOME and the
// launcher runs as the same user. The API key is NOT baked into the
// unit file — the daemon reads it from Keychain / env / a 0600 file
// at start time (Phase 2+). Phase 1 just keeps the mesh open.

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fairfoxPath } from '#src/paths.ts';

export const LAUNCH_AGENT_LABEL = 'com.fairfox.daemon';
// LaunchAgents and systemd unit paths are intentionally NOT
// FAIRFOX_HOME-aware. Those are OS-level service-supervisor paths;
// macOS launchd and systemd-user pin to one location per user
// account. A namespaced fairfox install can still run a daemon by
// invoking `fairfox daemon start --foreground` directly with
// FAIRFOX_HOME set; the supervisor unit isn't part of that path.
export const LAUNCH_AGENT_PATH = join(
  homedir(),
  'Library',
  'LaunchAgents',
  `${LAUNCH_AGENT_LABEL}.plist`
);
export const SYSTEMD_UNIT_PATH = join(
  homedir(),
  '.config',
  'systemd',
  'user',
  'fairfox-daemon.service'
);
// Daemon state (logs, runtime files) is fairfox-specific and DOES
// follow FAIRFOX_HOME so a namespaced install gets its own log
// stream rather than racing with the canonical install.
export const DAEMON_DIR = fairfoxPath('daemon');
export const DAEMON_LOG_DIR = join(DAEMON_DIR, 'log');
export const DAEMON_STDOUT = join(DAEMON_LOG_DIR, 'stdout.log');
export const DAEMON_STDERR = join(DAEMON_LOG_DIR, 'stderr.log');

export type Os = 'darwin' | 'linux' | 'other';

export function currentOs(): Os {
  const p = platform();
  if (p === 'darwin') {
    return 'darwin';
  }
  if (p === 'linux') {
    return 'linux';
  }
  return 'other';
}

/** Resolve the absolute path to the `fairfox` wrapper the installer
 * dropped at `$HOME/.local/bin/fairfox`. launchd / systemd need an
 * absolute path — `PATH` lookups are unreliable in service contexts. */
export function fairfoxBinPath(): string {
  return join(homedir(), '.local', 'bin', 'fairfox');
}

export interface PlistEnv {
  readonly PATH: string;
  readonly FAIRFOX_DAEMON_MANAGED: '1';
}

export function defaultPlistEnv(): PlistEnv {
  return {
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    FAIRFOX_DAEMON_MANAGED: '1',
  };
}

export function renderPlist(binPath: string, env: PlistEnv): string {
  const entries = Object.entries(env)
    .map(([k, v]) => `    <key>${k}</key><string>${v}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binPath}</string>
    <string>daemon</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${DAEMON_STDOUT}</string>
  <key>StandardErrorPath</key><string>${DAEMON_STDERR}</string>
  <key>EnvironmentVariables</key>
  <dict>
${entries}
  </dict>
</dict>
</plist>
`;
}

export function renderSystemdUnit(binPath: string): string {
  return `[Unit]
Description=fairfox daemon
After=network-online.target

[Service]
ExecStart=${binPath} daemon start --foreground
Restart=always
RestartSec=5
Environment=FAIRFOX_DAEMON_MANAGED=1
StandardOutput=append:${DAEMON_STDOUT}
StandardError=append:${DAEMON_STDERR}

[Install]
WantedBy=default.target
`;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export interface WriteResult {
  readonly unitPath: string;
  readonly next: readonly string[];
}

export function writeLaunchAgent(binPath: string): WriteResult {
  ensureDir(DAEMON_LOG_DIR);
  ensureDir(dirname(LAUNCH_AGENT_PATH));
  writeFileSync(LAUNCH_AGENT_PATH, renderPlist(binPath, defaultPlistEnv()), { mode: 0o644 });
  return {
    unitPath: LAUNCH_AGENT_PATH,
    next: [
      `launchctl bootstrap gui/$(id -u) ${LAUNCH_AGENT_PATH}`,
      `launchctl kickstart -k gui/$(id -u)/${LAUNCH_AGENT_LABEL}`,
    ],
  };
}

export function writeSystemdUnit(binPath: string): WriteResult {
  ensureDir(DAEMON_LOG_DIR);
  ensureDir(dirname(SYSTEMD_UNIT_PATH));
  writeFileSync(SYSTEMD_UNIT_PATH, renderSystemdUnit(binPath), { mode: 0o644 });
  return {
    unitPath: SYSTEMD_UNIT_PATH,
    next: [
      'systemctl --user daemon-reload',
      'systemctl --user enable --now fairfox-daemon.service',
    ],
  };
}

/** Remove the launch unit file only. Log files + daemon state under
 * ~/.fairfox/daemon/ are left alone — user can `rm -rf` if they want
 * to wipe history. Exit code 0 even when not installed, because
 * uninstall is idempotent. */
export function removeUnitFile(os: Os): { removed: boolean; path: string } {
  const path = os === 'darwin' ? LAUNCH_AGENT_PATH : SYSTEMD_UNIT_PATH;
  if (!existsSync(path)) {
    return { removed: false, path };
  }
  unlinkSync(path);
  return { removed: true, path };
}

/** Render the "hooks" block users paste into ~/.claude/settings.json
 * to bridge a Claude Code session into fairfox's sessions:active
 * mesh doc. Kept as a pasteable snippet rather than auto-edited: the
 * user's settings.json likely carries unrelated hooks (e.g. peon-ping)
 * and the safest merge is the one the user does themselves. */
export function renderCcHookSnippet(binPath: string): string {
  const cmd = (kind: string): string => `${binPath} daemon hook ${kind}`;
  return `${JSON.stringify(
    {
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: cmd('session-start'), timeout: 5 }] },
        ],
        UserPromptSubmit: [
          { matcher: '', hooks: [{ type: 'command', command: cmd('prompt-submit'), timeout: 3 }] },
        ],
        PreToolUse: [
          { matcher: '*', hooks: [{ type: 'command', command: cmd('pre-tool'), timeout: 3 }] },
        ],
        PostToolUse: [
          { matcher: '*', hooks: [{ type: 'command', command: cmd('post-tool'), timeout: 3 }] },
        ],
        Stop: [
          { matcher: '', hooks: [{ type: 'command', command: cmd('session-stop'), timeout: 3 }] },
        ],
      },
    },
    null,
    2
  )}\n`;
}
