import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { membersApi } from '../api/endpoints';
import type { Ref } from '../types/api';
import { useDebounced } from '../hooks/useDebounced';
import { Spinner } from './ui';

/**
 * Pick an existing AB by number or name. Only existing members can be chosen,
 * which keeps Sponsor / Proposer references valid.
 */
export function MemberPicker({
  value,
  onChange,
  placeholder = 'Search AB number or name',
  id,
  exclude,
  invalid,
}: {
  value: Ref | null;
  onChange: (v: Ref | null) => void;
  placeholder?: string;
  id?: string;
  exclude?: string;
  invalid?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q.trim(), 200);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  const hits = useQuery({
    queryKey: ['search', dq],
    queryFn: () => membersApi.search(dq),
    enabled: open && dq.length > 0,
    staleTime: 30_000,
  });
  const items = (hits.data ?? []).filter((h) => h.abNumber !== exclude);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  useEffect(() => setActive(0), [dq]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 min-h-10 rounded-lg border border-line-strong bg-leaf-soft/50 px-3">
        <span className="min-w-0 truncate">
          <span className="font-medium">{value.name}</span> <span className="text-muted num">· {value.abNumber}</span>
        </span>
        <button type="button" className="text-muted hover:text-ink p-1" onClick={() => onChange(null)} aria-label="Clear selection">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  const choose = (r: Ref) => {
    onChange({ abNumber: r.abNumber, name: r.name });
    setQ('');
    setOpen(false);
  };

  return (
    <div className="relative" ref={box}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint pointer-events-none" />
      <input
        id={id}
        className={clsx('input pl-9', invalid && 'border-danger')}
        placeholder={placeholder}
        value={q}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        inputMode="search"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && items[active]) {
            e.preventDefault();
            choose(items[active]);
          }
        }}
      />
      {open && dq.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-line bg-surface shadow-lg py-1">
          {hits.isLoading && (
            <li className="px-3 py-2 flex items-center gap-2 text-sm text-muted">
              <Spinner className="size-4" /> Searching…
            </li>
          )}
          {!hits.isLoading && items.length === 0 && <li className="px-3 py-2 text-sm text-muted">No AB matches “{dq}”</li>}
          {items.map((h, i) => (
            <li
              key={h.abNumber}
              role="option"
              aria-selected={i === active}
              className={clsx('px-3 py-2 cursor-pointer text-sm flex justify-between gap-3', i === active ? 'bg-paper' : '')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(h);
              }}
            >
              <span className="truncate font-medium">{h.name}</span>
              <span className="num text-muted">{h.abNumber}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
