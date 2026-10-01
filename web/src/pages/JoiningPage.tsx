import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Search, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { joiningsApi } from '../api/endpoints';
import { EmptyState, ErrorState, Loading, PageHeader, Section, Segmented, Spinner, StatusBadge } from '../components/ui';
import { useDebounced } from '../hooks/useDebounced';
import { currentIstMonthKey, fmtDate, fmtInt, monthLabel } from '../utils/format';

export function JoiningPage() {
  const [sp, setSp] = useSearchParams();
  const months = useQuery({ queryKey: ['joining-months'], queryFn: joiningsApi.months });
  const current = currentIstMonthKey();
  const monthList = [...new Set([current, ...(months.data ?? [])])].sort().reverse();
  const mode = sp.get('from') ? 'range' : 'month';
  const month = sp.get('month') ?? months.data?.[0] ?? current;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const proposer = sp.get('proposer') ?? '';
  const includeUnmapped = sp.get('unmapped') !== 'no';
  const [qInput, setQInput] = useState(sp.get('q') ?? '');
  const q = useDebounced(qInput.trim(), 300);

  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    setSp(n, { replace: true });
  };

  const params = mode === 'range' && from && to ? { from, to } : { month };
  const list = useQuery({
    queryKey: ['joinings', params, proposer, q, includeUnmapped],
    queryFn: () => joiningsApi.list({ ...params, proposer: proposer || undefined, q: q || undefined, includeUnmapped }),
    placeholderData: keepPreviousData,
    enabled: mode === 'month' || Boolean(from && to),
  });
  const trend = useQuery({ queryKey: ['joining-trend', current], queryFn: () => joiningsApi.trend(current, 12) });
  const maxTrend = Math.max(1, ...(trend.data ?? []).map((t) => t.count));
  const proposerName = list.data?.byProposer.find((b) => b.proposerAbNumber === proposer)?.proposerName;

  return (
    <div className="grid gap-4">
      <PageHeader title="Joining" description="Joining date is the Smart Report’s Feeding Date. Each joining is credited to its Proposer." />

      <Section title="Last 12 months" bodyClassName="px-4 sm:px-5 pb-4 pt-3">
        <div className="flex items-end gap-1.5 h-24">
          {(trend.data ?? []).map((t) => (
            <button
              key={t.month}
              onClick={() => set({ month: t.month, from: null, to: null })}
              className="flex-1 flex flex-col items-center justify-end h-full gap-1 group"
              title={`${monthLabel(t.month)}: ${t.count} joinings`}
            >
              <span className="text-[10px] num text-muted">{t.count || ''}</span>
              <span
                className={clsx('w-full rounded-t', mode === 'month' && t.month === month ? 'bg-leaf' : 'bg-leaf/30 group-hover:bg-leaf/50')}
                style={{ height: `${(t.count / maxTrend) * 100}%`, minHeight: t.count ? 3 : 1 }}
              />
              <span className={clsx('text-[10px]', mode === 'month' && t.month === month ? 'font-semibold' : 'text-muted')}>{monthLabel(t.month, true).split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </Section>

      <div className="card p-4 grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Period"
            value={mode}
            onChange={(v) => (v === 'month' ? set({ from: null, to: null }) : set({ from: `${month}-01`, to: lastDay(month) }))}
            options={[{ value: 'month', label: 'Month' }, { value: 'range', label: 'Date range' }]}
          />
          {mode === 'month' ? (
            <select className="input !w-auto" value={month} onChange={(e) => set({ month: e.target.value })} aria-label="Month">
              {monthList.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <input type="date" className="input !w-auto" value={from} onChange={(e) => set({ from: e.target.value })} aria-label="From" />
              <span className="text-muted">to</span>
              <input type="date" className="input !w-auto" value={to} onChange={(e) => set({ to: e.target.value })} aria-label="To" />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm ml-auto">
            <input type="checkbox" className="size-4 accent-[var(--color-leaf)]" checked={includeUnmapped} onChange={(e) => set({ unmapped: e.target.checked ? null : 'no' })} />
            Include ABs not yet placed in the tree
          </label>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint" />
            <input className="input pl-9" placeholder="Search joined AB or proposer name" value={qInput} onChange={(e) => setQInput(e.target.value)} />
          </div>
          {proposer && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf-soft px-3 py-1.5 text-sm">
              Proposer {proposerName ?? proposer}
              <button onClick={() => set({ proposer: null })} aria-label="Remove proposer filter">
                <X className="size-4" />
              </button>
            </span>
          )}
        </div>
      </div>

      {list.isLoading ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data ? null : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] items-start">
          <section className="card overflow-hidden">
            <div className="flex items-baseline justify-between gap-2 px-4 py-3 border-b border-line">
              <p>
                <span className="text-2xl font-semibold num">{fmtInt(list.data.total)}</span>{' '}
                <span className="text-sm text-muted">
                  joining{list.data.total === 1 ? '' : 's'} {mode === 'month' ? `in ${monthLabel(month)}` : 'in range'}
                </span>
                {list.isFetching && <Spinner className="inline size-3.5 ml-2" />}
              </p>
              {list.data.unmappedCount > 0 && <span className="text-xs text-warn">{list.data.unmappedCount} not placed yet</span>}
            </div>
            {list.data.total === 0 ? (
              <EmptyState title="No joining records found for this period." />
            ) : (
              <>
                <div className="table-wrap hidden sm:block">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Joining date</th>
                        <th>AB Number</th>
                        <th>Name</th>
                        <th>Proposer</th>
                        <th>Proposer AB</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.items.map((j) => (
                        <tr key={j.abNumber}>
                          <td className="whitespace-nowrap">{fmtDate(j.joiningDate)}</td>
                          <td className="num text-muted">{j.abNumber}</td>
                          <td>{j.mapped ? <Link className="font-medium hover:underline" to={`/members/${j.abNumber}`}>{j.name}</Link> : <span className="font-medium">{j.name}</span>}</td>
                          <td className="max-w-[12rem] truncate">
                            {j.proposerInNetwork ? <Link className="hover:underline" to={`/members/${j.proposerAbNumber}`}>{j.proposerName}</Link> : (j.proposerName ?? '—')}
                          </td>
                          <td className="num text-muted">{j.proposerAbNumber ?? '—'}</td>
                          <td>{j.mapped ? <StatusBadge status={j.status} /> : <Link to="/unmapped" className="text-xs text-warn font-medium">Not placed</Link>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="sm:hidden divide-y divide-line">
                  {list.data.items.map((j) => (
                    <li key={j.abNumber} className="px-4 py-3">
                      <div className="flex justify-between gap-3">
                        <span className="font-medium truncate">
                          {j.mapped ? <Link to={`/members/${j.abNumber}`}>{j.name}</Link> : j.name}
                        </span>
                        <span className="text-sm text-muted whitespace-nowrap">{fmtDate(j.joiningDate)}</span>
                      </div>
                      <p className="text-xs text-muted num mt-0.5">
                        AB {j.abNumber} · proposed by {j.proposerName ?? '—'} {j.proposerAbNumber && `(${j.proposerAbNumber})`}
                      </p>
                      {!j.mapped && <p className="text-xs text-warn mt-0.5">Not placed in the tree yet</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <Section title="By proposer" description="Tap a proposer to filter" bodyClassName="p-0 pt-2">
            {list.data.byProposer.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-muted">Nobody yet.</p>
            ) : (
              <ul className="divide-y divide-line max-h-[28rem] overflow-y-auto">
                {list.data.byProposer.map((b) => (
                  <li key={b.proposerAbNumber ?? 'none'}>
                    <button
                      onClick={() => set({ proposer: b.proposerAbNumber === proposer ? null : b.proposerAbNumber })}
                      className={clsx('w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 text-left hover:bg-paper/60', b.proposerAbNumber === proposer && 'bg-leaf-soft')}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{b.proposerName ?? 'No proposer'}</span>
                        <span className="block text-xs text-muted num">{b.proposerAbNumber ?? '—'}</span>
                      </span>
                      <span className="num font-semibold">{b.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function lastDay(month: string) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 0));
  return d.toISOString().slice(0, 10);
}
