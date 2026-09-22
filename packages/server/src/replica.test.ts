import { describe, expect, test } from 'bun:test';
import { MAX_REPLICA_AGE_SECONDS, replicaAgeSeconds, replicaVerdict } from './replica.ts';

const now = new Date('2026-09-22T20:00:00Z');

/** A listing as litestream ltx -json prints it, one entry per time. */
function listing(...timestamps: string[]): string {
  return JSON.stringify(
    timestamps.map((timestamp, i) => ({
      level: i,
      min_txid: '0000000000000001',
      max_txid: '0000000000000002',
      size: 739,
      timestamp,
    })),
  );
}

describe('the age of the replica', () => {
  test('is the seconds since its newest write, whatever the order of the listing', () => {
    expect(replicaAgeSeconds(listing('2026-09-22T19:00:00Z', '2026-09-22T19:59:48Z', '2026-09-22T19:30:00Z'), now)).toBe(12);
  });

  test('is rounded to whole seconds', () => {
    expect(replicaAgeSeconds(listing('2026-09-22T19:59:58.400Z'), now)).toBe(2);
  });

  test('a write after now is age 0, not negative', () => {
    expect(replicaAgeSeconds(listing('2026-09-22T20:00:03Z'), now)).toBe(0);
  });

  test('an empty replica has no age', () => {
    expect(replicaAgeSeconds('[]\n', now)).toBeUndefined();
  });

  test('a listing that is not a list is refused', () => {
    expect(() => replicaAgeSeconds('{"error":"x"}', now)).toThrow('litestream ltx did not print a list: {"error":"x"}');
  });

  test('an entry with no timestamp is refused', () => {
    expect(() => replicaAgeSeconds('[{"level":0}]', now)).toThrow('An LTX entry has no timestamp: {"level":0}');
  });

  test('an entry whose timestamp is not a time is refused', () => {
    expect(() => replicaAgeSeconds(listing('yesterday'), now)).toThrow('An LTX entry has a timestamp that is not a time: "yesterday"');
  });
});

describe('the verdict on the replica', () => {
  test('one hour is the limit', () => {
    expect(MAX_REPLICA_AGE_SECONDS).toBe(3600);
  });

  test('a fresh replica passes', () => {
    expect(replicaVerdict(12, 3600)).toBeNull();
  });

  test('a replica at the limit passes', () => {
    expect(replicaVerdict(3600, 3600)).toBeNull();
  });

  test('a replica over the limit fails, and the message says by how much', () => {
    expect(replicaVerdict(3601, 3600)).toBe('The replica is 3601 s old, older than 3600 s.');
  });

  test('a replica that holds nothing fails', () => {
    expect(replicaVerdict(undefined, 3600)).toBe('The replica holds nothing: Litestream has not written to it.');
  });
});
