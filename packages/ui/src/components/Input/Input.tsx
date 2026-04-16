/** @jsxImportSource preact */
// Input primitive for @fairfox/ui.
//
// The Input swaps between a view mode that renders markdown (or plain
// text) and an edit mode that shows the raw value in an <input> or
// <textarea>. Clicking or focusing the view transitions to edit;
// committing via the configured save policy transitions back. The
// rendered view element and the edit element share font, padding,
// border width, and line-height so switching between them produces no
// layout shift — the text stays exactly where it was.
//
// The Input refuses to accept onClick, onChange, onSubmit, or onBlur
// props from consumers. Saves are dispatched through the global
// action registry via the DispatchContext, not via callback props.
// When the user commits an edit (on blur, Enter, Cmd+Enter, or an
// explicit save trigger depending on saveOn), the Input builds an
// ActionDispatch with { action, data: { value } } and hands it to the
// dispatch function from context. The sub-app's action handler runs
// the mutation and updates whatever Polly store owns the source
// signal; the Input optimistically switches to view mode immediately.
//
// Optimistic rollback on save failure is deferred to v1.5. For now the
// Input trusts the handler and the consuming store should surface
// errors via its own toast or notification path. See ADR 0005 for the
// rationale and the plan at docs/plans/ui-bootstrap.md for the
// intentional scope cut.
//
// Markdown rendering uses marked for parsing and DOMPurify for
// sanitisation. Pasted content, external images, and javascript:
// URLs are stripped before insertion. The markdown subset is GFM by
// default (tables, task lists, strikethrough, autolinks). Consumers
// that want plain text pass markdown={false}.

import type { Signal } from '@preact/signals';
import { useSignal, useSignalEffect } from '@preact/signals';
import { clsx } from 'clsx';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { JSX } from 'preact';
import { useContext, useRef } from 'preact/hooks';
import { DispatchContext } from '../../context.ts';
import { collectHTMLAttrs, type HTMLPassthroughProps } from '../../utils/html-attrs.ts';
import classes from './Input.module.css';

export type InputVariant = 'single' | 'multi';
export type InputSaveOn = 'blur' | 'explicit' | 'enter' | 'cmd-enter';

export type InputProps = HTMLPassthroughProps & {
  id?: string;
  value: string | Signal<string>;
  variant?: InputVariant;
  action: string;
  saveOn?: InputSaveOn;
  placeholder?: string;
  readonly?: boolean;
  disabled?: boolean;
  className?: string;
  markdown?: boolean;
};

function isSignal(value: unknown): value is Signal<string> {
  return typeof value === 'object' && value !== null && 'value' in value && 'peek' in value;
}

function readValue(value: string | Signal<string>): string {
  return isSignal(value) ? value.value : value;
}

function renderMarkdown(value: string): string {
  const html = marked.parse(value, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

export function Input(props: InputProps) {
  const {
    id,
    value,
    variant = 'single',
    action,
    saveOn = 'blur',
    placeholder,
    readonly = false,
    disabled = false,
    className,
    markdown = true,
  } = props;

  const dispatch = useContext(DispatchContext);
  const isEditing = useSignal(false);
  const draftValue = useSignal(readValue(value));
  const editRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useSignalEffect(() => {
    if (!isEditing.value) {
      draftValue.value = readValue(value);
    }
  });

  const enterEdit = (): void => {
    if (readonly || disabled) {
      return;
    }
    draftValue.value = readValue(value);
    isEditing.value = true;
    queueMicrotask(() => {
      editRef.current?.focus();
    });
  };

  const cancelEdit = (): void => {
    isEditing.value = false;
    draftValue.value = readValue(value);
  };

  const commitEdit = (): void => {
    const el = editRef.current;
    if (!el || !dispatch) {
      isEditing.value = false;
      return;
    }
    const committed = draftValue.value;
    const event = new CustomEvent('fairfox:input-save', {
      bubbles: false,
      detail: { value: committed },
    });
    dispatch({
      action,
      element: el,
      event,
      data: { value: committed },
    });
    isEditing.value = false;
  };

  const handleInput = (e: JSX.TargetedInputEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    draftValue.value = e.currentTarget.value;
  };

  const handleKeyDown = (
    e: JSX.TargetedKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
      return;
    }
    const isEnter = e.key === 'Enter';
    const isModified = e.metaKey || e.ctrlKey;
    if (saveOn === 'enter' && isEnter && !e.shiftKey && !isModified) {
      e.preventDefault();
      commitEdit();
      return;
    }
    if (saveOn === 'cmd-enter' && isEnter && isModified) {
      e.preventDefault();
      commitEdit();
    }
  };

  const handleBlur = (): void => {
    if (saveOn === 'blur') {
      commitEdit();
    }
  };

  const handleViewKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enterEdit();
    }
  };

  const htmlAttrs = collectHTMLAttrs(props);
  const sourceValue = readValue(value);

  const baseClass = clsx(
    classes.input,
    variant === 'single' && classes.single,
    variant === 'multi' && classes.multi,
    disabled && classes.disabled,
    readonly && classes.readonly,
    className
  );

  if (isEditing.value) {
    const editClass = clsx(baseClass, classes.edit);
    if (variant === 'multi') {
      return (
        <textarea
          {...htmlAttrs}
          id={id}
          ref={editRef as preact.RefObject<HTMLTextAreaElement>}
          className={editClass}
          value={draftValue.value}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readonly}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
      );
    }
    return (
      <input
        {...htmlAttrs}
        id={id}
        ref={editRef as preact.RefObject<HTMLInputElement>}
        type="text"
        className={editClass}
        value={draftValue.value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readonly}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    );
  }

  const viewClass = clsx(baseClass, classes.view);
  const isEmpty = sourceValue.length === 0;

  const isInteractive = !readonly && !disabled;
  const interactiveProps = isInteractive
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: enterEdit,
        onKeyDown: handleViewKeyDown,
      }
    : {};

  if (isEmpty) {
    return (
      <div
        {...htmlAttrs}
        id={id}
        className={clsx(viewClass, classes.placeholder)}
        {...interactiveProps}
      >
        {placeholder ?? ''}
      </div>
    );
  }

  if (markdown) {
    const html = renderMarkdown(sourceValue);
    return (
      <div
        {...htmlAttrs}
        id={id}
        className={viewClass}
        {...interactiveProps}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <div {...htmlAttrs} id={id} className={viewClass} {...interactiveProps}>
      {sourceValue}
    </div>
  );
}
