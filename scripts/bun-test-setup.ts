// Bun test preload: handle things that bun test does not do out of the box.
//
// - CSS module imports (*.module.css) are intercepted and replaced with a
//   Proxy that returns the property name for every access. This lets tests
//   that check className contents assert against the literal class names
//   declared in the CSS module without needing a CSS bundler at test time.
//
// - happy-dom globals are registered so components can render against a
//   real DOM without a per-file import.
//
// Registered via root bunfig.toml: [test] preload = "./scripts/bun-test-setup.ts"

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { plugin } from 'bun';

if (!('document' in globalThis)) {
  GlobalRegistrator.register();
}

plugin({
  name: 'fairfox-css-modules-mock',
  setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, () => ({
      contents: `
const handler = { get: (_target, prop) => (typeof prop === 'string' ? prop : undefined) };
export default new Proxy({}, handler);
      `,
      loader: 'js',
    }));
  },
});
