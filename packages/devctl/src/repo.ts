import { run } from './proc.ts';

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await run(['git', ...args], cwd);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.output}`);
  }
  return result.output.trim();
}

/**
 * The root of the checkout this devctl belongs to: found from devctl's own
 * source, not from the directory it was started in.
 */
export function repoRoot(): Promise<string> {
  return git(import.meta.dir, ['rev-parse', '--show-toplevel']);
}

/** The commit that is checked out. */
export function head(root: string): Promise<string> {
  return git(root, ['rev-parse', 'HEAD']);
}

/** True when git reports no change, staged, unstaged or untracked. */
export async function isClean(root: string): Promise<boolean> {
  return (await git(root, ['status', '--porcelain'])) === '';
}
