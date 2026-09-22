/**
 * The commit in the server's answer to GET /version. The typed client
 * promises `{ commit: string }`, but the server at the other end may run
 * another version of Fairfox, or not be Fairfox at all. So the CLI reads the
 * answer at run time, and refuses anything else.
 */
export function commitOf(answer: unknown): string {
  if (
    typeof answer === 'object' &&
    answer !== null &&
    Object.keys(answer).length === 1 &&
    'commit' in answer &&
    typeof answer.commit === 'string'
  ) {
    return answer.commit;
  }
  throw new Error(`The server's answer to /version is not { commit: string }: ${JSON.stringify(answer)}`);
}
