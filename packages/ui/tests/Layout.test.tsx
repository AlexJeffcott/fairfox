/** @jsxImportSource preact */
// Unit tests for the Layout primitive.
//
// Layout is a special primitive: it is the only place in @fairfox/ui
// where flex and grid CSS properties are allowed. The ban is enforced
// separately by scripts/check-layout-ban.ts. These tests cover that
// the component renders a div, applies the layout class, forwards
// children, forwards data/aria attributes, and maps its props onto the
// CSS custom properties that the module consumes.

import { describe, expect, test } from 'bun:test';
import { render } from 'preact';
import { Layout } from '../src/components/Layout/Layout.tsx';

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

describe('Layout', () => {
  test('renders a <div> with the layout class', () => {
    const el = renderInto(<Layout>hi</Layout>);
    expect(el.tagName).toBe('DIV');
    expect(el.className).toContain('layout');
    expect(el.textContent).toBe('hi');
  });

  test('forwards children', () => {
    const el = renderInto(
      <Layout>
        <span>a</span>
        <span>b</span>
      </Layout>
    );
    expect(el.querySelectorAll('span').length).toBe(2);
  });

  test('maps columns prop onto the --l-cols custom property', () => {
    const el = renderInto(<Layout columns="auto 1fr auto">x</Layout>);
    expect(el.style.getPropertyValue('--l-cols')).toBe('auto 1fr auto');
  });

  test('maps rows prop onto the --l-rows custom property', () => {
    const el = renderInto(<Layout rows="auto">x</Layout>);
    expect(el.style.getPropertyValue('--l-rows')).toBe('auto');
  });

  test('maps gap prop onto the --l-gap custom property', () => {
    const el = renderInto(<Layout gap="0.5em">x</Layout>);
    expect(el.style.getPropertyValue('--l-gap')).toBe('0.5em');
  });

  test('maps padding prop onto the --l-padding custom property', () => {
    const el = renderInto(<Layout padding="var(--space-md)">x</Layout>);
    expect(el.style.getPropertyValue('--l-padding')).toBe('var(--space-md)');
  });

  test('maps align prop onto the --l-align custom property', () => {
    const el = renderInto(<Layout align="center">x</Layout>);
    expect(el.style.getPropertyValue('--l-align')).toBe('center');
  });

  test('maps justify prop onto the --l-justify custom property', () => {
    const el = renderInto(<Layout justify="space-between">x</Layout>);
    expect(el.style.getPropertyValue('--l-justify')).toBe('space-between');
  });

  test('applies the inline modifier class when inline is true', () => {
    const el = renderInto(<Layout inline={true}>x</Layout>);
    expect(el.className).toContain('inline');
  });

  test('applies the fullWidth and fullHeight modifier classes', () => {
    const el = renderInto(
      <Layout fullWidth={true} fullHeight={true}>
        x
      </Layout>
    );
    expect(el.className).toContain('fullWidth');
    expect(el.className).toContain('fullHeight');
  });

  test('forwards data-* and aria-* attributes', () => {
    const el = renderInto(
      <Layout data-testid="grid" aria-label="a grid">
        x
      </Layout>
    );
    expect(el.getAttribute('data-testid')).toBe('grid');
    expect(el.getAttribute('aria-label')).toBe('a grid');
  });

  test('applies extra className alongside the typed class', () => {
    const el = renderInto(<Layout className="custom">x</Layout>);
    expect(el.className).toContain('layout');
    expect(el.className).toContain('custom');
  });
});
