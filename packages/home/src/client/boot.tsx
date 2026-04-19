/** @jsxImportSource preact */
// Boot sequence for the fairfox landing / home sub-app.
//
// The landing is where pairing lives. Every other sub-app trusts that
// the device is already paired; if it is not, they redirect here. Home
// therefore runs the MeshGate around its own content: unpaired devices
// see the pairing login page, paired devices see the sub-app nav.
//
// The home page does not touch `$meshState`, so it does not need
// `ensure-mesh`. Only the keyring (which MeshGate reads directly via
// `loadOrCreateKeyring`) and the pairing actions participate here.

import '@fairfox/polly/ui/styles.css';
import '@fairfox/polly/ui/theme.css';

import { type ActionDispatch, installEventDelegation } from '@fairfox/polly/actions';
import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { MeshGate } from '@fairfox/shared/mesh-gate';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { pwaInstallActions } from '@fairfox/shared/pwa-install';
import { render } from 'preact';
import { Home } from '#src/client/Home.tsx';

const registry: Record<
  string,
  (ctx: { data: Record<string, string>; event: Event; element: HTMLElement }) => void
> = {
  ...pairingActions,
  ...buildFreshnessActions,
  ...pwaInstallActions,
};

installEventDelegation((d: ActionDispatch) => {
  const handler = registry[d.action];
  if (handler) {
    handler({ data: d.data, event: d.event, element: d.element });
  }
});

const root = document.getElementById('app');
if (root) {
  render(
    <MeshGate>
      <Home />
    </MeshGate>,
    root
  );
}
