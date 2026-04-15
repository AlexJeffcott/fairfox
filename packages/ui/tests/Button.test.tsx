/** @jsxImportSource preact */
// Unit tests for the Button primitive.
//
// Renders the component into a happy-dom container via preact and then
// inspects the resulting DOM. The tests cover variant rendering, the
// button-vs-link switch on href, the disabled state, and — most
// importantly — that data-action and data-action-* attributes reach the
// underlying element so the global delegator can pick them up.
//
// The root bunfig preload at scripts/bun-test-setup.ts registers
// happy-dom globals and the CSS module Proxy so the imports resolve
// cleanly without additional per-file setup.

import { describe, expect, test } from 'bun:test';
import { render } from 'preact';
import { Button } from '../src/components/Button/Button.tsx';

function renderInto(node: preact.ComponentChildren): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(node, container);
  const child = container.firstElementChild;
  if (!(child instanceof HTMLElement)) {
    throw new Error('render did not produce an HTMLElement');
  }
  return child;
}

describe('Button', () => {
  test('renders as a <button> with type=button by default', () => {
    const el = renderInto(<Button label="Save" />);
    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('type')).toBe('button');
    expect(el.textContent).toBe('Save');
  });

  test('applies the secondary tier by default', () => {
    const el = renderInto(<Button label="Go" />);
    expect(el.className).toContain('btn');
    expect(el.className).toContain('tierSecondary');
  });

  test('applies the primary tier when tier="primary" is set', () => {
    const el = renderInto(<Button label="Go" tier="primary" />);
    expect(el.className).toContain('tierPrimary');
    expect(el.className).not.toContain('tierSecondary');
  });

  test('applies the size modifier when size="small" is set', () => {
    const el = renderInto(<Button label="Go" size="small" />);
    expect(el.className).toContain('btnSmall');
  });

  test('applies the colour modifier when color is not default', () => {
    const el = renderInto(<Button label="Go" color="error" />);
    expect(el.className).toContain('colorError');
  });

  test('applies fullWidth and circle modifiers when requested', () => {
    const el = renderInto(<Button label="x" fullWidth={true} circle={true} />);
    expect(el.className).toContain('btnFullWidth');
    expect(el.className).toContain('btnCircle');
  });

  test('renders as an <a> when href is provided', () => {
    const el = renderInto(<Button label="Docs" href="/docs" />);
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/docs');
    expect(el.getAttribute('type')).toBeNull();
  });

  test('drops href when the link form is disabled', () => {
    const el = renderInto(<Button label="Docs" href="/docs" disabled={true} />);
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBeNull();
    expect(el.getAttribute('aria-disabled')).toBe('true');
  });

  test('sets the disabled attribute on the button form', () => {
    const el = renderInto(<Button label="Save" disabled={true} />);
    expect(el.tagName).toBe('BUTTON');
    expect((el as HTMLButtonElement).disabled).toBe(true);
  });

  test('forwards data-action to the rendered element', () => {
    const el = renderInto(<Button label="Save" data-action="task.save" />);
    expect(el.getAttribute('data-action')).toBe('task.save');
  });

  test('forwards arbitrary data-action-* payload attributes', () => {
    const el = renderInto(
      <Button label="Save" data-action="task.save" data-action-id="42" data-action-body="hello" />
    );
    expect(el.getAttribute('data-action-id')).toBe('42');
    expect(el.getAttribute('data-action-body')).toBe('hello');
  });

  test('forwards aria-* attributes', () => {
    const el = renderInto(<Button label="x" aria-label="close dialog" />);
    expect(el.getAttribute('aria-label')).toBe('close dialog');
  });

  test('applies the extra className alongside the typed classes', () => {
    const el = renderInto(<Button label="x" className="custom-extra" />);
    expect(el.className).toContain('btn');
    expect(el.className).toContain('custom-extra');
  });

  test('renders the label content as children', () => {
    const el = renderInto(
      <Button
        label={
          <>
            <span class="emoji">💾</span>
            <span>Save</span>
          </>
        }
      />
    );
    expect(el.querySelector('.emoji')?.textContent).toBe('💾');
    expect(el.textContent).toContain('Save');
  });
});
