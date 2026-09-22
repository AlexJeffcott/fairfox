/**
 * The variables the server's code reads, against the variables DEPLOY.md
 * lists (C3). Pure: the texts are the arguments. The check env-list reads
 * the files and calls these.
 */

/** Every capture group of every match, once each, in order of name. */
function captured(text: string, pattern: RegExp): string[] {
  const found = [...text.matchAll(pattern)].flatMap((match) => match.slice(1).filter((group) => group !== undefined));
  return [...new Set(found)].sort();
}

/** The variables a TypeScript file reads as `process.env.NAME` or `process.env['NAME']`. */
export function processEnvIn(text: string): string[] {
  return captured(text, /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\])/g);
}

/** The Fairfox variables a shell script reads as `$FAIRFOX_X` or `${FAIRFOX_X`. */
export function shellVariablesIn(text: string): string[] {
  return captured(text, /\$\{?(FAIRFOX_[A-Z0-9_]+)/g);
}

/**
 * The variables DEPLOY.md lists under one `##` heading: the first cell of
 * each table row of that section, in backticks.
 */
export function documentedVariables(markdown: string, heading: string): string[] {
  const section = markdown.split(/^## /m).find((s) => s.startsWith(`${heading}\n`));
  if (section === undefined) {
    throw new Error(`DEPLOY.md has no heading "## ${heading}"`);
  }
  return captured(section, /^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|/gm);
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
