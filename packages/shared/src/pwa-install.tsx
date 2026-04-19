/** @jsxImportSource preact */
// PwaInstallPrompt — a small affordance that appears when the browser is
// willing to install fairfox as a PWA and disappears otherwise.
//
// Chromium fires `beforeinstallprompt` on pages that satisfy the install
// criteria. The default UI for that event is the browser's own install
// menu entry, which the user has to hunt for. Intercepting the event and
// exposing our own button puts the install option where it belongs — on
// the fairfox home or login page, right alongside "pair a device" and
// "download CLI" — and keeps the browser's default prompt suppressed
// until the user asks for it.
//
// The component renders nothing when the event has not fired (the app is
// already installed, the browser does not qualify the page, or the user
// already dismissed). The install button calls the deferred prompt and
// clears the signal afterwards; Chrome refuses to reprompt within the
// same page load, so holding onto the deferred prompt beyond one use is
// pointless.

import { Button } from '@fairfox/polly/ui';
import { signal, useSignalEffect } from '@preact/signals';

interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt(): Promise<void>;
}

const deferredPrompt = signal<BeforeInstallPromptEvent | null>(null);
const installed = signal<boolean>(false);

function isBeforeInstallPromptEvent(event: Event): event is BeforeInstallPromptEvent {
  return 'prompt' in event && typeof (event as { prompt?: unknown }).prompt === 'function';
}

export function PwaInstallPrompt(): preact.JSX.Element | null {
  useSignalEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const onBeforeInstall = (e: Event): void => {
      if (!isBeforeInstallPromptEvent(e)) {
        return;
      }
      e.preventDefault();
      deferredPrompt.value = e;
    };
    const onInstalled = (): void => {
      installed.value = true;
      deferredPrompt.value = null;
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });

  const prompt = deferredPrompt.value;
  if (!prompt || installed.value) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 'var(--polly-space-md)',
        padding: 'var(--polly-space-md)',
        border: '1px solid var(--polly-border)',
        borderRadius: 'var(--polly-radius-md)',
        background: 'var(--polly-surface-sunken)',
      }}
    >
      <div style={{ fontSize: 'var(--polly-text-sm)', marginBottom: 'var(--polly-space-xs)' }}>
        Install fairfox as an app on this device.
      </div>
      <Button label="Install fairfox" tier="primary" size="small" data-action="pwa.install" />
    </div>
  );
}

/**
 * Action handler for the install button. Exported so consumers can mix it
 * into their action registry — `{...pwaInstallActions}` sits next to
 * `{...pairingActions}` in home/boot.tsx.
 */
export const pwaInstallActions: Record<string, () => void> = {
  'pwa.install': () => {
    const prompt = deferredPrompt.value;
    if (!prompt) {
      return;
    }
    void prompt.prompt().then(() => {
      deferredPrompt.value = null;
    });
  },
};
