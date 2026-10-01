import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDownUp, Download, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { type MemberFilters, membersApi } from '../api/endpoints';
import { EmptyState, ErrorState, errorMessage, KycBadge, Loading, PageHeader, Pager, Segmented, Spinner, StatusBadge } from '../components/ui';
import { useDebounced } from '../hooks/useDebounced';
import { useMonth } from '../hooks/useMonth';
import { fmtDate, fmtInt, fmtPv, monthLabel } from '../utils/format';

const PV_OPTIONS = [
  { value: 'ALL', label: 'Any PV' },
  { value: 'ZERO', label: '0' },
  { value: '0-100', label: '0–100' },
  { value: '100-500', label: '100–500' },
  { value: '500-1000', label: '500–1,000' },
  { value: '1000-5000', label: '1,000–5,000' },
  { value: '5000+', label: '5,000+' },
  { value: 'CUSTOM', label: 'Custom' },
];

const PAGE_SIZE = 50;

export function MembersPage() {
  const { month } = useMonth();
  const [sp, setSp] = useSearchParams();
  const get = (k: string, d = '') => sp.get(k) ?? d;
  const [qInput, setQInput] = useState(get('q'));
  const dq = useDebounced(qInput.trim(), 300);
  const [minInput, setMinInput] = useState(get('pvMin'));
  const [maxInput, setMaxInput] = useState(get('pvMax'));
  const dMin = useDebounced(minInput, 400);
  const dMax = useDebounced(maxInput, 400);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || v === 'ALL') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };

  useEffect(() => {
    if (dq !== get('q')) update({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  useEffect(() => {
    if (get('pv') === 'CUSTOM' && (dMin !== get('pvMin') || dMax !== get('pvMax'))) update({ pvMin: dMin, pvMax: dMax });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dMin, dMax]);

  const filters: MemberFilters = {
    month,
    q: get('q') || undefined,
    status: get('status', 'ALL') as MemberFilters['status'],
    kyc: get('kyc', 'ALL') as MemberFilters['kyc'],
    pv: get('pv', 'ALL'),
    pvMin: get('pv') === 'CUSTOM' ? get('pvMin') || undefined : undefined,
    pvMax: get('pv') === 'CUSTOM' ? get('pvMax') || undefined : undefined,
    under: get('under') || undefined,
    sort: get('sort', 'name'),
    dir: get('dir', 'asc') as 'asc' | 'desc',
    page: Number(get('page', '1')) || 1,
    pageSize: PAGE_SIZE,
  };

  const q = useQuery({ queryKey: ['members', filters], queryFn: () => membersApi.list(filters), placeholderData: keepPreviousData });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const rows: string[][] = [['AB Number', 'Name', `PV ${monthLabel(month)}`, 'Status', 'KYC', 'Joining Date', 'Sponsor AB', 'Sponsor Name', 'Mobile', 'City', 'District']];
      let page = 1;
      for (;;) {
        const r = await membersApi.list({ ...filters, page, pageSize: 200 });
        r.items.forEach((i) =>
          rows.push([i.abNumber, i.name, String(i.pv), i.status, i.kycStatus, i.joiningDate ?? '', i.sponsorAbNumber ?? '', i.sponsorName ?? '', i.mobile ?? '', i.city ?? '', i.district ?? '']),
        );
        if (page * 200 >= r.total) break;
        page++;
      }
      const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `ab-members-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const sortBy = (col: string) => {
    if (filters.sort === col) update({ dir: filters.dir === 'asc' ? 'desc' : 'asc', sort: col });
    else update({ sort: col, dir: col === 'pv' ? 'desc' : 'asc' });
  };
  const SortTh = ({ col, children, right }: { col: string; children: React.ReactNode; right?: boolean }) => (
    <th className={right ? 'text-right' : undefined} aria-sort={filters.sort === col ? (filters.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button className={clsx('inline-flex items-center gap-1 hover:text-ink', filters.sort === col && 'text-ink')} onClick={() => sortBy(col)}>
        {children}
        <ArrowDownUp className="size-3" />
      </button>
    </th>
  );

  const active = [filters.status !== 'ALL', filters.kyc !== 'ALL', filters.pv !== 'ALL', !!filters.under, !!filters.q].filter(Boolean).length;

  return (
    <div className="grid gap-4">
      <PageHeader
        title="AB members"
        description={`Self PV shown for ${monthLabel(month)}. Change the month at the top.`}
        actions={
          <button className="btn-secondary" onClick={exportCsv} disabled={exporting || !q.data?.total}>
            {exporting ? <Spinner className="size-4" /> : <Download className="size-4" />} Download CSV
          </button>
        }
      />

      <div className="card p-4 grid gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint" />
          <input className="input pl-9" placeholder="Search AB number or name" value={qInput} onChange={(e) => setQInput(e.target.value)} inputMode="search" />
        </div>
        <div>
          <p className="text-xs text-muted mb-1.5">Self PV in {monthLabel(month)}</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {PV_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => update({ pv: o.value, ...(o.value !== 'CUSTOM' ? { pvMin: null, pvMax: null } : {}) })}
                className={clsx(
                  'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium num',
                  filters.pv === o.value ? 'bg-forest text-white border-forest' : 'border-line-strong bg-surface text-ink hover:bg-paper',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          {filters.pv === 'CUSTOM' && (
            <div className="flex items-center gap-2 mt-2 max-w-sm">
              <input className="input num" inputMode="decimal" placeholder="Min" value={minInput} onChange={(e) => setMinInput(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Minimum PV" />
              <span className="text-muted">to</span>
              <input className="input num" inputMode="decimal" placeholder="Max" value={maxInput} onChange={(e) => setMaxInput(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Maximum PV" />
            </div>
          )}
          {filters.pv !== 'ALL' && filters.pv !== 'ZERO' && filters.pv !== 'CUSTOM' && (
            <p className="hint">Ranges exclude the lower bound: “0–100” means above 0 up to 100.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 items-end">
          <div>
            <p className="text-xs text-muted mb-1.5">Status</p>
            <Segmented label="Status" value={filters.status!} onChange={(v) => update({ status: v })} options={[{ value: 'ALL', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'TERMINATED', label: 'Terminated' }]} />
          </div>
          <div>
            <p className="text-xs text-muted mb-1.5">KYC</p>
            <Segmented label="KYC" value={filters.kyc!} onChange={(v) => update({ kyc: v })} options={[{ value: 'ALL', label: 'All' }, { value: 'OK', label: 'OK' }, { value: 'NOT_OK', label: 'Not OK' }]} />
          </div>
          {filters.under && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf-soft px-3 py-1.5 text-sm">
              Downline of AB {filters.under}
              <button onClick={() => update({ under: null })} aria-label="Remove downline filter">
                <X className="size-4" />
              </button>
            </span>
          )}
          {active > 0 && (
            <button
              className="text-sm text-leaf font-medium ml-auto"
              onClick={() => {
                setQInput('');
                setMinInput('');
                setMaxInput('');
                setSp({}, { replace: true });
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
      {exportError && <p className="text-sm text-danger">{exportError}</p>}

      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data!.total === 0 ? (
          <EmptyState title="No members match these filters">Try a wider PV range or clear the filters.</EmptyState>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 border-b border-line">
              <p className="text-sm">
                <span className="font-semibold num">{fmtInt(q.data!.total)}</span> members
                {q.isFetching && <Spinner className="inline size-3.5 ml-2 text-muted" />}
              </p>
              <p className="text-sm text-muted">
                Combined Self PV <span className="num font-semibold text-ink">{fmtPv(q.data!.totalPv)}</span>
              </p>
            </div>
            {/* Desktop table */}
            <div className="table-wrap hidden md:block">
              <table className="table">
                <thead>
                  <tr>
                    <SortTh col="abNumber">AB Number</SortTh>
                    <SortTh col="name">Name</SortTh>
                    <SortTh col="pv" right>Self PV</SortTh>
                    <th>Status</th>
                    <th>KYC</th>
                    <SortTh col="joiningDate">Joining date</SortTh>
                    <th>Sponsor</th>
                    <th>City</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data!.items.map((m) => (
                    <tr key={m.abNumber} className="hover:bg-paper/60">
                      <td className="num text-muted">{m.abNumber}</td>
                      <td>
                        <Link to={`/members/${m.abNumber}`} className="font-medium hover:underline">
                          {m.name}
                        </Link>
                      </td>
                      <td className={clsx('text-right num font-semibold', m.pv === 0 && 'text-faint')}>{fmtPv(m.pv)}</td>
                      <td><StatusBadge status={m.status} /></td>
                      <td><KycBadge kyc={m.kycStatus} /></td>
                      <td className="whitespace-nowrap">{fmtDate(m.joiningDate)}</td>
                      <td className="max-w-[12rem] truncate">{m.sponsorName ? <Link to={`/members/${m.sponsorAbNumber}`} className="hover:underline">{m.sponsorName}</Link> : '—'}</td>
                      <td className="text-muted">{m.city ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <ul className="md:hidden divide-y divide-line">
              {q.data!.items.map((m) => (
                <li key={m.abNumber}>
                  <Link to={`/members/${m.abNumber}`} className="flex items-center justify-between gap-3 px-4 py-3 active:bg-paper">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{m.name}</p>
                      <p className="text-xs text-muted num">
                        {m.abNumber}
                        {m.sponsorName && <> · Sponsor {m.sponsorName}</>}
                      </p>
                      <div className="flex gap-1.5 mt-1.5">
                        <StatusBadge status={m.status} />
                        {m.kycStatus === 'NOT_OK' && <KycBadge kyc={m.kycStatus} />}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={clsx('num font-semibold text-lg', m.pv === 0 && 'text-faint')}>{fmtPv(m.pv)}</p>
                      <p className="text-[11px] text-muted">Self PV</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pager page={filters.page!} pageSize={PAGE_SIZE} total={q.data!.total} onPage={(p) => update({ page: String(p) })} />
          </>
        )}
      </div>
    </div>
  );
}
