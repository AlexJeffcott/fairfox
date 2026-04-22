/** @jsxImportSource preact */
// In-app QR scanning for the pairing flow. Two shapes:
//
//  1. Live camera (`QrScanDialog`) — full-screen overlay with a
//     video feed piped through jsQR frame-by-frame. The only way
//     a mobile PWA user can scan the admin's QR without the OS
//     camera app hijacking the link into the default browser.
//  2. Still image (`QrImageDropzone`) — screenshot-of-a-QR as a
//     first-class input. Hidden `<input type="file">` behind a
//     visible label, plus a window-level paste listener so
//     Cmd/Ctrl-V on the pair page drops a pasted image straight
//     into the decoder. Both paths land in the same
//     `submitScannedValue` pipeline the text paste box uses.
//
// Camera implementation is a straight video → canvas → jsQR loop.
// The heavy frame-by-frame work runs on requestAnimationFrame so
// the browser can throttle it when the tab isn't visible. Image
// decoding flips `inversionAttempts` to 'attemptBoth' because a
// screenshot's colour profile may have inverted the code.

import { Button } from '@fairfox/polly/ui';
import { signal } from '@preact/signals';
import jsQR from 'jsqr';
import { useEffect, useRef } from 'preact/hooks';
import { importRecoveryBlob, submitScannedValue } from '#src/pairing-actions.ts';
import { type CameraScanMode, cameraScanMode, pairingError } from '#src/pairing-state.ts';

/** Pull a recovery blob out of whatever the QR actually encoded.
 * Accepts:
 *   - a bare `fairfox-user-v1:<hex>:<name>` blob
 *   - a URL with a `&recovery=<encoded-blob>` fragment param — this
 *     is what `fairfox mesh add-device` emits, and scanning it
 *     on the "Scan recovery blob" entry point used to fail with
 *     "unrecognised blob format" because the whole URL went into
 *     decodeRecoveryBlob as-is.
 *   - an already URL-decoded form of either of the above.
 * Returns the raw blob the decoder wants; otherwise the input
 * unchanged (so decodeRecoveryBlob's error message is still what
 * the user sees on genuinely malformed input). */
function extractRecoveryBlob(raw: string): string {
  const trimmed = raw.trim();
  // URL form: fragment after `#` typically has `pair=…&s=…&recovery=…`
  const hashIdx = trimmed.indexOf('#');
  const searchIdx = trimmed.indexOf('?');
  const afterMarker =
    hashIdx >= 0
      ? trimmed.slice(hashIdx + 1)
      : searchIdx >= 0
        ? trimmed.slice(searchIdx + 1)
        : trimmed;
  if (afterMarker.includes('recovery=')) {
    for (const part of afterMarker.split('&')) {
      if (part.startsWith('recovery=')) {
        const encoded = part.slice('recovery='.length);
        try {
          return decodeURIComponent(encoded);
        } catch {
          return encoded;
        }
      }
    }
  }
  return trimmed;
}

async function dispatchScanPayload(mode: CameraScanMode, payload: string): Promise<void> {
  if (mode === 'recovery') {
    await importRecoveryBlob(extractRecoveryBlob(payload));
    return;
  }
  await submitScannedValue(payload);
}

const cameraScanError = signal<string | null>(null);

/** True when the runtime plausibly has a camera and the decoder is
 * loadable. Used by the login page to hide the "Scan with camera"
 * button on environments where it couldn't possibly work. Desktop
 * Chrome with no webcam returns true and falls through to an error
 * on getUserMedia; that's fine — the error is visible, not a
 * surprise. */
export function canScanWithCamera(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

const OVERLAY_STYLE = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(0, 0, 0, 0.85)',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--polly-space-md, 1rem)',
  gap: 'var(--polly-space-md, 1rem)',
};

const VIDEO_WRAP_STYLE = {
  position: 'relative' as const,
  width: '100%',
  maxWidth: '420px',
  aspectRatio: '1 / 1',
  overflow: 'hidden',
  borderRadius: '12px',
  background: '#000',
};

const VIDEO_STYLE = {
  width: '100%',
  height: '100%',
  objectFit: 'cover' as const,
};

const FRAME_STYLE = {
  position: 'absolute' as const,
  inset: '12%',
  border: '2px solid rgba(255, 255, 255, 0.8)',
  borderRadius: '8px',
  pointerEvents: 'none' as const,
};

const HINT_STYLE = {
  margin: 0,
  color: 'rgba(255, 255, 255, 0.85)',
  fontSize: '0.9rem',
  textAlign: 'center' as const,
  maxWidth: '420px',
};

const ERROR_STYLE = {
  margin: 0,
  color: '#fecaca',
  fontSize: '0.9rem',
  textAlign: 'center' as const,
  maxWidth: '420px',
};

function closeCamera(): void {
  cameraScanMode.value = null;
  cameraScanError.value = null;
}

export function QrScanDialog(): preact.JSX.Element | null {
  const modeOrNull = cameraScanMode.value;
  if (modeOrNull === null) {
    return null;
  }
  const mode: CameraScanMode = modeOrNull;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId: number | null = null;

    async function start(): Promise<void> {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => {
            t.stop();
          });
          return;
        }
        const video = videoRef.current;
        if (!video) {
          return;
        }
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play();
        tick();
      } catch (err) {
        cameraScanError.value = err instanceof Error ? err.message : 'Could not open the camera.';
      }
    }

    function tick(): void {
      if (cancelled) {
        return;
      }
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w > 0 && h > 0) {
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h);
            const image = ctx.getImageData(0, 0, w, h);
            const code = jsQR(image.data, image.width, image.height, {
              inversionAttempts: 'dontInvert',
            });
            if (code?.data) {
              cancelled = true;
              pairingError.value = null;
              closeCamera();
              void dispatchScanPayload(mode, code.data);
              return;
            }
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    void start();

    return () => {
      cancelled = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (stream) {
        stream.getTracks().forEach((t) => {
          t.stop();
        });
      }
    };
  }, []);

  return (
    <div style={OVERLAY_STYLE} role="dialog" aria-label="Scan pairing QR">
      <p style={HINT_STYLE}>
        Point this device at the QR code shown on the admin device. The pair happens as soon as the
        code is in frame.
      </p>
      <div style={VIDEO_WRAP_STYLE}>
        <video ref={videoRef} style={VIDEO_STYLE} playsInline={true} muted={true} />
        <div style={FRAME_STYLE} />
      </div>
      {cameraScanError.value && <p style={ERROR_STYLE}>{cameraScanError.value}</p>}
      <Button label="Cancel" tier="secondary" data-action="pairing.close-camera" />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

/** Decode a QR code found anywhere in `blob`. Returns the payload
 * string, or null if no code is found (distinguishing "nothing
 * decodable in this image" from a transient decoder failure, which
 * throws). */
export async function decodeQrFromImageBlob(blob: Blob): Promise<string | null> {
  if (typeof document === 'undefined') {
    return null;
  }
  let width = 0;
  let height = 0;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  // createImageBitmap is the preferred path (handles orientation
  // and is off-main-thread on most engines). Fall back to the
  // <img> + URL.createObjectURL dance for browsers that still lack
  // it.
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    width = bitmap.width;
    height = bitmap.height;
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  } else {
    const url = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          width = img.naturalWidth;
          height = img.naturalHeight;
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0);
          resolve();
        };
        img.onerror = () => {
          reject(new Error('could not decode image'));
        };
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (width === 0 || height === 0) {
    return null;
  }
  const image = ctx.getImageData(0, 0, width, height);
  const code = jsQR(image.data, image.width, image.height, {
    inversionAttempts: 'attemptBoth',
  });
  return code?.data ?? null;
}

const DROPZONE_STYLE = {
  display: 'inline-block',
  padding: '0.55rem 1rem',
  fontSize: '0.85rem',
  borderRadius: '6px',
  border: '1px dashed var(--polly-border, #d4d4d4)',
  background: 'transparent',
  color: 'var(--polly-text-muted, #57534e)',
  cursor: 'pointer',
  textAlign: 'center' as const,
  width: '100%',
};

/** Screenshot-of-a-QR as an input. Renders a label-wrapped
 * `<input type="file">` (so clicks open the native picker without
 * needing an inline onClick) and also registers a window-level
 * paste listener for Cmd/Ctrl-V with an image on the clipboard.
 * `mode` decides what the decoded payload feeds — the pair pipeline
 * or the recovery-blob import. */
export function QrImageDropzone({
  mode = 'pair',
}: {
  mode?: CameraScanMode;
} = {}): preact.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) {
      return;
    }
    async function handleBlob(blob: Blob): Promise<void> {
      try {
        const decoded = await decodeQrFromImageBlob(blob);
        if (decoded) {
          pairingError.value = null;
          await dispatchScanPayload(mode, decoded);
        } else {
          pairingError.value = "Couldn't find a QR code in that image.";
        }
      } catch (err) {
        pairingError.value = err instanceof Error ? err.message : 'image decode failed';
      }
    }
    function onFileChange(): void {
      const file = el?.files?.[0];
      if (file) {
        void handleBlob(file);
        if (el) {
          el.value = '';
        }
      }
    }
    function onPaste(e: ClipboardEvent): void {
      const items = e.clipboardData?.items;
      if (!items) {
        return;
      }
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            void handleBlob(blob);
            return;
          }
        }
      }
    }
    el.addEventListener('change', onFileChange);
    window.addEventListener('paste', onPaste);
    return () => {
      el.removeEventListener('change', onFileChange);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  return (
    <label style={DROPZONE_STYLE}>
      Scan from a screenshot (or paste an image)
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        aria-label="Pick a screenshot of a pairing QR code"
      />
    </label>
  );
}
