// Shared types for the fairfox assistant daemon (Phase 2+).
//
// Pure types. No runtime dependency on the Agent SDK — the SDK
// import lives exclusively in `packages/cli/src/commands/daemon.ts`
// so the browser bundle (`packages/home`) never pulls the Node SDK
// into a client-side build.
//
// Mesh-resident shapes carry `[key: string]: unknown` because
// Automerge tolerates unknown keys across document versions and new
// optional fields must not break old peers reading the doc.
// Purely-local shapes stay closed.

// --- brands ------------------------------------------------------
declare const __brandAbsPath: unique symbol;
declare const __brandSessionId: unique symbol;
declare const __brandModelId: unique symbol;

export type AbsolutePath = string & { readonly [__brandAbsPath]: true };
export type SessionId = string & { readonly [__brandSessionId]: true };
export type ModelId = string & { readonly [__brandModelId]: true };

export function toAbsolutePath(p: string): AbsolutePath {
  if (!p.startsWith('/')) {
    throw new Error(`AbsolutePath expects a rooted path, got ${p}`);
  }
  return p as AbsolutePath;
}

export function toSessionId(s: string): SessionId {
  if (s.length < 8 || s.length > 128) {
    throw new Error(`SessionId length out of range: ${s.length}`);
  }
  return s as SessionId;
}

export function parseModelId(s: string): ModelId {
  if (!/^claude-[a-z0-9-]+$/.test(s)) {
    throw new Error(`Not a claude model id: ${s}`);
  }
  return s as ModelId;
}

// --- tool whitelist ---------------------------------------------
// Local closed union; translated at the SDK boundary. When the SDK
// renames or adds a tool we edit `SDK_TOOL_NAME` and the rest of the
// code keeps using our canonical names.
export type AllowedTool =
  | 'read'
  | 'write'
  | 'edit'
  | 'bash'
  | 'grep'
  | 'glob'
  | 'web-fetch'
  | 'web-search';

export const ALL_ALLOWED_TOOLS: readonly AllowedTool[] = [
  'read',
  'write',
  'edit',
  'bash',
  'grep',
  'glob',
  'web-fetch',
  'web-search',
] as const;

const SDK_TOOL_NAME: Record<AllowedTool, string> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
  grep: 'Grep',
  glob: 'Glob',
  'web-fetch': 'WebFetch',
  'web-search': 'WebSearch',
};

export function toSdkAllowed(tools: readonly AllowedTool[]): readonly string[] {
  return tools.map((t) => SDK_TOOL_NAME[t]);
}

// --- api key reference ------------------------------------------
export type ApiKeyRef =
  | { readonly source: 'env'; readonly name: string }
  | { readonly source: 'keychain'; readonly account: string; readonly service: string }
  | { readonly source: 'file'; readonly path: AbsolutePath };

// --- scope / config ---------------------------------------------
export interface Scope {
  readonly cwd: AbsolutePath;
  readonly filesystemWhitelist: readonly AbsolutePath[];
  readonly allowedTools: readonly AllowedTool[];
}

export type ScopeOverride = {
  readonly cwd?: AbsolutePath;
  readonly filesystemWhitelist?: readonly AbsolutePath[];
  readonly allowedTools?: readonly AllowedTool[];
};

export interface ModelRule {
  readonly kind: 'contains' | 'startsWith' | 'tool' | 'lenGt' | 'default';
  readonly value?: string;
  readonly n?: number;
  readonly model: ModelId;
}

export interface AssistantConfig {
  readonly apiKey: ApiKeyRef;
  readonly scope: Scope;
  readonly defaultModel: ModelId;
  readonly modelRules: readonly ModelRule[];
  readonly monthlyCostCapUsd?: number;
  readonly scopeOverrides: Readonly<Record<string, ScopeOverride>>;
}

// --- turn error / session state ---------------------------------
export type TurnError =
  | { readonly kind: 'api'; readonly status: number; readonly message: string }
  | { readonly kind: 'timeout'; readonly idleMs: number }
  | { readonly kind: 'tool'; readonly tool: string; readonly message: string }
  | { readonly kind: 'budget'; readonly message: string }
  | { readonly kind: 'daemon-restarted'; readonly message: string }
  | { readonly kind: 'no-api-key'; readonly message: string }
  | { readonly kind: 'unknown'; readonly message: string };

export type SessionState =
  | { readonly tag: 'starting'; readonly since: string }
  | { readonly tag: 'awaiting-user'; readonly since: string }
  | { readonly tag: 'responding'; readonly since: string; readonly messageId: string }
  | { readonly tag: 'idle'; readonly since: string }
  | { readonly tag: 'stopped'; readonly since: string; readonly reason: string };

// --- mesh-resident additions -----------------------------------
export interface AssistantMessageExtras {
  readonly model?: ModelId;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly costUsd?: number;
  readonly toolsUsed?: readonly string[];
  readonly durationMs?: number;
  readonly error?: TurnError;
  readonly daemonId?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface ChatExtras {
  readonly typing?: boolean;
  readonly totalCostUsd?: number;
  readonly pinnedModel?: ModelId;
  readonly scopeOverrideKey?: string;
}

// --- mesh doc ids ----------------------------------------------
export const SESSIONS_ACTIVE_DOC_ID = 'sessions:active';
export const LEADER_LEASE_DOC_ID = 'daemon:leader';

// --- leader lease / sessions:active ----------------------------
export interface LeaderLease {
  [key: string]: unknown;
  readonly deviceId: string;
  readonly daemonId: string;
  readonly expiresAt: string;
  readonly renewedAt: string;
}

export type SessionAnnouncementState =
  | 'started'
  | 'prompt-submit'
  | 'pre-tool'
  | 'post-tool'
  | 'stopped';

export interface SessionAnnouncement {
  [key: string]: unknown;
  readonly sessionId: SessionId;
  readonly deviceId: string;
  readonly cwd: AbsolutePath;
  readonly transcriptPath: AbsolutePath;
  readonly state: SessionAnnouncementState;
  readonly lastToolName?: string;
  readonly lastPromptPreview?: string;
  readonly updatedAt: string;
  readonly stale?: boolean;
}

export interface SessionsActive {
  [key: string]: unknown;
  readonly sessions: readonly SessionAnnouncement[];
}

// --- pricing (per-million-token USD) ----------------------------
// Rough numbers used for the cost estimator + rolling-cost display.
// Accurate pricing sits with Anthropic; the router only needs an
// order-of-magnitude figure to warn a user approaching a monthly
// cap.
export interface ModelPricing {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly cachedInputPerMTok: number;
}

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7': { inputPerMTok: 15, outputPerMTok: 75, cachedInputPerMTok: 1.5 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 },
  'claude-haiku-4-5': { inputPerMTok: 0.8, outputPerMTok: 4, cachedInputPerMTok: 0.08 },
};

export function pricingFor(model: ModelId): ModelPricing {
  const p = DEFAULT_PRICING[model];
  if (p) {
    return p;
  }
  // Unknown (future) model — be conservative: assume Sonnet-ish.
  return (
    DEFAULT_PRICING['claude-sonnet-4-6'] ?? {
      inputPerMTok: 3,
      outputPerMTok: 15,
      cachedInputPerMTok: 0.3,
    }
  );
}

export function computeCostUsd(
  extras: Pick<
    AssistantMessageExtras,
    'model' | 'inputTokens' | 'outputTokens' | 'cachedInputTokens'
  >
): number {
  if (!extras.model) {
    return 0;
  }
  const p = pricingFor(extras.model);
  const inp = ((extras.inputTokens ?? 0) / 1_000_000) * p.inputPerMTok;
  const out = ((extras.outputTokens ?? 0) / 1_000_000) * p.outputPerMTok;
  const cached = ((extras.cachedInputTokens ?? 0) / 1_000_000) * p.cachedInputPerMTok;
  return Math.round((inp + out + cached) * 10_000) / 10_000;
}
