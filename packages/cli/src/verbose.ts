// Global --verbose / -v flag.
//
// bin.ts strips `--verbose` and `-v` from argv before dispatching to a
// command, calls `setVerbose(true)`, and from then on every module that
// wants to log diagnostics can call `vlog(...)` without threading a
// boolean through its function signatures. The signal is also exposed
// as a process env var (`FAIRFOX_VERBOSE=1`) so subprocess CLI calls
// inherit it without an explicit flag.

let verboseFlag = false;

export function setVerbose(on: boolean): void {
  verboseFlag = on;
  if (on) {
    process.env.FAIRFOX_VERBOSE = '1';
  }
}

export function isVerbose(): boolean {
  if (verboseFlag) {
    return true;
  }
  // Allow child processes spawned without an explicit flag to still
  // emit verbose output if the parent was verbose.
  return process.env.FAIRFOX_VERBOSE === '1';
}

/** Diagnostic log line; only emitted when --verbose is set. Goes to
 * stderr so it never contaminates structured stdout output that other
 * tools might be parsing. Tag every line with a short label so a
 * verbose run is greppable by subsystem. */
export function vlog(label: string, ...args: unknown[]): void {
  if (!isVerbose()) {
    return;
  }
  const ts = new Date().toISOString().slice(11, 23);
  const parts = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a)));
  process.stderr.write(`[${ts}] [${label}] ${parts.join(' ')}\n`);
}
