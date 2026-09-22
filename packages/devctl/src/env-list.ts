/**
 * The variables the server's code reads, against the variables DEPLOY.md
 * lists (C3). Pure: the texts are the arguments. The check env-list reads
 * the files and calls these.
 */

/** The variables a TypeScript file reads as `process.env.NAME` or `process.env['NAME']`. */
export function processEnvIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\])/g)) {
    found.add(match[1] ?? match[2] ?? '');
  }
  return [...found].sort();
}

/** The Fairfox variables a shell script reads as `$FAIRFOX_X` or `${FAIRFOX_X`. */
export function shellVariablesIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\$\{?(FAIRFOX_[A-Z0-9_]+)/g)) {
    found.add(match[1] ?? '');
  }
  return [...found].sort();
}

/**
 * The variables DEPLOY.md lists under its heading of settings the code
 * reads: the first cell of each table row under that heading, in backticks,
 * up to the next heading.
 */
export function documentedVariables(markdown: string, heading: string): string[] {
  const start = markdown.indexOf(`\n## ${heading}`);
  if (start < 0) {
    throw new Error(`DEPLOY.md has no heading "## ${heading}"`);
  }
  const rest = markdown.slice(start + 1);
  const end = rest.indexOf('\n## ');
  const section = end < 0 ? rest : rest.slice(0, end);
  const found = new Set<string>();
  for (const match of section.matchAll(/^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|/gm)) {
    found.add(match[1] ?? '');
  }
  return [...found].sort();
}

/** Where the two lists differ. Both empty means the document is the code. */
export type Difference = {
  /** Read by the code, not in the document. */
  undocumented: string[];
  /** In the document, read by nothing. */
  unread: string[];
};

export function compareVariables(read: readonly string[], documented: readonly string[]): Difference {
  return {
    undocumented: read.filter((name) => !documented.includes(name)).sort(),
    unread: documented.filter((name) => !read.includes(name)).sort(),
  };
}
