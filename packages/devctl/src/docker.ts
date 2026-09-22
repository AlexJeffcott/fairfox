import { run } from './proc.ts';

/**
 * Whether the Docker daemon answers. TLC, polly verify and the production
 * image each need it. There is no fallback: a command that needs Docker and
 * finds it down fails, and says so.
 */
export async function dockerAnswers(root: string): Promise<boolean> {
  try {
    return (await run(['docker', 'info', '--format', '{{.ServerVersion}}'], root)).code === 0;
  } catch {
    // Bun.spawn throws when `docker` is not on PATH at all.
    return false;
  }
}

export function dockerDown(command: string): string {
  return `devctl ${command}: Docker is not running, or not on PATH. Start Docker Desktop, then run it again.`;
}
