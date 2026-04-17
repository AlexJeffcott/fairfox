// Action registry for family-phone-admin.
//
// The pairing token itself is issued by @fairfox/shared/pairing and is
// displayed as a QR code on the issuer's device. Its contents reach a
// new device out of band (camera scan). This registry records the
// human and device metadata once pairing completes; the cryptographic
// trust flows through the keyring, not this CRDT.

import { pairingActions } from '@fairfox/shared/pairing-actions';
import type { Device, DeviceKind, Human } from '#src/client/state.ts';
import { directoryState } from '#src/client/state.ts';

interface HandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

const DEVICE_KINDS = new Set<string>(['phone', 'laptop', 'desktop', 'tablet', 'handset', 'other']);

function isDeviceKind(s: string): s is DeviceKind {
  return DEVICE_KINDS.has(s);
}

function generateId(prefix: string): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,

  'human.add': (ctx) => {
    const name = ctx.data.value ?? ctx.data.name;
    if (!name) {
      return;
    }
    const human: Human = {
      id: generateId('H'),
      name,
      createdAt: new Date().toISOString(),
    };
    directoryState.value = {
      ...directoryState.value,
      humans: [...directoryState.value.humans, human],
    };
  },

  'human.remove': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    directoryState.value = {
      ...directoryState.value,
      humans: directoryState.value.humans.filter((h) => h.id !== id),
    };
  },

  'device.register': (ctx) => {
    const humanId = ctx.data.humanId;
    const name = ctx.data.name;
    const kindRaw = ctx.data.kind ?? 'other';
    const publicKey = ctx.data.publicKey ?? '';
    if (!humanId || !name || !isDeviceKind(kindRaw)) {
      return;
    }
    const device: Device = {
      id: generateId('D'),
      humanId,
      name,
      kind: kindRaw,
      publicKey,
      pairedAt: new Date().toISOString(),
      revokedAt: null,
    };
    directoryState.value = {
      ...directoryState.value,
      devices: [...directoryState.value.devices, device],
    };
  },

  'device.revoke': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    directoryState.value = {
      ...directoryState.value,
      devices: directoryState.value.devices.map((d) =>
        d.id === id ? { ...d, revokedAt: new Date().toISOString() } : d
      ),
    };
  },

  'device.rename': (ctx) => {
    const id = ctx.data.id;
    const name = ctx.data.value ?? ctx.data.name;
    if (!id || !name) {
      return;
    }
    directoryState.value = {
      ...directoryState.value,
      devices: directoryState.value.devices.map((d) => (d.id === id ? { ...d, name } : d)),
    };
  },

  'directory.tab': () => {
    // Tab changes handled by local signal in App — no CRDT mutation.
  },
};
