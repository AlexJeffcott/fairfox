import { childEnv, run } from './proc.ts';

/**
 * A container started from the production image, attached: what it prints
 * is read as it comes, so a wait is on a line it prints, never on a timer.
 * The deadline is a limit, not a wait: a promise rejected when the line does
 * not come.
 */
export type Container = {
  name: string;
  /** Everything the container has printed so far, stdout and stderr. */
  output: () => string;
  /** Resolves once every pattern has appeared, in any order. Rejects when the container exits first, or at the deadline. */
  waitFor: (patterns: readonly string[], deadlineMs: number) => Promise<void>;
  /** The host port mapped to `port` in the container. */
  hostPort: (port: number) => Promise<number>;
  /** Stop the container, wait for it to exit, and return what it printed. */
  stop: () => Promise<string>;
};

/** Start `docker run --name <name> <args>` attached. `args` follows `--name <name>`. */
export function startContainer(name: string, args: readonly string[], cwd: string): Container {
  const proc = Bun.spawn(['docker', 'run', '--name', name, ...args], {
    cwd,
    env: childEnv(),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let output = '';
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      output += decoder.decode(chunk, { stream: true });
      notify();
    }
  };
  const done = Promise.all([read(proc.stdout), read(proc.stderr), proc.exited]).then(() => {
    notify();
  });
  const exited = () => proc.exitCode !== null || proc.signalCode !== null;

  return {
    name,
    output: () => output,
    waitFor: (patterns, deadlineMs) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`${patterns.map((p) => JSON.stringify(p)).join(' and ')} did not appear inside ${deadlineMs} ms`));
        }, deadlineMs);
        const check = () => {
          if (patterns.every((p) => output.includes(p))) {
            clearTimeout(timer);
            listeners.delete(check);
            resolve();
          } else if (exited()) {
            clearTimeout(timer);
            listeners.delete(check);
            reject(new Error(`the container exited (${proc.exitCode}) before ${patterns.map((p) => JSON.stringify(p)).join(' and ')} appeared`));
          }
        };
        listeners.add(check);
        check();
      }),
    hostPort: async (port) => {
      const mapped = await run(['docker', 'port', name, String(port)], cwd);
      const found = /:(\d+)\s*$/m.exec(mapped.output);
      if (mapped.code !== 0 || found?.[1] === undefined) {
        throw new Error(`docker port ${name} ${port} gave no host port:\n${mapped.output.trim()}`);
      }
      return Number(found[1]);
    },
    stop: async () => {
      await run(['docker', 'stop', name], cwd);
      await done;
      return output;
    },
  };
}

/** Remove the container if it is still there. Called whether or not the run passed. */
export async function removeContainer(name: string, cwd: string): Promise<void> {
  await run(['docker', 'rm', '--force', name], cwd);
}
