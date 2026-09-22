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

/** The table at `key` of `parent`, or a refusal naming the table. */
function table(parent: unknown, key: string): Record<string, unknown> {
  const value: unknown = Reflect.get(Object(parent), key);
  if (!(value instanceof Object) || Array.isArray(value)) {
    throw new Error(`fly.toml has no [${key}] table`);
  }
  return Object.fromEntries(Object.entries(value));
}

export function readFlyConfig(text: string): FlyConfig {
  const parsed: unknown = Bun.TOML.parse(text);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(table(parsed, 'env'))) {
    if (typeof value !== 'string') {
      throw new Error(`fly.toml [env] ${name} is not a string: Fly gives the server strings`);
    }
    env[name] = value;
  }
  const port: unknown = table(parsed, 'http_service').internal_port;
  if (typeof port !== 'number') {
    throw new Error(`fly.toml http_service.internal_port is not a number: ${JSON.stringify(port)}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`fly.toml http_service.internal_port is not a port: ${port}`);
  }
  if (env.FAIRFOX_PORT !== String(port)) {
    throw new Error(`fly.toml [env] FAIRFOX_PORT is ${JSON.stringify(env.FAIRFOX_PORT)} and internal_port is ${port}: Fly reaches the server on one port`);
  }
  return { env, internalPort: port };
}
