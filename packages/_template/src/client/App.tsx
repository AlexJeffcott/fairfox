/** @jsxImportSource preact */
// Root component for the template sub-app.
//
// Replace this with your own UI. The key patterns to follow:
//   - Import primitives from @fairfox/polly/ui (Button, ActionInput, Layout, etc.)
//   - Declare user actions via data-action attributes, not onClick
//   - Read state from $meshState signals (appState.value)
//   - Layout all multi-element arrangements via <Layout>, never raw flex/grid

import { ActionInput, Button, Layout } from '@fairfox/polly/ui';
import { appState } from '#src/client/state.ts';

export function App() {
  return (
    <Layout rows="auto 1fr" gap="var(--polly-space-lg)" padding="var(--polly-space-lg)">
      <h1>Template Sub-App</h1>
      <Layout rows="auto" gap="var(--polly-space-md)">
        <ActionInput
          value=""
          variant="single"
          action="item.add"
          saveOn="enter"
          placeholder="Add an item..."
        />
        <ul>
          {appState.value.items.map((item, i) => (
            <li key={`${item}-${String(i)}`}>
              <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
                <span>{item}</span>
                <Button
                  label="Remove"
                  tier="tertiary"
                  color="danger"
                  size="small"
                  data-action="item.remove"
                  data-action-index={String(i)}
                />
              </Layout>
            </li>
          ))}
        </ul>
      </Layout>
    </Layout>
  );
}
