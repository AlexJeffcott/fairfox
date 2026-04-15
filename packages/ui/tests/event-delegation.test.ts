// Unit tests for the pure functions in event-delegation.
//
// The installer function uses document-level listeners and is covered by
// integration tests that live alongside the components that mount it. The
// pure functions — parseActionData and resolveAction — can be tested
// against synthetic DOM nodes built with happy-dom's globalThis.

import './setup-dom.ts';
import { describe, expect, test } from 'bun:test';
import { parseActionData, resolveAction } from '../src/event-delegation.ts';

function makeElement(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  const child = container.firstElementChild;
  if (!(child instanceof HTMLElement)) {
    throw new Error('test setup expected an HTMLElement');
  }
  return child;
}

describe('parseActionData', () => {
  test('returns an empty object when no data-action-* attributes are present', () => {
    const el = makeElement('<button data-action="noop">click</button>');
    expect(parseActionData(el)).toEqual({});
  });

  test('collects data-action-* attributes into camelCase keys', () => {
    const el = makeElement(
      '<button data-action="task.save" data-action-id="42" data-action-body="hello">x</button>'
    );
    expect(parseActionData(el)).toEqual({ id: '42', body: 'hello' });
  });

  test('converts kebab-case suffixes to camelCase', () => {
    const el = makeElement(
      '<button data-action="x" data-action-entity-id="99" data-action-parent-slug="foo-bar">x</button>'
    );
    expect(parseActionData(el)).toEqual({ entityId: '99', parentSlug: 'foo-bar' });
  });

  test('ignores attributes that are not data-action-*', () => {
    const el = makeElement(
      '<button data-action="x" data-foo="ignore" aria-label="ignore" data-action-id="3">x</button>'
    );
    expect(parseActionData(el)).toEqual({ id: '3' });
  });
});

describe('resolveAction', () => {
  test('returns null when the event target is not an element', () => {
    const event = new Event('click');
    expect(resolveAction(event)).toBeNull();
  });

  test('returns null when no ancestor has a data-action attribute', () => {
    const el = makeElement('<div><span>child</span></div>');
    document.body.appendChild(el);
    const child = el.querySelector('span');
    if (!child) {
      throw new Error('test setup failed');
    }
    const event = new Event('click', { bubbles: true });
    child.dispatchEvent(event);
    expect(resolveAction(event)).toBeNull();
    document.body.removeChild(el);
  });

  test('finds the nearest data-action ancestor and returns its parsed dispatch', () => {
    const el = makeElement(
      '<button data-action="task.save" data-action-id="7"><span class="label">Save</span></button>'
    );
    document.body.appendChild(el);
    const span = el.querySelector('span');
    if (!span) {
      throw new Error('test setup failed');
    }
    const event = new Event('click', { bubbles: true });
    span.dispatchEvent(event);
    const dispatch = resolveAction(event);
    expect(dispatch).not.toBeNull();
    if (dispatch) {
      expect(dispatch.action).toBe('task.save');
      expect(dispatch.data).toEqual({ id: '7' });
      expect(dispatch.element).toBe(el);
    }
    document.body.removeChild(el);
  });

  test('skips click events on forms so form actions only fire on submit', () => {
    const el = makeElement(
      '<form data-action="team.create"><button type="button">inside</button></form>'
    );
    document.body.appendChild(el);
    const button = el.querySelector('button');
    if (!button) {
      throw new Error('test setup failed');
    }
    const clickEvent = new Event('click', { bubbles: true });
    button.dispatchEvent(clickEvent);
    expect(resolveAction(clickEvent)).toBeNull();

    const submitEvent = new Event('submit', { bubbles: true });
    el.dispatchEvent(submitEvent);
    const dispatch = resolveAction(submitEvent);
    expect(dispatch).not.toBeNull();
    if (dispatch) {
      expect(dispatch.action).toBe('team.create');
    }
    document.body.removeChild(el);
  });

  test('returns null when data-action is present but empty', () => {
    const el = makeElement('<button data-action=""></button>');
    document.body.appendChild(el);
    const event = new Event('click', { bubbles: true });
    el.dispatchEvent(event);
    expect(resolveAction(event)).toBeNull();
    document.body.removeChild(el);
  });
});
