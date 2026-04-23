// Hand-rolled guards for external → typed parse boundaries:
//   - the daemon's config file at ~/.fairfox/daemon/config.json
//   - CC hook stdin payloads (Phase 3)
//   - env-provided model id
//
// No zod: the fairfox tree doesn't carry it and the shared package
// must stay dependency-light. The guard pattern mirrors
// `packages/cli/src/user-identity-node.ts`: JSON.parse → unknown →
// narrowing → throw-on-bad.

import type {
  AllowedTool,
  ApiKeyRef,
  AssistantConfig,
  ModelRule,
  Scope,
  SessionAnnouncement,
} from './assistant-state.ts';
import { ALL_ALLOWED_TOOLS, parseModelId, toAbsolutePath } from './assistant-state.ts';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isAllowedTool(v: unknown): v is AllowedTool {
  return typeof v === 'string' && (ALL_ALLOWED_TOOLS as readonly string[]).includes(v);
}

function parseApiKeyRef(v: unknown): ApiKeyRef {
  if (!isRecord(v)) {
    throw new Error('apiKey: expected object');
  }
  if (v.source === 'env' && typeof v.name === 'string') {
    return { source: 'env', name: v.name };
  }
  if (v.source === 'keychain' && typeof v.account === 'string' && typeof v.service === 'string') {
    return { source: 'keychain', account: v.account, service: v.service };
  }
  if (v.source === 'file' && typeof v.path === 'string') {
    return { source: 'file', path: toAbsolutePath(v.path) };
  }
  throw new Error(`apiKey: unrecognised source ${JSON.stringify(v.source)}`);
}

function parseScope(v: unknown): Scope {
  if (!isRecord(v)) {
    throw new Error('scope: expected object');
  }
  if (typeof v.cwd !== 'string') {
    throw new Error('scope.cwd: expected string');
  }
  const wl = Array.isArray(v.filesystemWhitelist) ? v.filesystemWhitelist : [];
  const at = Array.isArray(v.allowedTools) ? v.allowedTools : [];
  const paths: string[] = [];
  for (const p of wl) {
    if (typeof p !== 'string') {
      throw new Error('scope.filesystemWhitelist: non-string entry');
    }
    paths.push(p);
  }
  const tools: AllowedTool[] = [];
  for (const t of at) {
    if (!isAllowedTool(t)) {
      throw new Error(`scope.allowedTools: bad entry ${String(t)}`);
    }
    tools.push(t);
  }
  return {
    cwd: toAbsolutePath(v.cwd),
    filesystemWhitelist: paths.map(toAbsolutePath),
    allowedTools: tools,
  };
}

function parseModelRules(v: unknown): readonly ModelRule[] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: ModelRule[] = [];
  for (const r of v) {
    if (!isRecord(r)) {
      continue;
    }
    if (typeof r.model !== 'string') {
      continue;
    }
    const model = parseModelId(r.model);
    if (r.kind === 'default') {
      out.push({ kind: 'default', model });
      continue;
    }
    if (
      (r.kind === 'contains' || r.kind === 'startsWith' || r.kind === 'tool') &&
      typeof r.value === 'string'
    ) {
      out.push({ kind: r.kind, value: r.value, model });
      continue;
    }
    if (r.kind === 'lenGt' && typeof r.n === 'number') {
      out.push({ kind: 'lenGt', n: r.n, model });
    }
  }
  return out;
}

function parseScopeOverride(v: unknown): {
  readonly cwd?: import('./assistant-state.ts').AbsolutePath;
  readonly filesystemWhitelist?: readonly import('./assistant-state.ts').AbsolutePath[];
  readonly allowedTools?: readonly AllowedTool[];
} {
  if (!isRecord(v)) {
    return {};
  }
  const out: {
    cwd?: import('./assistant-state.ts').AbsolutePath;
    filesystemWhitelist?: readonly import('./assistant-state.ts').AbsolutePath[];
    allowedTools?: readonly AllowedTool[];
  } = {};
  if (typeof v.cwd === 'string') {
    out.cwd = toAbsolutePath(v.cwd);
  }
  if (Array.isArray(v.filesystemWhitelist)) {
    const paths: string[] = [];
    for (const p of v.filesystemWhitelist) {
      if (typeof p === 'string') {
        paths.push(p);
      }
    }
    out.filesystemWhitelist = paths.map(toAbsolutePath);
  }
  if (Array.isArray(v.allowedTools)) {
    const tools: AllowedTool[] = [];
    for (const t of v.allowedTools) {
      if (isAllowedTool(t)) {
        tools.push(t);
      }
    }
    out.allowedTools = tools;
  }
  return out;
}

export function parseAssistantConfig(raw: unknown): AssistantConfig {
  if (!isRecord(raw)) {
    throw new Error('AssistantConfig: expected object');
  }
  if (typeof raw.defaultModel !== 'string') {
    throw new Error('AssistantConfig.defaultModel: required string');
  }
  const overridesRaw = isRecord(raw.scopeOverrides) ? raw.scopeOverrides : {};
  const overrides: Record<string, ReturnType<typeof parseScopeOverride>> = {};
  for (const [k, v] of Object.entries(overridesRaw)) {
    overrides[k] = parseScopeOverride(v);
  }
  const cap = typeof raw.monthlyCostCapUsd === 'number' ? raw.monthlyCostCapUsd : undefined;
  return {
    apiKey: parseApiKeyRef(raw.apiKey),
    scope: parseScope(raw.scope),
    defaultModel: parseModelId(raw.defaultModel),
    modelRules: parseModelRules(raw.modelRules),
    ...(cap === undefined ? {} : { monthlyCostCapUsd: cap }),
    scopeOverrides: overrides,
  };
}

export function parseSessionAnnouncement(raw: unknown): SessionAnnouncement {
  if (!isRecord(raw)) {
    throw new Error('SessionAnnouncement: expected object');
  }
  const { sessionId, deviceId, cwd, transcriptPath, state, updatedAt } = raw;
  if (
    typeof sessionId !== 'string' ||
    typeof deviceId !== 'string' ||
    typeof cwd !== 'string' ||
    typeof transcriptPath !== 'string' ||
    typeof state !== 'string' ||
    typeof updatedAt !== 'string'
  ) {
    throw new Error('SessionAnnouncement: missing required field');
  }
  const validStates: readonly string[] = [
    'started',
    'prompt-submit',
    'pre-tool',
    'post-tool',
    'stopped',
  ];
  if (!validStates.includes(state)) {
    throw new Error(`SessionAnnouncement.state: unrecognised "${state}"`);
  }
  const out: SessionAnnouncement = {
    sessionId: sessionId as SessionAnnouncement['sessionId'],
    deviceId,
    cwd: toAbsolutePath(cwd),
    transcriptPath: toAbsolutePath(transcriptPath),
    state: state as SessionAnnouncement['state'],
    updatedAt,
    ...(typeof raw.lastToolName === 'string' ? { lastToolName: raw.lastToolName } : {}),
    ...(typeof raw.lastPromptPreview === 'string'
      ? { lastPromptPreview: raw.lastPromptPreview }
      : {}),
    ...(raw.stale === true ? { stale: true } : {}),
  };
  return out;
}
