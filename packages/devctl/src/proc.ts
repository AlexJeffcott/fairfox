/**
 * The environment every child process gets: PATH and HOME from devctl's own,
 * and nothing else. A check cannot lean on a variable from the developer's
 * shell (C1, C2). A check that needs another variable names it here.
 */
export function childEnv(): Record<string, string> {
  const path = process.env.PATH;
  const home = process.env.HOME;
  if (!path || !home) {
    throw new Error('devctl needs PATH and HOME set in its own environment');
  }
  return { PATH: path, HOME: home };
}

export type Ran = {
  /** The exit code. A process killed by a signal counts as 1. */
  code: number;
  /** stdout, then stderr. */
  output: string;
  ms: number;
};

/** Run one command in `cwd`, wait for it to exit, and keep what it printed. */
export async function run(argv: readonly string[], cwd: string): Promise<Ran> {
  const started = performance.now();
  const proc = Bun.spawn([...argv], {
    cwd,
    env: childEnv(),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exited] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    code: proc.signalCode === null ? exited : 1,
    output: stdout + stderr,
    ms: Math.round(performance.now() - started),
  };
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
