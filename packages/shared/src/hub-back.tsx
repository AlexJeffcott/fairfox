/** @jsxImportSource preact */
// HubBack — every mesh sub-app's header carries this link back to the
// fairfox landing. The landing is where pairing happens, where the
// peer list lives, and where a paired device chooses which sub-app
// to open; sub-apps should always expose a one-click path back to
// that hub rather than leaving the user in the browser's back-button
// weeds. Replaces the `MeshControls` button that used to start the
// pairing wizard inline — pairing now lives on the hub.

export function HubBack(): preact.JSX.Element {
  return (
    <a
      href="/"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--polly-space-xs)',
        color: 'var(--polly-text-muted)',
        textDecoration: 'none',
        fontSize: 'var(--polly-text-sm)',
      }}
      aria-label="Back to fairfox home"
    >
      <span aria-hidden="true">←</span>
      <span>fairfox</span>
    </a>
  );
}
