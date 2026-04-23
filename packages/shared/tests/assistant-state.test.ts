// Unit tests for the pure helpers in packages/shared/src/assistant-state.ts.
// Brand validators, pricing/cost computation, tool translation —
// testable without a mesh or any daemon state.

import { describe, expect, test } from 'bun:test';
import {
  ALL_ALLOWED_TOOLS,
  computeCostUsd,
  parseModelId,
  pricingFor,
  toAbsolutePath,
  toSdkAllowed,
  toSessionId,
} from '#src/assistant-state.ts';

describe('toAbsolutePath', () => {
  test('accepts rooted paths', () => {
    expect(toAbsolutePath('/Users/AJT/projects')).toBe(toAbsolutePath('/Users/AJT/projects'));
  });

  test('rejects relative paths', () => {
    expect(() => toAbsolutePath('projects/fairfox')).toThrow('AbsolutePath expects a rooted path');
  });

  test('rejects empty string', () => {
    expect(() => toAbsolutePath('')).toThrow();
  });
});

describe('toSessionId', () => {
  test('accepts ids in 8–128 char range', () => {
    expect(toSessionId('abcd1234')).toBe(toSessionId('abcd1234'));
    expect(toSessionId('a'.repeat(64))).toBe(toSessionId('a'.repeat(64)));
  });

  test('rejects too-short ids', () => {
    expect(() => toSessionId('short')).toThrow('out of range');
  });

  test('rejects too-long ids', () => {
    expect(() => toSessionId('a'.repeat(129))).toThrow('out of range');
  });
});

describe('parseModelId', () => {
  test('accepts canonical claude model ids', () => {
    // Compare as strings — the brand is erased at runtime.
    const s = (id: ReturnType<typeof parseModelId>): string => `${id}`;
    expect(s(parseModelId('claude-sonnet-4-6'))).toBe('claude-sonnet-4-6');
    expect(s(parseModelId('claude-opus-4-7'))).toBe('claude-opus-4-7');
    expect(s(parseModelId('claude-haiku-4-5'))).toBe('claude-haiku-4-5');
  });

  test('rejects non-claude ids', () => {
    expect(() => parseModelId('gpt-4')).toThrow('Not a claude model id');
    expect(() => parseModelId('')).toThrow();
  });

  test('is case sensitive (lowercase only)', () => {
    expect(() => parseModelId('Claude-Sonnet-4-6')).toThrow();
  });
});

describe('toSdkAllowed', () => {
  test('translates every canonical tool to SDK capitalisation', () => {
    const all = toSdkAllowed(ALL_ALLOWED_TOOLS);
    expect(all).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
  });

  test('preserves ordering of the input list', () => {
    expect(toSdkAllowed(['bash', 'read'])).toEqual(['Bash', 'Read']);
  });

  test('empty list round-trips', () => {
    expect(toSdkAllowed([])).toEqual([]);
  });
});

describe('pricingFor', () => {
  test('returns per-model pricing for known ids', () => {
    const opus = pricingFor(parseModelId('claude-opus-4-7'));
    expect(opus.inputPerMTok).toBeGreaterThan(0);
    expect(opus.outputPerMTok).toBeGreaterThan(opus.inputPerMTok);
  });

  test('falls back to Sonnet-ish pricing for unknown models', () => {
    const future = pricingFor(parseModelId('claude-sonnet-5-0'));
    const sonnet = pricingFor(parseModelId('claude-sonnet-4-6'));
    expect(future).toEqual(sonnet);
  });
});

describe('computeCostUsd', () => {
  test('returns 0 when model is absent', () => {
    expect(computeCostUsd({})).toBe(0);
  });

  test('computes cost from tokens × per-million rate', () => {
    // Sonnet: $3 input + $15 output per MTok. 1M + 1M tokens → $18.
    const cost = computeCostUsd({
      model: parseModelId('claude-sonnet-4-6'),
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(18);
  });

  test('includes cached input tokens at a discounted rate', () => {
    // Sonnet cached input: $0.30/MTok. 1M cached + 0 fresh = $0.30.
    const cost = computeCostUsd({
      model: parseModelId('claude-sonnet-4-6'),
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    });
    expect(cost).toBe(0.3);
  });

  test('rounds to 4 decimal places', () => {
    const cost = computeCostUsd({
      model: parseModelId('claude-haiku-4-5'),
      inputTokens: 1,
      outputTokens: 1,
    });
    // 1/1M * $0.80 + 1/1M * $4 = $0.0000048 → rounds to 0.
    expect(cost).toBe(0);
  });
});
