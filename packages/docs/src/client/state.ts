// Docs state — research notes, long-form writeups, and project-scoped
// documents. Distinct from library (which is The Struggle's world
// bible) and from todo captures (which are short inbox items).
//
// A document has a stable slug for URL-friendly reference, a title for
// display, a markdown body, and an optional project pid it belongs to
// — so a coding project with a research component can gather its
// notes on one place without inflating the project notes field.

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';
import { signal } from '@preact/signals';

export type DocsView = 'list' | 'edit';

export const activeView = signal<DocsView>('list');
export const selectedDocId = signal<string | null>(null);
export const filterProject = signal<string>('');
export const searchQuery = signal<string>('');

export interface Document {
  [key: string]: unknown;
  id: string;
  title: string;
  slug: string;
  body: string;
  project: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocsDoc {
  [key: string]: unknown;
  docs: Document[];
}

export const docsState = $meshState<DocsDoc>('docs:main', { docs: [] });

/** Slugify a title in the same shape the legacy /todo/documents
 * table used: lowercase, hyphen-separated, alphanumeric only. Used
 * by item.create to produce a default slug; the edit form lets the
 * user override. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Ensure slug is unique within the docs doc by appending -2, -3, …
 * Used when creating a doc whose title slugifies into something
 * already taken. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}
