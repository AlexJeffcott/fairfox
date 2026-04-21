// Unified action registry. Every sub-app's handlers merge into one
// map here so the single `installEventDelegation` call at boot can
// dispatch anywhere in the app without each sub-app having to run
// its own delegation.
//
// Phase 1 keeps only the handlers the current landing page needs
// (pairing, build-freshness, PWA install, home, router). Phase 2
// adds `todoActions`, `agendaActions`, `libraryActions`, etc. as
// each sub-app gets lifted into the unified shell — the merge is
// trivial because sub-apps already prefix their action names.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { pwaInstallActions } from '@fairfox/shared/pwa-install';
import { homeActions } from '#src/client/home-actions.ts';
import { routerActions } from '#src/client/router.ts';

type HandlerContext = {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
};

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,
  ...buildFreshnessActions,
  ...pwaInstallActions,
  ...homeActions,
  ...routerActions,
};
