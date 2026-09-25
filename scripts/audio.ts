// Sound and relay helpers shared by the step 0c checks. Sound travels as
// G.711 µ-law (PCMU): 8 kHz mono, one byte a sample, 160 samples in each
// 20 ms RTP packet. PCMU needs no encoder library, and a µ-law round trip is
// the same on both ends, so the receiver can compare what it got byte for byte.
import { createHmac } from 'node:crypto';

export const SAMPLE_RATE = 8000;
export const SAMPLES_PER_PACKET = 160;
export const PACKET_MS = 20;

/** 16-bit PCM samples of an 8 kHz mono WAV file. Any other format fails. */
export function readWav(bytes: Uint8Array): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('Not a WAV file.');
  }
  let at = 12;
  let format: { channels: number; rate: number; bits: number } | undefined;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      format = { channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    }
    if (id === 'data') {
      if (format === undefined) {
        throw new Error('The WAV file has no fmt chunk before its data.');
      }
      if (format.channels !== 1 || format.rate !== SAMPLE_RATE || format.bits !== 16) {
        throw new Error(
          `The WAV file is ${format.channels} channel, ${format.rate} Hz, ${format.bits} bit. It must be 1 channel, 8000 Hz, 16 bit. On a Mac: say -o in.wav --data-format=LEI16@8000 "one two three"`,
        );
      }
      const samples = new Int16Array(Math.floor(Math.min(size, bytes.length - body) / 2));
      for (let i = 0; i < samples.length; i++) {
        samples[i] = view.getInt16(body + i * 2, true);
      }
      return samples;
    }
    at = body + size + (size % 2);
  }
  throw new Error('The WAV file has no data chunk.');
}

/** An 8 kHz mono 16-bit WAV file of `samples`. */
export function writeWav(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const put = (at: number, text: string) => bytes.set(new TextEncoder().encode(text), at);
  put(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, s, true));
  return bytes;
}

const BIAS = 0x84;
const CLIP = 32635;

/** One 16-bit sample as a G.711 µ-law byte. */
export function encodeMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  let magnitude = Math.min(Math.abs(sample), CLIP) + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (magnitude & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--;
  }
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** One G.711 µ-law byte as a 16-bit sample. */
export function decodeMulaw(byte: number): number {
  const u = ~byte & 0xff;
  const magnitude = ((((u & 0x0f) << 3) + BIAS) << ((u & 0x70) >> 4)) - BIAS;
  return u & 0x80 ? -magnitude : magnitude;
}

/** The samples cut into µ-law payloads of one packet each; the last is padded with silence. */
export function packetize(samples: Int16Array): Uint8Array[] {
  const payloads: Uint8Array[] = [];
  for (let start = 0; start < samples.length; start += SAMPLES_PER_PACKET) {
    const payload = new Uint8Array(SAMPLES_PER_PACKET).fill(encodeMulaw(0));
    for (let i = 0; i < SAMPLES_PER_PACKET && start + i < samples.length; i++) {
      payload[i] = encodeMulaw(samples[start + i] ?? 0);
    }
    payloads.push(payload);
  }
  return payloads;
}

/**
 * Credentials for coturn's use-auth-secret: the user name is the expiry time
 * in Unix seconds and a label, the password the Base64 HMAC-SHA1 of the user
 * name under the relay's shared secret. coturn checks them with no state.
 */
export function turnCredentials(secret: string, label: string, now: Date, lifetimeSeconds: number): { username: string; credential: string } {
  const username = `${Math.floor(now.getTime() / 1000) + lifetimeSeconds}:${label}`;
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64') };
}
