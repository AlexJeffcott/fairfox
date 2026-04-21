// Client-side router for the unified fairfox SPA. Single signal
// (`currentPath`) reflects `window.location.pathname`; `navigate()`
// updates the signal + pushes a History entry; a popstate listener
// keeps the signal in sync with browser Back/Forward.
//
// Links inside the app use `<a href="/…" data-action="app.navigate">`
// so middle-click / command-click / screenreaders still see a real
// hyperlink while ordinary clicks route client-side without a
// full-page reload. The `app.navigate` handler calls
// `event.preventDefault()` to suppress the browser navigation.

import { signal } from '@preact/signals';

type HandlerContext = {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
};

const initialPath = typeof window === 'undefined' ? '/' : window.location.pathname;

export const currentPath = signal<string>(initialPath);

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    currentPath.value = window.location.pathname;
  });
}

export function navigate(path: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (path === currentPath.value) {
    return;
  }
  window.history.pushState(null, '', path);
  currentPath.value = path;
}

export const routerActions: Record<string, (ctx: HandlerContext) => void> = {
  'app.navigate': (ctx) => {
    const href = ctx.data.href;
    if (!href) {
      return;
    }
    // Preserve modifier-click semantics: if the user is opening a new
    // tab / window, let the browser handle the navigation normally.
    const event = ctx.event;
    if (event instanceof MouseEvent) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1) {
        return;
      }
    }
    event.preventDefault();
    navigate(href);
  },
};
