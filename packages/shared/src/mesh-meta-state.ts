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
