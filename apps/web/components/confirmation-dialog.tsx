'use client';

import { useEffect, useId, useRef } from 'react';

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ConfirmationDialog({
  open,
  title,
  description,
  details,
  confirmLabel,
  pending = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelButtonRef.current?.focus();

    return () => {
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !pending) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog-card confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <div>
          <p className="hero-eyebrow">影响范围确认</p>
          <h2 id={titleId} className="card-title">{title}</h2>
          <p id={descriptionId} className="subtle">{description}</p>
        </div>

        {details?.length ? (
          <ul className="confirmation-impact-list">
            {details.map((detail) => <li key={detail}>{detail}</li>)}
          </ul>
        ) : null}

        <div className="inline-actions confirmation-dialog-actions">
          <button
            ref={cancelButtonRef}
            className="button secondary small"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="button small"
            type="button"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? '正在创建后台任务…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
