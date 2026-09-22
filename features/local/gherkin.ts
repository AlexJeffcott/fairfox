/**
 * Runs `.feature` files under `bun test` (M1). Cucumber's own parser reads
 * each file and compiles it to pickles: one per scenario, with the feature's
 * tags on each. Only the pickles with the given tag run here; a `@browser`
 * or `@live` scenario in the same directory is left to its own runner.
 *
 * Each pickle is one Bun test, named after its scenario. Its steps run in
 * order, each against the one step definition whose pattern matches the
 * whole of its text. A step that no definition matches, or that two match,
 * fails the scenario: a step is never reworded to fit and never skipped.
 */
import { describe, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AstBuilder, compile, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { type GherkinDocument, IdGenerator, type Pickle, type PickleStep, type Step } from '@cucumber/messages';

export type StepDefinition<World> = {
  /** Matched against the whole text of a step. Its groups are the step's arguments. */
  pattern: RegExp;
  run: (world: World, ...args: string[]) => void | Promise<void>;
};

export type Suite<World> = {
  /** The directory that holds the `.feature` files. */
  dir: string;
  /** The tag a scenario must carry to run here, such as `@local`. */
  tag: string;
  steps: readonly StepDefinition<World>[];
  /** A fresh world for each scenario. */
  newWorld: () => World;
  /** Runs after each scenario, passed or failed. */
  dispose: (world: World) => void | Promise<void>;
};

type Feature = {
  name: string;
  file: string;
  pickles: readonly Pickle[];
  /** The keyword each step is written with (Given, When, Then, And, But), by the id of its step in the file. */
  keywords: ReadonlyMap<string, string>;
};

function keywords(document: GherkinDocument): Map<string, string> {
  const found = new Map<string, string>();
  const add = (steps: readonly Step[] | undefined): void => {
    for (const step of steps ?? []) {
      found.set(step.id, step.keyword.trim());
    }
  };
  for (const child of document.feature?.children ?? []) {
    add(child.background?.steps);
    add(child.scenario?.steps);
    for (const inRule of child.rule?.children ?? []) {
      add(inRule.background?.steps);
      add(inRule.scenario?.steps);
    }
  }
  return found;
}

function readFeatures(dir: string): Feature[] {
  const newId = IdGenerator.uuid();
  const parser = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher());
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.feature'))
    .sort();
  return files.map((file) => {
    const document = parser.parse(readFileSync(join(dir, file), 'utf8'));
    return {
      name: document.feature?.name ?? file,
      file,
      pickles: compile(document, file, newId),
      keywords: keywords(document),
    };
  });
}

function bind<World>(steps: readonly StepDefinition<World>[], step: PickleStep): [StepDefinition<World>, string[]] {
  if (step.argument !== undefined) {
    throw new Error(`The step "${step.text}" has a doc string or a table. This runner binds neither yet.`);
  }
  const bound: [StepDefinition<World>, string[]][] = [];
  for (const definition of steps) {
    const match = definition.pattern.exec(step.text);
    if (match !== null && match.index === 0 && match[0] === step.text) {
      const args = match.slice(1).filter((group) => group !== undefined);
      if (args.length !== match.length - 1) {
        throw new Error(`The pattern ${definition.pattern} matched "${step.text}" with a group left empty.`);
      }
      bound.push([definition, args]);
    }
  }
  const [first, ...others] = bound;
  if (first === undefined) {
    throw new Error(`No step definition matches the step "${step.text}".`);
  }
  if (others.length > 0) {
    throw new Error(`${bound.length} step definitions match the step "${step.text}": ${bound.map(([d]) => d.pattern).join(', ')}`);
  }
  return first;
}

/**
 * Run one scenario. A step that fails throws its own error, with the scenario
 * and the step, as written in the file, put in front of its message:
 * `Step failed in "<scenario>": Then <step>`.
 */
async function runPickle<World>(suite: Suite<World>, feature: Feature, pickle: Pickle): Promise<void> {
  const world = suite.newWorld();
  try {
    for (const step of pickle.steps) {
      const keyword = feature.keywords.get(step.astNodeIds[0] ?? '') ?? '';
      const where = `Step failed in "${pickle.name}": ${keyword} ${step.text}`;
      try {
        const [definition, args] = bind(suite.steps, step);
        await definition.run(world, ...args);
      } catch (error) {
        if (error instanceof Error) {
          error.message = `${where}\n${error.message}`;
          throw error;
        }
        throw new Error(`${where}\n${String(error)}`);
      }
    }
  } finally {
    await suite.dispose(world);
  }
}

/** Register one Bun test for each scenario with the suite's tag. Fails when there is none. */
export function runFeatures<World>(suite: Suite<World>): void {
  let count = 0;
  for (const feature of readFeatures(suite.dir)) {
    const pickles = feature.pickles.filter((pickle) => pickle.tags.some((tag) => tag.name === suite.tag));
    if (pickles.length === 0) {
      continue;
    }
    count += pickles.length;
    describe(feature.name, () => {
      for (const pickle of pickles) {
        test(pickle.name, () => runPickle(suite, feature, pickle));
      }
    });
  }
  if (count === 0) {
    test(`scenarios tagged ${suite.tag}`, () => {
      throw new Error(`No scenario in ${suite.dir} is tagged ${suite.tag}.`);
    });
  }
}
