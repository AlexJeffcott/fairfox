/**
 * What devctl reads from fly.toml: the settings Fly gives the server, and
 * the port it reaches it on. `devctl image` and `devctl replica` start the
 * container with these, so they run the image the way Fly runs it. Pure:
 * the text of the file is the argument.
 */
export type FlyConfig = {
  /** `[env]`: every value is a string, as an environment holds it. */
  env: Readonly<Record<string, string>>;
  /** `http_service.internal_port`. */
  internalPort: number;
};

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`fly.toml has no ${what} table`);
  }
  return Object.fromEntries(Object.entries(value));
}

export function readFlyConfig(text: string): FlyConfig {
  const parsed = record(Bun.TOML.parse(text), 'top-level');
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(record(parsed.env, '[env]'))) {
    if (typeof value !== 'string') {
      throw new Error(`fly.toml [env] ${name} is not a string: Fly gives the server strings`);
    }
    env[name] = value;
  }
  const port: unknown = record(parsed.http_service, '[http_service]').internal_port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`fly.toml http_service.internal_port is not a port: ${JSON.stringify(port)}`);
  }
  if (env.FAIRFOX_PORT !== String(port)) {
    throw new Error(`fly.toml [env] FAIRFOX_PORT is ${JSON.stringify(env.FAIRFOX_PORT)} and internal_port is ${port}: Fly reaches the server on one port`);
  }
  return { env, internalPort: port };
}
