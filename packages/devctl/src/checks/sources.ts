import { join } from 'node:path';
import { run } from '../proc.ts';

/**
 * Every TypeScript file in the tree, as a path from the root of the checkout:
 * the files git tracks, and the new files it does not ignore. What .gitignore
 * leaves out (node_modules, dist, reports) is not read.
 */
export async function typeScriptFiles(root: string): Promise<string[]> {
  const listed = await run(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], root);
  if (listed.code !== 0) {
    throw new Error(`git ls-files failed:\n${listed.output}`);
  }
  const files: string[] = [];
  for (const file of new Set(listed.output.split('\n'))) {
    if ((file.endsWith('.ts') || file.endsWith('.tsx')) && (await Bun.file(join(root, file)).exists())) {
      files.push(file);
    }
  }
  return files.sort();
}
