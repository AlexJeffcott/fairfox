import { childEnv } from './proc.ts';

/**
 * Run one command in `cwd` with its output going straight to devctl's own, so
 * a long run shows its progress. Returns the exit code; a process killed by a
 * signal counts as 1.
 */
export async function stream(argv: readonly string[], cwd: string): Promise<number> {
  const proc = Bun.spawn([...argv], { cwd, env: childEnv(), stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  return proc.signalCode === null ? code : 1;
}

/** Run each command in turn, and stop at the first that fails. Returns its exit code, or 0. */
export async function streamEach(steps: readonly (readonly string[])[], cwd: string): Promise<number> {
  for (const step of steps) {
    const code = await stream(step, cwd);
    if (code !== 0) {
      console.error(`\nFailed (exit ${code}): ${step.join(' ')}`);
      return code;
    }
  }
  return 0;
}
