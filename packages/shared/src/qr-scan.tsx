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
import { effect, signal } from '@preact/signals';
import jsQR from 'jsqr';
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

// Module-scoped DOM handles for the camera dialog. Callback refs on
// the <video>/<canvas> in QrScanDialog populate these on mount and
// clear them on unmount, so the camera lifecycle lives outside any
// Preact hook.
let cameraVideoEl: HTMLVideoElement | null = null;
let cameraCanvasEl: HTMLCanvasElement | null = null;

let activeStream: MediaStream | null = null;
let activeRafId: number | null = null;
let activeCameraSession = 0;

function stopCamera(): void {
  activeCameraSession += 1;
  if (activeRafId !== null) {
    cancelAnimationFrame(activeRafId);
    activeRafId = null;
  }
  if (activeStream) {
    activeStream.getTracks().forEach((t) => {
      t.stop();
    });
    activeStream = null;
  }
  if (cameraVideoEl) {
    cameraVideoEl.srcObject = null;
  }
}

async function startCamera(mode: CameraScanMode): Promise<void> {
  const session = ++activeCameraSession;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    if (session !== activeCameraSession) {
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      return;
    }
    activeStream = stream;
    const video = cameraVideoEl;
    if (!video) {
      return;
    }
    // iOS PWA only renders the stream if playsinline/muted/autoplay
    // are set before srcObject. The JSX sets all three; we still set
    // them imperatively here in case the element was reused.
    video.muted = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('autoplay', 'true');
    video.srcObject = stream;
    if (video.readyState < video.HAVE_METADATA) {
      await new Promise<void>((resolve) => {
        const onReady = () => {
          video.removeEventListener('loadedmetadata', onReady);
          resolve();
        };
        video.addEventListener('loadedmetadata', onReady);
      });
    }
    if (session !== activeCameraSession) {
      return;
    }
    // On iOS PWA, play() can reject ("AbortError: interrupted by load")
    // even when autoplay then takes over and frames start flowing. Don't
    // fail the whole flow on a play() rejection — let tickCamera decide
    // whether the video is actually delivering frames.
    try {
      await video.play();
    } catch {
      // intentional: see comment above
    }
    tickCamera(mode, session);
  } catch (err) {
    cameraScanError.value = err instanceof Error ? err.message : 'Could not open the camera.';
  }
}

function tickCamera(mode: CameraScanMode, session: number): void {
  if (session !== activeCameraSession) {
    return;
  }
  const video = cameraVideoEl;
  const canvas = cameraCanvasEl;
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
          pairingError.value = null;
          const payload = code.data;
          closeCamera();
          void dispatchScanPayload(mode, payload);
          return;
        }
      }
    }
  }
  activeRafId = requestAnimationFrame(() => {
    tickCamera(mode, session);
  });
}

let cameraLifecycleInstalled = false;

/** Install the module-scope effect that drives the camera on and off
 * in response to `cameraScanMode` changes. The QR dialog's video and
 * canvas elements register themselves via callback refs, so this
 * effect can open getUserMedia and start the jsQR frame loop without
 * any component-level hook. Safe to call more than once. */
export function installQrCameraLifecycle(): void {
  if (cameraLifecycleInstalled) {
    return;
  }
  cameraLifecycleInstalled = true;
  effect(() => {
    const mode = cameraScanMode.value;
    if (mode === null) {
      stopCamera();
      return;
    }
    // Callback refs populate after render commits. One microtask is
    // enough to let the dialog mount before we grab the elements.
    queueMicrotask(() => {
      if (cameraScanMode.value === mode && cameraVideoEl && cameraCanvasEl) {
        void startCamera(mode);
      }
    });
  });
}

function setCameraVideo(el: HTMLVideoElement | null): void {
  cameraVideoEl = el;
}

function setCameraCanvas(el: HTMLCanvasElement | null): void {
  cameraCanvasEl = el;
}

export function QrScanDialog(): preact.JSX.Element | null {
  if (cameraScanMode.value === null) {
    return null;
  }

  return (
    <div style={OVERLAY_STYLE} role="dialog" aria-label="Scan pairing QR">
      <p style={HINT_STYLE}>
        Point this device at the QR code shown on the admin device. The pair happens as soon as the
        code is in frame.
      </p>
      <div style={VIDEO_WRAP_STYLE}>
        <video
          ref={setCameraVideo}
          style={VIDEO_STYLE}
          playsInline={true}
          muted={true}
          autoPlay={true}
        />
        <div style={FRAME_STYLE} />
      </div>
      {cameraScanError.value && <p style={ERROR_STYLE}>{cameraScanError.value}</p>}
      <Button label="Cancel" tier="secondary" data-action="pairing.close-camera" />
      <canvas ref={setCameraCanvas} style={{ display: 'none' }} />
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

/** Decode a QR blob and route it through the configured pair or
 * recovery pipeline. Used by the paste listener installed at boot
 * and by the `qr.dropzone-file` action handler below. */
async function handleDropzoneBlob(blob: Blob, mode: CameraScanMode): Promise<void> {
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

/** Resolve the mode of the currently-visible dropzone, if any. The
 * window-level paste listener installed at boot uses this to decide
 * whether a pasted image should feed the pair or recovery pipeline.
 * Returns null when no dropzone is rendered (the listener then does
 * nothing and lets the default paste behaviour through). */
function resolveVisibleDropzoneMode(): CameraScanMode | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const el = document.querySelector('[data-qr-dropzone-mode]');
  if (!(el instanceof HTMLElement)) {
    return null;
  }
  const mode = el.dataset.qrDropzoneMode;
  if (mode === 'pair' || mode === 'recovery') {
    return mode;
  }
  return null;
}

let pasteListenerInstalled = false;

/** Install a window-level paste listener that routes clipboard
 * images through the currently-visible dropzone's mode. Installed
 * once at boot. Does nothing when no dropzone is on screen. */
export function installQrPasteListener(): void {
  if (pasteListenerInstalled || typeof window === 'undefined') {
    return;
  }
  pasteListenerInstalled = true;
  window.addEventListener('paste', (e) => {
    const mode = resolveVisibleDropzoneMode();
    if (!mode) {
      return;
    }
    const items = e.clipboardData?.items;
    if (!items) {
      return;
    }
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          e.preventDefault();
          void handleDropzoneBlob(blob, mode);
          return;
        }
      }
    }
  });
}

/** Screenshot-of-a-QR as an input. Renders a label-wrapped
 * `<input type="file">` whose `change` event bubbles to the global
 * action dispatcher (`pairing.dropzone-file`). The window-level
 * paste listener is installed once at boot and routes clipboard
 * images through whichever dropzone is visible. */
export function QrImageDropzone({
  mode = 'pair',
}: {
  mode?: CameraScanMode;
} = {}): preact.JSX.Element {
  return (
    <label style={DROPZONE_STYLE} data-qr-dropzone-mode={mode}>
      Scan from a screenshot (or paste an image)
      <input
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        aria-label="Pick a screenshot of a pairing QR code"
        data-action="pairing.dropzone-file"
        data-action-mode={mode}
      />
    </label>
  );
}

/** Action fragment for the unified registry. Handles the file-input
 * change event that the dropzone fires when the user picks an image.
 * Kept here rather than in `pairing-actions.ts` to avoid a circular
 * import: qr-scan already pulls `submitScannedValue` and
 * `importRecoveryBlob` from pairing-actions. */
export const qrScanActions: Record<
  string,
  (ctx: { data: Record<string, string>; event: Event; element: HTMLElement }) => void
> = {
  'pairing.dropzone-file': (ctx) => {
    const mode = ctx.data.mode;
    if (mode !== 'pair' && mode !== 'recovery') {
      return;
    }
    const input = ctx.event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    const scoped: CameraScanMode = mode;
    void handleDropzoneBlob(file, scoped).finally(() => {
      input.value = '';
    });
  },
};
