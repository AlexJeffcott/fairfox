import { describe, expect, test } from 'bun:test';
import { readFlyConfig } from './fly-config.ts';

const toml = `
app = "fairfox"

[env]
  FAIRFOX_PORT = "3000"
  FAIRFOX_DATABASE_PATH = "/data/fairfox.db"

[http_service]
  internal_port = 3000
`;

describe('reading fly.toml', () => {
  test('the env and the internal port are read', () => {
    expect(readFlyConfig(toml)).toStrictEqual({
      env: { FAIRFOX_PORT: '3000', FAIRFOX_DATABASE_PATH: '/data/fairfox.db' },
      internalPort: 3000,
    });
  });

  test('a file with no [env] is refused', () => {
    expect(() => readFlyConfig('[http_service]\ninternal_port = 3000\n')).toThrow('fly.toml has no [env] table');
  });

  test('an [[env]] array is not the [env] table', () => {
    expect(() => readFlyConfig('[[env]]\nFAIRFOX_PORT = "3000"\n[http_service]\ninternal_port = 3000\n')).toThrow(
      'fly.toml has no [env] table',
    );
  });

  test('a file with no [http_service] is refused', () => {
    expect(() => readFlyConfig('[env]\nFAIRFOX_PORT = "3000"\n')).toThrow('fly.toml has no [http_service] table');
  });

  test('an empty file is refused', () => {
    expect(() => readFlyConfig('')).toThrow('fly.toml has no [env] table');
  });

  test('an env value that is not a string is refused', () => {
    expect(() => readFlyConfig(toml.replace('"3000"', '3000'))).toThrow('fly.toml [env] FAIRFOX_PORT is not a string');
  });

  test.each(['"3000"', 'true'])('an internal port of %s is not a number', (port) => {
    expect(() => readFlyConfig(toml.replace('internal_port = 3000', `internal_port = ${port}`))).toThrow(
      `fly.toml http_service.internal_port is not a number: ${port}`,
    );
  });

  test.each(['0', '65536', '3000.5'])('an internal port of %s is not a port', (port) => {
    expect(() => readFlyConfig(toml.replace('internal_port = 3000', `internal_port = ${port}`))).toThrow(
      `fly.toml http_service.internal_port is not a port: ${port}`,
    );
  });

  test.each(['1', '65535'])('an internal port of %s is a port', (port) => {
    expect(readFlyConfig(toml.replace('internal_port = 3000', `internal_port = ${port}`).replace('"3000"', `"${port}"`)).internalPort).toBe(
      Number(port),
    );
  });

  test('an env port that differs from the internal port is refused', () => {
    expect(() => readFlyConfig(toml.replace('FAIRFOX_PORT = "3000"', 'FAIRFOX_PORT = "3001"'))).toThrow(
      'fly.toml [env] FAIRFOX_PORT is "3001" and internal_port is 3000: Fly reaches the server on one port',
    );
  });

  test('a missing env port is refused', () => {
    expect(() => readFlyConfig(toml.replace('FAIRFOX_PORT = "3000"\n', ''))).toThrow(
      'fly.toml [env] FAIRFOX_PORT is undefined and internal_port is 3000',
    );
  });
});
