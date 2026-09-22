// The @local scenarios of every .feature file in features/, under bun test.
import { join } from 'node:path';
import { runFeatures } from './gherkin.ts';
import { dispose, newWorld, steps } from './version.steps.ts';

runFeatures({ dir: join(import.meta.dir, '..'), tag: '@local', steps, newWorld, dispose });
