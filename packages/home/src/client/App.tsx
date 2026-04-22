/** @jsxImportSource preact */
// Unified SPA root. Route switch wrapped in MeshGate so the pairing
// login appears once for unpaired devices regardless of which URL
// they land on. Each mesh sub-app's `<App>` component plugs in here
// as a route; Phase 2 is migrating them one at a time.

import { MeshGate } from '@fairfox/shared/mesh-gate';
import { App as TodoApp } from '@fairfox/todo-v2/client';
import { Home } from '#src/client/Home.tsx';
import { currentPath } from '#src/client/router.ts';

export function App(): preact.JSX.Element {
  return (
    <MeshGate>
      <RouteView />
    </MeshGate>
  );
}

function RouteView(): preact.JSX.Element {
  const path = currentPath.value;
  if (path === '/') {
    return <Home />;
  }
  if (path === '/todo-v2') {
    return <TodoApp />;
  }
  return <NotYetWired path={path} />;
}

function NotYetWired({ path }: { path: string }): preact.JSX.Element {
  return (
    <div style={{ padding: 'var(--polly-space-xl, 2rem)', textAlign: 'center' }}>
      <p style={{ color: 'var(--polly-text-muted, #57534e)' }}>
        {path} isn't part of the unified shell yet — this is Phase 2 in progress.
      </p>
      <a href="/" data-action="app.navigate" data-action-href="/">
        ← Back to the hub
      </a>
    </div>
  );
}
