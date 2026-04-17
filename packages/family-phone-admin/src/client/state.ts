// Family-phone admin state — the directory of humans, their devices,
// and the pairing tokens issued to bring new devices online. Syncs
// across every paired device in the family so any admin-capable
// device can onboard a new handset or PWA install. See the family-phone
// project notes for the broader system: this sub-app is the Phase 4
// admin UI, not the handset firmware itself.

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';

export type DeviceKind = 'phone' | 'laptop' | 'desktop' | 'tablet' | 'handset' | 'other';

export interface Human {
  [key: string]: unknown;
  id: string;
  name: string;
  createdAt: string;
}

export interface Device {
  [key: string]: unknown;
  id: string;
  humanId: string;
  name: string;
  kind: DeviceKind;
  publicKey: string;
  pairedAt: string;
  revokedAt: string | null;
}

export interface DirectoryDoc {
  [key: string]: unknown;
  humans: Human[];
  devices: Device[];
}

export const directoryState = $meshState<DirectoryDoc>('family-phone:directory', {
  humans: [],
  devices: [],
});
