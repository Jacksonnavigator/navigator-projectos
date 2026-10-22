import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ApiError } from "../lib/api";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong",
  secondary: "border border-line bg-surface text-ink hover:bg-sunken",
  ghost: "text-muted hover:bg-sunken hover:text-ink",
  danger: "bg-bad text-white hover:opacity-90",
};

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; busy?: boolean }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-sm pointer-coarse:h-11" : "h-10 px-4 text-sm pointer-coarse:h-11",
        VARIANTS[variant],
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = "size-5", label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center gap-2">
      <svg className={cx("animate-spin text-current", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
      {label && <span className="text-sm text-muted">{label}</span>}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-sunken", className)} aria-hidden="true" />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function Card({ className, children, title, actions }: {
  className?: string;
  children: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={cx("min-w-0 rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-sunken text-muted",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone])}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const apiErr = error instanceof ApiError ? error : null;
  const forbidden = apiErr?.status === 403;
  const message = apiErr?.message ?? (error instanceof Error ? error.message : "Something went wrong.");
  return (
    <div role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-4 text-sm">
      <p className="font-medium text-bad">{forbidden ? "You don't have access to this." : "This couldn't be loaded."}</p>
      <p className="mt-1 text-ink">{message}</p>
      {apiErr?.requestId && <p className="mt-1 text-xs text-muted">Reference: {apiErr.requestId}</p>}
      {onRetry && !forbidden && (
        <Button size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="text-sm text-bad">
      {message}
    </p>
  );
}

const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none";

export function Field({ label, hint, error, children, id }: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
  id?: string;
}) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={fieldId} className="block text-sm font-medium">
        {label}
      </label>
      {children({ id: fieldId, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error && (
        <p id={`${fieldId}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} className="text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, "pr-8", props.className)} />;
}

export function Modal({ open, onClose, title, children, footer, wide, panel }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Slide-over from the right: for multi-field editing that keeps the page in view. */
  panel?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // showModal() traps focus and restores it to the opener on close.
    if (open && !dialog.open) {
      dialog.showModal?.();
      // showModal focuses the first control (the close button); prefer an explicit default such as Cancel.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clicking the dimmed backdrop (the dialog element itself) closes it.
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      className={cx(
        "border border-line bg-surface p-0 text-ink backdrop:bg-black/50",
        panel
          ? "panel-enter fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-xl rounded-none border-y-0 border-r-0"
          : cx("dialog-enter m-auto w-[calc(100%-2rem)] rounded-lg", wide ? "max-w-3xl" : "max-w-lg"),
      )}
    >
      {open && (
        <div className={cx("flex flex-col", panel ? "h-full" : "max-h-[85vh]")}>
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <IconButton label="Close" shortcut="Esc" onClick={onClose} align="end">
              <path d="M5 5l10 10M15 5L5 15" />
            </IconButton>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel, busy }: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel} data-autofocus="">
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm">{message}</div>
    </Modal>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>;
}

/** Tooltip shown on hover and on keyboard focus (not the native title attribute). */
export function Tooltip({ label, shortcut, children, side = "bottom", align = "center" }: {
  label: string;
  shortcut?: string;
  children: ReactNode;
  side?: "bottom" | "top";
  /** "end" keeps the tooltip inside the container when the control sits at a right edge. */
  align?: "center" | "end";
}) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          "pointer-events-none absolute z-50 hidden items-center gap-1.5 rounded-md border border-line bg-ink px-2 py-1 text-xs whitespace-nowrap text-canvas group-focus-within/tt:flex group-hover/tt:flex",
          side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
          align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
        )}
      >
        {label}
        {shortcut && <kbd className="rounded bg-canvas/20 px-1 font-sans text-xs">{shortcut}</kbd>}
      </span>
    </span>
  );
}

/** Square icon-only button with a real tooltip whose text matches its accessible name. */
export function IconButton({ label, shortcut, children, onClick, className, side, align }: {
  label: string;
  shortcut?: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  side?: "bottom" | "top";
  align?: "center" | "end";
}) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={side} align={align}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-keyshortcuts={shortcut}
        className={cx("grid size-9 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink pointer-coarse:size-11", className)}
      >
        <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {children}
        </svg>
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ toasts */

interface ToastItem {
  id: number;
  message: string;
  tone: "ok" | "bad" | "neutral";
  action?: { label: string; onClick: () => void };
}

let toastItems: ToastItem[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((l) => l());

/** Show a short confirmation ("Task marked done") with an optional action such as Undo. */
export function toast(message: string, opts: { tone?: ToastItem["tone"]; action?: ToastItem["action"] } = {}) {
  const item: ToastItem = { id: ++toastSeq, message, tone: opts.tone ?? "ok", action: opts.action };
  toastItems = [...toastItems.slice(-2), item];
  emitToasts();
  setTimeout(() => dismissToast(item.id), opts.action ? 7000 : 4000);
}

function dismissToast(id: number) {
  toastItems = toastItems.filter((t) => t.id !== id);
  emitToasts();
}

export function Toaster() {
  const items = useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toastItems,
  );
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 left-4 z-[60] flex flex-col items-end gap-2 sm:left-auto" aria-live="polite" role="status">
      {items.map((t) => (
        <div
          key={t.id}
          className="toast-enter pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm shadow-lg"
        >
          <span className={cx("grid size-5 shrink-0 place-items-center rounded-full text-xs", t.tone === "ok" ? "bg-ok-soft text-ok" : t.tone === "bad" ? "bg-bad-soft text-bad" : "bg-sunken text-muted")} aria-hidden="true">
            {t.tone === "ok" ? "✓" : t.tone === "bad" ? "!" : "i"}
          </span>
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="shrink-0 font-medium text-accent hover:underline"
              onClick={() => {
                t.action!.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="shrink-0 rounded px-1 text-muted hover:text-ink" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Form validation timing: an error shows after the field is left (blur) or after a submit attempt,
 * and disappears as soon as the value becomes valid. Submit buttons stay clickable.
 */
export function useValidation<K extends string>(errors: Partial<Record<K, string | undefined>>) {
  const [touched, setTouched] = useState<Partial<Record<K, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const reset = useCallback(() => {
    setTouched({});
    setSubmitted(false);
  }, []);
  return {
    error: (field: K) => ((touched[field] || submitted) ? errors[field] : undefined),
    blur: (field: K) => setTouched((t) => ({ ...t, [field]: true })),
    /** Call on submit; returns true when the form is valid. */
    check: () => {
      setSubmitted(true);
      return Object.values(errors).every((e) => !e);
    },
    reset,
  };
}
