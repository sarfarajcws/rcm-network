import clsx from 'clsx';
import { CircleAlert, Inbox, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import type { Kyc, Status } from '../types/api';
import { ApiError } from '../api/client';

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={clsx('animate-spin', className ?? 'size-5 text-muted')} aria-hidden />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted" role="status">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  return (
    <div className={clsx('flex flex-col items-center text-center gap-3', compact ? 'py-6' : 'py-14')} role="alert">
      <CircleAlert className="size-6 text-danger" aria-hidden />
      <p className="text-sm text-ink max-w-md">{errorMessage(error)}</p>
      {onRetry && (
        <button className="btn-secondary" onClick={onRetry}>
          <RefreshCw className="size-4" /> Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-12 px-4">
      <Inbox className="size-6 text-faint" aria-hidden />
      <p className="font-semibold">{title}</p>
      {children && <div className="text-sm text-muted max-w-md">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: Status | null }) {
  if (!status) return null;
  return status === 'ACTIVE' ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf-soft px-2 py-0.5 text-xs font-medium text-leaf-dark whitespace-nowrap">
      <span className="size-1.5 rounded-full bg-leaf" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger whitespace-nowrap">
      <span className="size-1.5 rounded-full bg-danger" />
      Terminated
    </span>
  );
}

export function KycBadge({ kyc }: { kyc: Kyc | null }) {
  if (!kyc) return null;
  return kyc === 'OK' ? (
    <span className="inline-flex rounded-full border border-line px-2 py-0.5 text-xs font-medium text-muted whitespace-nowrap">KYC OK</span>
  ) : (
    <span className="inline-flex rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn whitespace-nowrap">KYC not OK</span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 pt-4">
          <div>
            {title && <h2 className="font-semibold">{title}</h2>}
            {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={clsx(bodyClassName ?? 'p-4 sm:p-5')}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-danger mt-1">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-md font-medium transition-colors whitespace-nowrap',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 min-h-8 text-sm',
            value === o.value ? 'bg-forest text-white' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Dialog: centred on desktop, bottom sheet on phones. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-forest/40" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={clsx(
          'relative w-full bg-surface shadow-xl flex flex-col max-h-[92dvh] rounded-t-2xl sm:rounded-2xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
          <h2 id={id} className="font-semibold text-lg">
            {title}
          </h2>
          <button data-close className="btn-ghost !px-2" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-line pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger' | 'success'; children: ReactNode }) {
  const cls = {
    info: 'bg-paper border-line text-ink',
    warn: 'bg-warn-soft border-warn/20 text-ink',
    danger: 'bg-danger-soft border-danger/20 text-danger',
    success: 'bg-leaf-soft border-leaf/20 text-leaf-dark',
  }[tone];
  return <div className={clsx('rounded-lg border px-3.5 py-2.5 text-sm', cls)}>{children}</div>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line text-sm">
      <span className="text-muted num">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary !min-h-9" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn-secondary !min-h-9" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
