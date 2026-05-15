// Action registry for family-phone-admin.
//
// The pairing token itself is issued by @fairfox/shared/pairing and is
// displayed as a QR code on the issuer's device. Its contents reach a
// new device out of band (camera scan). This registry records the
// human and device metadata once pairing completes; the cryptographic
// trust flows through the keyring, not this CRDT.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import type { Device, DeviceKind, FamilyPhoneTabId, Human } from '#src/client/state.ts';
import { directoryState, familyPhoneActiveTab } from '#src/client/state.ts';

const TAB_IDS = new Set<string>(['humans', 'devices']);

function isFamilyPhoneTabId(s: string): s is FamilyPhoneTabId {
  return TAB_IDS.has(s);
}

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
  ...buildFreshnessActions,

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
    directoryState.handle?.change((doc) => {
      doc.humans.push(human);
    });
  },

  'human.remove': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    directoryState.handle?.change((doc) => {
      const idx = doc.humans.findIndex((h) => h.id === id);
      if (idx >= 0) {
        doc.humans.splice(idx, 1);
      }
    });
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
    directoryState.handle?.change((doc) => {
      doc.devices.push(device);
    });
  },

  'device.revoke': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    const now = new Date().toISOString();
    directoryState.handle?.change((doc) => {
      const target = doc.devices.find((d) => d.id === id);
      if (target) {
        target.revokedAt = now;
      }
    });
  },

  'device.rename': (ctx) => {
    const id = ctx.data.id;
    const name = ctx.data.value ?? ctx.data.name;
    if (!id || !name) {
      return;
    }
    directoryState.handle?.change((doc) => {
      const target = doc.devices.find((d) => d.id === id);
      if (target) {
        target.name = name;
      }
    });
  },

  'directory.tab': (ctx) => {
    const id = ctx.data.id;
    if (id && isFamilyPhoneTabId(id)) {
      familyPhoneActiveTab.value = id;
    }
  },
};
