/** @jsxImportSource preact */
// Unified SPA root. Phase 1 renders only the hub — the route switch
// lands `/` on `<Home/>` and anything else on a placeholder. Phase 2
// will add per-route branches for `/todo-v2`, `/agenda`, `/library`,
// `/speakwell`, `/family-phone-admin`, and `/the-struggle`, each
// importing that sub-app's `<App>` component as a route.
//
// MeshGate wraps the whole thing so the pairing login appears once
// for unpaired devices regardless of which URL they land on.

import { MeshGate } from '@fairfox/shared/mesh-gate';
import { Home } from '#src/client/Home.tsx';
import { currentPath } from '#src/client/router.ts';

export function App(): preact.JSX.Element {
  const path = currentPath.value;
  return <MeshGate>{path === '/' ? <Home /> : <NotYetWired path={path} />}</MeshGate>;
}

function NotYetWired({ path }: { path: string }): preact.JSX.Element {
  return (
    <div style={{ padding: 'var(--polly-space-xl, 2rem)', textAlign: 'center' }}>
      <p style={{ color: 'var(--polly-text-muted, #57534e)' }}>
        {path} isn't part of the unified shell yet — this is Phase 1 scaffolding.
      </p>
      <a href="/" data-action="app.navigate" data-action-href="/">
        ← Back to the hub
      </a>
    </div>
  );
}
