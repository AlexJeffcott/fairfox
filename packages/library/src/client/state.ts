// Library state — references and docs for The Struggle's world bible.

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';

export type RefForm = 'prose' | 'poem';
export type DocCategory = 'world' | 'structure' | 'interface';

export interface Ref {
  [key: string]: unknown;
  id: string;
  title: string;
  author: string;
  form: RefForm;
  tags: string[];
  body: string;
  notes: string;
}

export interface Doc {
  [key: string]: unknown;
  id: string;
  path: string;
  category: DocCategory;
  title: string;
  content: string;
  lastModified: string;
}

export interface LibraryDoc {
  [key: string]: unknown;
  refs: Ref[];
  docs: Doc[];
}

export const libraryState = $meshState<LibraryDoc>('library:main', {
  refs: [],
  docs: [],
});
