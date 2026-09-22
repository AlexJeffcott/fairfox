/**
 * Whether the version route answered the commit that was meant (C5): the
 * body is `{"commit": <commit>}` and nothing else. `devctl image` reads it
 * from the container, `devctl deploy` and `devctl rollback` from the app.
 */

/** Why the answer is not the commit, or null when it is. */
export function versionVerdict(body: string, commit: string): string | null {
  let answer: unknown;
  try {
    answer = JSON.parse(body);
  } catch {
    return `the version route did not answer JSON: ${JSON.stringify(body)}`;
  }
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
    return `the version route did not answer an object: ${body}`;
  }
  const keys = Object.keys(answer);
  const answered: unknown = Reflect.get(answer, 'commit');
  if (keys.length !== 1 || typeof answered !== 'string') {
    return `the version route answered more than the commit, or no commit: ${body}`;
  }
  if (answered !== commit) {
    return `the version route answered the commit ${answered}, not ${commit}`;
  }
  return null;
}
