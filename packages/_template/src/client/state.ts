// Sub-app state — replace this with your own $meshState documents.
//
// Each $meshState call creates an Automerge CRDT document that syncs
// across every paired device in the family. The document key must be
// globally unique across all fairfox sub-apps (prefix with the sub-app
// name to avoid collisions). The initial value is used when no existing
// document is found in the Repo.
//
// The `loaded` promise resolves once the document has been hydrated from
// the local Automerge Repo. Await it before reading `.value` to avoid
// seeing the initial value when the real data is about to arrive.

import { $meshState } from '@fairfox/polly/mesh';

export interface AppDoc {
  [key: string]: unknown;
  items: string[];
}

export const appState = $meshState<AppDoc>('template:app', { items: [] });
