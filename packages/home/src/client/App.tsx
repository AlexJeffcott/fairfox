/** @jsxImportSource preact */
// Unified SPA root. Route switch wrapped in MeshGate so the pairing
// login appears once for unpaired devices regardless of which URL
// they land on. Every mesh sub-app's `<App>` component plugs in
// here as a route — the per-sub-app HTML shells and boot.tsx files
// will be retired in Phase 3 once the server-side cutover lands.

import { App as AgendaApp } from '@fairfox/agenda/client';
import { App as ChatApp } from '@fairfox/chat/client';
import { App as DocsApp } from '@fairfox/docs/client';
import { App as FamilyPhoneApp } from '@fairfox/family-phone-admin/client';
import { App as LibraryApp } from '@fairfox/library/client';
import { MeshGate } from '@fairfox/shared/mesh-gate';
import { App as SpeakwellApp } from '@fairfox/speakwell/client';
import { App as TheStruggleApp } from '@fairfox/the-struggle/client';
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
  if (path === '/agenda') {
    return <AgendaApp />;
  }
  if (path === '/library') {
    return <LibraryApp />;
  }
  if (path === '/docs') {
    return <DocsApp />;
  }
  if (path === '/chat') {
    return <ChatApp />;
  }
  if (path === '/family-phone-admin') {
    return <FamilyPhoneApp />;
  }
  if (path === '/speakwell') {
    return <SpeakwellApp />;
  }
  if (path === '/the-struggle') {
    return <TheStruggleApp />;
  }
  return <NotFound path={path} />;
}

function NotFound({ path }: { path: string }): preact.JSX.Element {
  return (
    <div style={{ padding: 'var(--polly-space-xl, 2rem)', textAlign: 'center' }}>
      <p style={{ color: 'var(--polly-text-muted, #57534e)' }}>No sub-app mounted at {path}.</p>
      <a href="/" data-action="app.navigate" data-action-href="/">
        ← Back to the hub
      </a>
    </div>
  );
}
