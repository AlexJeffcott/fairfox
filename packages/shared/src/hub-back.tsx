/** @jsxImportSource preact */
// HubBack — every mesh sub-app's header carries this link back to the
// fairfox landing. The landing is where pairing happens, where the
// peer list lives, and where a paired device chooses which sub-app
// to open; sub-apps should always expose a one-click path back to
// that hub rather than leaving the user in the browser's back-button
// weeds. Replaces the `MeshControls` button that used to start the
// pairing wizard inline — pairing now lives on the hub.

import { Button } from '@fairfox/polly/ui';

export function HubBack(): preact.JSX.Element {
  return (
    <Button
      href="/"
      tier="tertiary"
      size="small"
      data-action="app.navigate"
      data-action-href="/"
      aria-label="Back to fairfox home"
      label="← fairfox"
    />
  );
}
