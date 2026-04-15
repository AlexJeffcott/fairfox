// Register happy-dom globals so bun test can manipulate a real DOM.
//
// Imported for side effects at the top of any test file that touches
// document, window, or HTMLElement. Idempotent — calling register twice
// is a no-op.

import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!('document' in globalThis)) {
  GlobalRegistrator.register();
}
