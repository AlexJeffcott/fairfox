// The runner's own test. Its features live in a directory made for the test,
// so that no runner reads them as requirements.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plan, readFeatures } from './gherkin.ts';

const dir = mkdtempSync(join(tmpdir(), 'fairfox-features-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function feature(file: string, tag: string, scenario: string): void {
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), `${tag}\nFeature: ${file}\n\n  Scenario: ${scenario}\n    Given a step\n`);
}

feature('top.feature', '@local', 'at the top');
feature('phone/calls/deep.feature', '@local', 'two levels down');
feature('phone/shouted.feature', '@Local', 'tagged @Local');
feature('shell.feature', '@browser', 'in a browser');

describe('the feature runner', () => {
  test('reads .feature files at every depth', () => {
    expect(readFeatures(dir).map((f) => f.file)).toEqual([
      'phone/calls/deep.feature',
      'phone/shouted.feature',
      'shell.feature',
      'top.feature',
    ]);
  });

  test('runs the scenarios with the tag, at every depth', () => {
    const { run } = plan(readFeatures(dir), '@local');
    expect(run.flatMap(({ pickles }) => pickles.map((p) => p.name))).toEqual(['two levels down', 'at the top']);
  });

  test('a scenario tagged @Local runs nowhere, and is named', () => {
    expect(plan(readFeatures(dir), '@local').nowhere).toEqual(['phone/shouted.feature: tagged @Local']);
  });
});
