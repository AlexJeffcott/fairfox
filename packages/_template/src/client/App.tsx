/** @jsxImportSource preact */
// Root component for the template sub-app.
//
// Replace this with your own UI. The key patterns to follow:
//   - Import primitives from @fairfox/polly/ui (Button, ActionInput, Layout, etc.)
//   - Declare user actions via data-action attributes, not onClick
//   - Read state from $meshState signals (appState.value)
//   - Layout all multi-element arrangements via <Layout>, never raw flex/grid

import { ActionInput, Button, Layout, Text } from '@fairfox/polly/ui';
import { appState } from '#src/client/state.ts';

export function App() {
  return (
    <Layout rows="auto 1fr" gap="var(--polly-space-lg)" padding="var(--polly-space-lg)">
      <Text as="h1" size="xl" weight="bold">
        Template Sub-App
      </Text>
      <Layout rows="auto" gap="var(--polly-space-md)">
        <ActionInput
          value=""
          variant="single"
          action="item.add"
          saveOn="enter"
          placeholder="Add an item..."
        />
        <Layout as="ul" rows="auto" gap="var(--polly-space-xs)">
          {appState.value.items.map((item, i) => (
            <Layout
              as="li"
              key={`${item}-${String(i)}`}
              columns="1fr auto"
              gap="var(--polly-space-sm)"
              alignItems="center"
            >
              <Text>{item}</Text>
              <Button
                label="Remove"
                tier="tertiary"
                color="danger"
                size="small"
                data-action="item.remove"
                data-action-index={String(i)}
              />
            </Layout>
          ))}
        </Layout>
      </Layout>
    </Layout>
  );
}
