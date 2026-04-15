// data-* and aria-* attribute passthrough for components that don't spread rest.
//
// Components in @fairfox/ui destructure their own props explicitly and call
// collectHTMLAttrs(props) to forward data and aria attributes onto the root
// element. The primary reason this matters is the data-action family, which
// is how every interactive primitive declares its intent to the global event
// delegator — see src/event-delegation.ts and ADR 0002.

export type HTMLPassthroughProps = {
  [key: `data-${string}`]: string | number | boolean | undefined;
  [key: `aria-${string}`]: string | number | boolean | undefined;
};

// biome-ignore lint/suspicious/noExplicitAny: accepts any props shape by design
export function collectHTMLAttrs(props: Record<string, any>): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if ((key.startsWith('data-') || key.startsWith('aria-')) && value !== undefined) {
      attrs[key] = value;
    }
  }
  return attrs;
}
