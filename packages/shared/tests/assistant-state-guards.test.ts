// Parse-boundary guards for the daemon config file and CC hook
// stdin payloads. Pure functions — no filesystem, no mesh, no SDK.

import { describe, expect, test } from 'bun:test';
import { parseAssistantConfig, parseSessionAnnouncement } from '#src/assistant-state-guards.ts';

const VALID_CONFIG = {
  apiKey: { source: 'env', name: 'ANTHROPIC_API_KEY' },
  scope: {
    cwd: '/Users/AJT/projects',
    filesystemWhitelist: ['/Users/AJT/projects'],
    allowedTools: ['read', 'grep'],
  },
  defaultModel: 'claude-sonnet-4-6',
  modelRules: [{ kind: 'default', model: 'claude-sonnet-4-6' }],
  scopeOverrides: {},
};

describe('parseAssistantConfig', () => {
  test('round-trips a valid config', () => {
    const parsed = parseAssistantConfig(VALID_CONFIG);
    expect(`${parsed.defaultModel}`).toBe('claude-sonnet-4-6');
    expect(`${parsed.scope.cwd}`).toBe('/Users/AJT/projects');
    expect(parsed.scope.allowedTools).toEqual(['read', 'grep']);
    expect(parsed.modelRules).toHaveLength(1);
    expect(parsed.monthlyCostCapUsd).toBeUndefined();
  });

  test('rejects missing defaultModel', () => {
    const bad = { ...VALID_CONFIG, defaultModel: undefined };
    expect(() => parseAssistantConfig(bad)).toThrow('defaultModel: required');
  });

  test('rejects non-claude model ids in defaultModel', () => {
    const bad = { ...VALID_CONFIG, defaultModel: 'gpt-4' };
    expect(() => parseAssistantConfig(bad)).toThrow('Not a claude model id');
  });

  test('rejects bad cwd (relative path)', () => {
    const bad = { ...VALID_CONFIG, scope: { ...VALID_CONFIG.scope, cwd: 'projects' } };
    expect(() => parseAssistantConfig(bad)).toThrow('AbsolutePath expects a rooted path');
  });

  test('rejects unknown tool names', () => {
    const bad = {
      ...VALID_CONFIG,
      scope: { ...VALID_CONFIG.scope, allowedTools: ['bash', 'teleport'] },
    };
    expect(() => parseAssistantConfig(bad)).toThrow('allowedTools: bad entry');
  });

  test('drops malformed rule entries silently', () => {
    const noisy = {
      ...VALID_CONFIG,
      modelRules: [
        { kind: 'default', model: 'claude-sonnet-4-6' },
        { kind: 'contains', value: 42, model: 'claude-sonnet-4-6' }, // bad value type
        { kind: 'lenGt', n: 500, model: 'claude-opus-4-7' },
      ],
    };
    const parsed = parseAssistantConfig(noisy);
    expect(parsed.modelRules).toHaveLength(2);
    expect(parsed.modelRules[0]?.kind).toBe('default');
    expect(parsed.modelRules[1]?.kind).toBe('lenGt');
  });

  test('preserves monthlyCostCapUsd when set', () => {
    const withCap = { ...VALID_CONFIG, monthlyCostCapUsd: 25 };
    const parsed = parseAssistantConfig(withCap);
    expect(parsed.monthlyCostCapUsd).toBe(25);
  });

  test('rejects non-record input', () => {
    expect(() => parseAssistantConfig(null)).toThrow('expected object');
    expect(() => parseAssistantConfig('config')).toThrow('expected object');
  });

  test('rejects apiKey with no recognised source', () => {
    const bad = { ...VALID_CONFIG, apiKey: { source: 'magic', key: 'oops' } };
    expect(() => parseAssistantConfig(bad)).toThrow('unrecognised source');
  });

  test('parses the three apiKey variants', () => {
    const env = parseAssistantConfig(VALID_CONFIG);
    expect(env.apiKey.source).toBe('env');

    const keychain = parseAssistantConfig({
      ...VALID_CONFIG,
      apiKey: { source: 'keychain', account: 'AJT', service: 'fairfox-daemon' },
    });
    expect(keychain.apiKey.source).toBe('keychain');

    const file = parseAssistantConfig({
      ...VALID_CONFIG,
      apiKey: { source: 'file', path: '/Users/AJT/.fairfox/api-key' },
    });
    expect(file.apiKey.source).toBe('file');
  });
});

describe('parseSessionAnnouncement', () => {
  const VALID_ANNOUNCE = {
    sessionId: 'abc12345-session',
    deviceId: 'laptop',
    cwd: '/Users/AJT/projects/fairfox',
    transcriptPath: '/Users/AJT/.claude/projects/foo.jsonl',
    state: 'started',
    updatedAt: '2026-04-23T12:00:00Z',
  };

  test('parses a minimal valid announcement', () => {
    const parsed = parseSessionAnnouncement(VALID_ANNOUNCE);
    expect(`${parsed.sessionId}`).toBe('abc12345-session');
    expect(parsed.state).toBe('started');
    expect(parsed.stale).toBeUndefined();
  });

  test('preserves optional fields', () => {
    const full = {
      ...VALID_ANNOUNCE,
      state: 'prompt-submit',
      lastToolName: 'Read',
      lastPromptPreview: 'what time is it',
      stale: true,
    };
    const parsed = parseSessionAnnouncement(full);
    expect(parsed.lastToolName).toBe('Read');
    expect(parsed.lastPromptPreview).toBe('what time is it');
    expect(parsed.stale).toBe(true);
  });

  test('rejects unknown state', () => {
    const bad = { ...VALID_ANNOUNCE, state: 'rebooting' };
    expect(() => parseSessionAnnouncement(bad)).toThrow('unrecognised');
  });

  test('rejects missing required field', () => {
    const { sessionId, ...rest } = VALID_ANNOUNCE;
    void sessionId;
    expect(() => parseSessionAnnouncement(rest)).toThrow('missing required');
  });

  test('rejects relative cwd', () => {
    const bad = { ...VALID_ANNOUNCE, cwd: 'projects' };
    expect(() => parseSessionAnnouncement(bad)).toThrow('AbsolutePath expects a rooted path');
  });
});
