// Mesh metadata — a tiny CRDT doc that carries a human-chosen name
// for this mesh (defaults to empty until `mesh init --name …` sets
// one) plus a derived fingerprint of the document key so devices
// can verify they're on the same cryptographic mesh without trusting
// the name alone.
//
// The fingerprint itself isn't stored; it's computed at read time
// from the keyring's document key. A peer that tampered with the
// name would change the mesh:meta doc but NOT the document key, so
// the fingerprint diverges the moment you compare across devices.

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';
import { signal } from '@preact/signals';

interface MeshMetaPrimitive {
  value: MeshMetaDoc;
  readonly loaded: Promise<void>;
}

export interface MeshMetaDoc {
  [key: string]: unknown;
  /** Human-chosen name. Empty string when unset. */
  name: string;
}

let _metaPrimitive: MeshMetaPrimitive | null = null;

function primitive(): MeshMetaPrimitive {
  if (_metaPrimitive === null) {
    _metaPrimitive = $meshState<MeshMetaDoc>('mesh:meta', { name: '' });
  }
  return _metaPrimitive;
}

export const meshMetaState: MeshMetaPrimitive = {
  get value(): MeshMetaDoc {
    return primitive().value;
  },
  set value(next: MeshMetaDoc) {
    primitive().value = next;
  },
  get loaded(): Promise<void> {
    return primitive().loaded;
  },
};

export function setMeshName(name: string): void {
  meshMetaState.value = { ...meshMetaState.value, name };
}

/** A pool of short lines in the key of Dylan Thomas — pastoral,
 * Welsh, tidal, compound-nouny. `generateMeshName` picks one at
 * random when `mesh init` runs without `--name`. Feels less like
 * a server and more like a place. None are direct quotes; they're
 * fresh phrases that try to hum in his register. */
const DYLAN_NAMES: readonly string[] = [
  'Black sparrow of morning',
  'Gull-wrecked stone',
  'Heron-lit hour',
  'Altar of the green tide',
  'Once below the oat-hill',
  'Bone hymn of the sea',
  'Cradle in the cold grass',
  'Owl-light on the nettles',
  'Salt-tongued bell',
  'Hawthorn and the long night',
  'Goldfinch under the rain',
  'Star-combed field',
  'Churchyard of the sea',
  'Kite above the rowan',
  'Curlew and the bright air',
  'Moth at the kitchen pane',
  'Wren-song in the frost',
  'Apple-bough and the small cold grass',
  'Milk wood after the rain',
  'Foxglove on the wrecked gate',
];

/** Pick a random Dylan-flavoured name. Uses `crypto.getRandomValues`
 * so the selection is unbiased and survives any `Math.random`
 * monkey-patch. */
export function generateMeshName(): string {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  const raw = bytes[0];
  const idx = raw === undefined ? 0 : raw % DYLAN_NAMES.length;
  const name = DYLAN_NAMES[idx];
  return name ?? DYLAN_NAMES[0] ?? 'Fairfox mesh';
}

/** Short cryptographic fingerprint of the mesh's document key — the
 * first 8 hex chars of SHA-256 over the 32-byte key bytes. Two
 * devices on the same mesh share the same key and therefore the
 * same fingerprint; a lookalike mesh with a stolen name but
 * different keys won't match. `crypto.subtle` is universally
 * available on browsers and on bun; the helper is async to satisfy
 * that API. */
export async function meshFingerprint(documentKey: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer so `crypto.subtle.digest`'s type
  // signature is satisfied (it rejects Uint8Array<ArrayBufferLike>
  // on bun + TS 5.7 even though the runtime accepts it).
  const buf = new ArrayBuffer(documentKey.byteLength);
  new Uint8Array(buf).set(documentKey);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest).slice(0, 4);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Reactive view of the mesh fingerprint. Empty string until the
 * keyring loads on first access. Both the hub header and the help
 * tab's diagnostics panel read from this; centralising the load
 * here keeps the keyring import out of view modules and avoids
 * each consumer re-deriving the fingerprint on its own. */
export const meshFingerprintText = signal<string>('');

let fingerprintLoading: Promise<void> | null = null;

export function ensureMeshFingerprintLoaded(): Promise<void> {
  if (meshFingerprintText.value !== '') {
    return Promise.resolve();
  }
  if (fingerprintLoading !== null) {
    return fingerprintLoading;
  }
  fingerprintLoading = (async (): Promise<void> => {
    try {
      const { loadOrCreateKeyring } = await import('#src/keyring.ts');
      const { DEFAULT_MESH_KEY_ID } = await import('@fairfox/polly/mesh');
      const keyring = await loadOrCreateKeyring();
      const docKey = keyring.documentKeys.get(DEFAULT_MESH_KEY_ID);
      if (docKey) {
        meshFingerprintText.value = await meshFingerprint(docKey);
      }
    } catch {
      // Keep empty; consumers hide the field when blank.
    } finally {
      fingerprintLoading = null;
    }
  })();
  return fingerprintLoading;
}
