import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { pvApi } from '../api/endpoints';
import { MemberPicker } from '../components/MemberPicker';
import { Alert, ErrorState, errorMessage, Field, KycBadge, Loading, PageHeader, StatusBadge } from '../components/ui';
import { useMonth } from '../hooks/useMonth';
import type { Ref } from '../types/api';
import { fmtDateTime, fmtPv, monthLabel } from '../utils/format';

export function UpdatePvPage() {
  const [sp, setSp] = useSearchParams();
  const { current, available } = useMonth();
  const [abInput, setAbInput] = useState(sp.get('ab') ?? '');
  const ab = sp.get('ab') ?? '';
  const month = sp.get('month') ?? current;
  const [newPv, setNewPv] = useState('');
  const [done, setDone] = useState<{ name: string; month: string; previous: number; current: number } | null>(null);
  const qc = useQueryClient();

  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };

  const lookup = useQuery({
    queryKey: ['pv-lookup', ab, month],
    queryFn: () => pvApi.lookup(ab, month),
    enabled: /^\d+$/.test(ab),
    retry: false,
  });

  const save = useMutation({
    mutationFn: () => pvApi.update(ab, month, Number(newPv)),
    onSuccess: (r) => {
      setDone({ name: r.name, month: r.month, previous: r.previousPv, current: r.currentPv });
      setNewPv('');
      qc.invalidateQueries();
    },
  });

  const find = (e: FormEvent) => {
    e.preventDefault();
    const v = abInput.trim();
    if (/^\d+$/.test(v)) {
      setDone(null);
      setParam('ab', v);
    }
  };
  const pick = (r: Ref | null) => {
    if (!r) return;
    setAbInput(r.abNumber);
    setDone(null);
    setParam('ab', r.abNumber);
  };

  const pvNum = Number(newPv);
  const pvValid = newPv.trim() !== '' && Number.isFinite(pvNum) && pvNum >= 0;
  const months = [...new Set([current, ...available])].sort().reverse();

  return (
    <div className="max-w-2xl grid gap-4">
      <PageHeader title="Update PV" description="Set an AB’s Self PV for a month. The new value replaces the existing one — it is not added to it." />

      <div className="card p-4 sm:p-5 grid gap-4">
        <form onSubmit={find} className="grid gap-4 sm:grid-cols-[1fr_auto] items-end">
          <Field label="AB Number" htmlFor="pv-ab">
            <input id="pv-ab" className="input num" inputMode="numeric" value={abInput} onChange={(e) => setAbInput(e.target.value.replace(/\s/g, ''))} placeholder="e.g. 30594292" />
          </Field>
          <button className="btn-primary" disabled={!/^\d+$/.test(abInput.trim())}>
            Find AB
          </button>
        </form>
        <div>
          <p className="text-xs text-muted mb-1.5">Or search by name</p>
          <MemberPicker value={null} onChange={pick} placeholder="Search name" />
        </div>
        <Field label="Month" htmlFor="pv-month" hint={month === current ? 'Current month' : undefined}>
          <select id="pv-month" className="input" value={month} onChange={(e) => setParam('month', e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
                {m === current ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {ab &&
        (lookup.isLoading ? (
          <Loading label="Finding AB…" />
        ) : lookup.isError ? (
          <ErrorState compact error={lookup.error} />
        ) : lookup.data ? (
          <form
            className="card p-4 sm:p-5 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (pvValid) save.mutate();
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link to={`/members/${lookup.data.abNumber}`} className="text-lg font-semibold hover:underline">
                  {lookup.data.name}
                </Link>
                <p className="text-sm text-muted num">AB {lookup.data.abNumber}</p>
              </div>
              <div className="flex gap-1.5">
                <StatusBadge status={lookup.data.status} />
                <KycBadge kyc={lookup.data.kycStatus} />
              </div>
            </div>
            <div className="rounded-lg bg-paper px-4 py-3">
              <p className="text-xs text-muted">Current Self PV for {monthLabel(lookup.data.month)}</p>
              <p className="text-3xl font-semibold num text-saffron-ink">{fmtPv(lookup.data.currentPv)}</p>
              <p className="text-xs text-muted mt-0.5">
                {lookup.data.hasRecord
                  ? `${lookup.data.source === 'MANUAL' ? 'Set manually' : 'From Excel import'} · ${fmtDateTime(lookup.data.updatedAt)}`
                  : 'No PV recorded for this month yet'}
              </p>
            </div>
            <Field label="New PV" htmlFor="pv-new" error={newPv && !pvValid ? 'Enter a number of 0 or more' : null}>
              <input id="pv-new" className="input num text-lg" inputMode="decimal" value={newPv} onChange={(e) => setNewPv(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
            </Field>
            {pvValid && (
              <p className="text-sm text-muted">
                {fmtPv(lookup.data.currentPv)} will be replaced by <span className="font-semibold text-ink num">{fmtPv(pvNum)}</span>.
              </p>
            )}
            {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
            <button className="btn-primary min-h-11" disabled={!pvValid || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save PV'}
            </button>
          </form>
        ) : null)}

      {done && (
        <Alert tone="success">
          <span className="flex items-start gap-2">
            <CheckCircle2 className="size-5 shrink-0" />
            <span>
              PV saved. {done.name}’s Self PV for {monthLabel(done.month)} is now <strong className="num">{fmtPv(done.current)}</strong> (was{' '}
              <span className="num">{fmtPv(done.previous)}</span>). Group totals of everyone above have updated.
            </span>
          </span>
        </Alert>
      )}
    </div>
  );
}
