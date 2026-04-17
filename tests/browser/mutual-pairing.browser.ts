// Browser test: mutual pairing via the fairfox pairing wrapper.
//
// The UX gap this catches: polly's pairing token is asymmetric — it only
// carries the issuer's identity. One scan leaves the scanner trusting
// the issuer, but the issuer still has no knowledge of the scanner. A
// previous version of the banner exposed "Issue" and "Scan" as sibling
// actions, so a user could complete one half, see the banner disappear
// on the scanning device, and reasonably believe they were done. The
// production fix is a two-step wizard that walks both halves; this test
// asserts the protocol-level requirement that backs that UX.

import { describe, done, expect, test } from '@fairfox/polly/test/browser';
import { createKeyring, loadOrCreateKeyring } from '../../packages/shared/src/keyring.ts';
import { completePairing, initiatePairing } from '../../packages/shared/src/pairing.ts';

function peerIdFrom(keyring: ReturnType<typeof createKeyring>): string {
  return Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('mutual pairing via asymmetric tokens', () => {
  test('one-way pairing leaves the issuer without the scanner', async () => {
    const laptop = createKeyring();
    const phone = createKeyring();
    const laptopToken = initiatePairing(laptop, peerIdFrom(laptop));
    await completePairing(phone, laptopToken);
    expect(phone.knownPeers.size).toBe(1);
    expect(laptop.knownPeers.size).toBe(0);
  });

  test('two-way pairing yields mutual trust', async () => {
    // Use a fresh IndexedDB namespace so loadOrCreateKeyring does not
    // reuse a previous test's keyring.
    indexedDB.deleteDatabase('fairfox-keyring');
    const laptop = await loadOrCreateKeyring();
    const phone = createKeyring();

    const laptopToken = initiatePairing(laptop, peerIdFrom(laptop));
    await completePairing(phone, laptopToken);

    const phoneToken = initiatePairing(phone, peerIdFrom(phone));
    await completePairing(laptop, phoneToken);

    expect(laptop.knownPeers.size).toBe(1);
    expect(phone.knownPeers.size).toBe(1);
  });
});

done();
