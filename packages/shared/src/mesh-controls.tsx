/** @jsxImportSource preact */
// MeshControls — a compact chrome element every sub-app renders in
// its header row so an already-paired device can re-enter the pairing
// ceremony to bring a third device on, or to send a return key when
// an asymmetric pairing has only completed one half. Clicking the
// control flips pairingMode out of 'idle', which closes the mesh gate
// and reveals the <LoginPage /> at its issue step. Cancelling the
// ceremony returns pairingMode to 'idle' and the gate reopens.

import { Button } from '@fairfox/polly/ui';

export function MeshControls(): preact.JSX.Element {
  return (
    <Button
      label="Pair another device"
      tier="tertiary"
      size="small"
      data-action="pairing.start-issue"
    />
  );
}
