/** @jsxImportSource preact */
// Unit tests for the Input primitive.
//
// Renders the component inside a DispatchContext.Provider with a mock
// dispatch function and inspects the resulting DOM. Tests cover:
//
// - View mode rendering (plain, markdown, empty placeholder)
// - Edit mode rendering (single-line input, multi-line textarea)
// - The view-to-edit transition on click and keyboard activation
// - Save dispatch via the context function with the correct action
//   and value payload for each saveOn policy (blur, enter, cmd-enter)
// - Escape cancels an edit without dispatching
// - Markdown rendering sanitises dangerous content
// - Signal value binding keeps the draft in sync when the source
//   signal updates while not in edit mode
// - The readonly and disabled states suppress interactivity
// - Signal-driven reactivity is exercised end to end

import { describe, expect, mock, test } from 'bun:test';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { Input } from '../src/components/Input/Input.tsx';
import { DispatchContext, type DispatchFn } from '../src/context.ts';
import type { ActionDispatch } from '../src/event-delegation.ts';

type Harness = {
  container: HTMLElement;
  current: () => HTMLElement;
};

function renderInto(
  node: preact.ComponentChildren,
  dispatch: DispatchFn = () => undefined
): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(<DispatchContext.Provider value={dispatch}>{node}</DispatchContext.Provider>, container);
  const current = (): HTMLElement => {
    const child = container.firstElementChild;
    if (!(child instanceof HTMLElement)) {
      throw new Error('no current child');
    }
    return child;
  };
  return { container, current };
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function clickAndFlush(harness: Harness): Promise<void> {
  harness.current().click();
  await tick();
}

describe('Input — view mode', () => {
  test('renders the source value as plain text when markdown is false', () => {
    const { current } = renderInto(
      <Input value="hello **world**" action="note.save" markdown={false} />
    );
    expect(current().textContent).toBe('hello **world**');
  });

  test('renders markdown when markdown is true (the default)', () => {
    const { current } = renderInto(<Input value="hello **world**" action="note.save" />);
    expect(current().innerHTML).toContain('<strong>world</strong>');
  });

  test('renders a placeholder when the source value is empty', () => {
    const { current } = renderInto(
      <Input value="" action="note.save" placeholder="Add a note..." />
    );
    const el = current();
    expect(el.textContent).toBe('Add a note...');
    expect(el.className).toContain('placeholder');
  });

  test('sanitises dangerous markdown content before rendering', () => {
    const dangerous = 'hello <script>alert("xss")</script> world';
    const { current } = renderInto(<Input value={dangerous} action="note.save" />);
    const el = current();
    expect(el.innerHTML).not.toContain('<script>');
    expect(el.innerHTML).not.toContain('alert');
  });

  test('applies role=button and tabindex when interactive', () => {
    const { current } = renderInto(<Input value="hi" action="note.save" />);
    const el = current();
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
  });

  test('drops role and tabindex when readonly', () => {
    const { current } = renderInto(<Input value="hi" action="note.save" readonly={true} />);
    const el = current();
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('tabindex')).toBeNull();
  });

  test('drops role and tabindex when disabled', () => {
    const { current } = renderInto(<Input value="hi" action="note.save" disabled={true} />);
    const el = current();
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('tabindex')).toBeNull();
  });
});

describe('Input — transition to edit', () => {
  test('clicking the view switches to edit mode with the current value', async () => {
    const harness = renderInto(<Input value="hi" action="note.save" />);
    await clickAndFlush(harness);
    const editEl = harness.current();
    expect(editEl.tagName).toBe('INPUT');
    if (editEl instanceof HTMLInputElement) {
      expect(editEl.value).toBe('hi');
    }
  });

  test('clicking does nothing when readonly', async () => {
    const harness = renderInto(<Input value="hi" action="note.save" readonly={true} />);
    harness.current().click();
    await tick();
    expect(harness.current().tagName).toBe('DIV');
  });

  test('multi variant switches to a <textarea> on edit', async () => {
    const harness = renderInto(<Input value="hello" action="note.save" variant="multi" />);
    await clickAndFlush(harness);
    expect(harness.current().tagName).toBe('TEXTAREA');
  });
});

describe('Input — save dispatch', () => {
  test('commits with the action and current draft value when blur fires under saveOn=blur', async () => {
    const dispatches: ActionDispatch[] = [];
    const dispatch: DispatchFn = (d) => {
      dispatches.push(d);
    };
    const harness = renderInto(<Input value="hi" action="note.save" saveOn="blur" />, dispatch);
    await clickAndFlush(harness);
    const editEl = harness.current();
    if (!(editEl instanceof HTMLInputElement)) {
      throw new Error('expected input');
    }
    editEl.value = 'updated';
    editEl.dispatchEvent(new Event('input', { bubbles: true }));
    editEl.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(dispatches.length).toBe(1);
    const d = dispatches[0];
    if (!d) {
      throw new Error('expected a dispatch');
    }
    expect(d.action).toBe('note.save');
    expect(d.data).toEqual({ value: 'updated' });
  });

  test('Enter commits under saveOn=enter', async () => {
    const fn = mock<DispatchFn>(() => undefined);
    const harness = renderInto(<Input value="hi" action="note.save" saveOn="enter" />, fn);
    await clickAndFlush(harness);
    const editEl = harness.current();
    if (!(editEl instanceof HTMLInputElement)) {
      throw new Error('expected input');
    }
    editEl.value = 'ok';
    editEl.dispatchEvent(new Event('input', { bubbles: true }));
    editEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fn).toHaveBeenCalledTimes(1);
    const call = fn.mock.calls[0];
    if (!call) {
      throw new Error('expected a call');
    }
    const d = call[0];
    expect(d.action).toBe('note.save');
    expect(d.data.value).toBe('ok');
  });

  test('Cmd+Enter commits under saveOn=cmd-enter; plain Enter does not', async () => {
    const fn = mock<DispatchFn>(() => undefined);
    const harness = renderInto(<Input value="hi" action="note.save" saveOn="cmd-enter" />, fn);
    await clickAndFlush(harness);
    const editEl = harness.current();
    if (!(editEl instanceof HTMLInputElement)) {
      throw new Error('expected input');
    }
    editEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fn).toHaveBeenCalledTimes(0);
    editEl.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('Escape cancels without dispatching', async () => {
    const fn = mock<DispatchFn>(() => undefined);
    const harness = renderInto(<Input value="hi" action="note.save" saveOn="blur" />, fn);
    await clickAndFlush(harness);
    const editEl = harness.current();
    if (!(editEl instanceof HTMLInputElement)) {
      throw new Error('expected input');
    }
    editEl.value = 'updated';
    editEl.dispatchEvent(new Event('input', { bubbles: true }));
    editEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fn).toHaveBeenCalledTimes(0);
  });
});

describe('Input — signal binding', () => {
  test('reads the source signal value when given a signal', () => {
    const source = signal('initial');
    const { current } = renderInto(<Input value={source} action="note.save" markdown={false} />);
    expect(current().textContent).toBe('initial');
  });

  test('view mode updates when the source signal updates', async () => {
    const source = signal('before');
    const { current } = renderInto(<Input value={source} action="note.save" markdown={false} />);
    expect(current().textContent).toBe('before');
    source.value = 'after';
    await tick();
    expect(current().textContent).toBe('after');
  });
});
