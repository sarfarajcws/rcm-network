import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Gauge, Network, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { membersApi } from '../api/endpoints';
import { LegStrip, legColor } from '../components/LegStrip';
import { MemberPicker } from '../components/MemberPicker';
import {
  Alert,
  EmptyState,
  ErrorState,
  errorMessage,
  Field,
  KycBadge,
  Loading,
  Modal,
  Section,
  Segmented,
  StatusBadge,
} from '../components/ui';
import { useMonth } from '../hooks/useMonth';
import type { Kyc, Member, Profile, Ref, Status } from '../types/api';
import { fmtDate, fmtDateTime, fmtInt, fmtPv, monthLabel, yesNo } from '../utils/format';
import { TreePage } from './TreePage';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'pv', label: 'Month-wise PV' },
  { id: 'joinings', label: 'Joinings' },
  { id: 'network', label: 'Own network' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function ProfilePage() {
  const { ab = '' } = useParams();
  const { month } = useMonth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['profile', ab, month], queryFn: () => membersApi.profile(ab, month) });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data!;
  const m = p.member;

  return (
    <div className="grid gap-5">
      {/* Identity */}
      <div>
        <nav aria-label="Upline" className="text-xs text-muted mb-2 flex flex-wrap items-center gap-1">
          {p.upline.length === 0 && m.isMainLeader && <span>Main Leader · top of the network</span>}
          {p.upline.map((u, i) => (
            <span key={u.abNumber} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3" />}
              <Link to={`/members/${u.abNumber}`} className="hover:text-ink hover:underline">
                {u.name}
              </Link>
            </span>
          ))}
        </nav>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{m.name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="num text-muted">AB {m.abNumber}</span>
              {m.isMainLeader && <span className="rounded-full bg-forest px-2 py-0.5 text-xs font-medium text-white">Main Leader</span>}
              <StatusBadge status={m.status} />
              <KycBadge kyc={m.kycStatus} />
              {p.depth !== null && p.depth > 0 && <span className="text-xs text-muted">Depth {p.depth} below you</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </button>
            <Link to={`/pv?ab=${m.abNumber}`} className="btn-secondary">
              <Gauge className="size-4" /> Update PV
            </Link>
            <Link to={`/tree?root=${m.abNumber}`} className="btn-secondary">
              <Network className="size-4" /> Open in tree
            </Link>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
        <div role="tablist" className="flex gap-1 border-b border-line min-w-max">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setParams(t.id === 'overview' ? {} : { tab: t.id }, { replace: true })}
              className={clsx(
                'px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap',
                tab === t.id ? 'border-leaf text-ink' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t.label}
              {t.id === 'joinings' && <span className="ml-1.5 text-xs text-muted num">{p.joinings.total}</span>}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && <Overview p={p} month={month} />}
      {tab === 'pv' && <PvHistorySection ab={m.abNumber} />}
      {tab === 'joinings' && <JoiningsSection ab={m.abNumber} />}
      {tab === 'network' && <TreePage key={m.abNumber} embeddedRoot={m.abNumber} />}

      {editing && <EditMemberDialog member={m} hasDownline={p.summary.totalDownline > 0} onClose={() => setEditing(false)} />}
    </div>
  );
}

function Overview({ p, month }: { p: Profile; month: string }) {
  const m = p.member;
  const s = p.summary;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="grid gap-5 content-start">
        <Section title={`PV for ${monthLabel(month)}`} description="Self PV plus every direct leg. Legs are the Sponsor tree branches.">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Figure label="Self PV" value={fmtPv(p.pv.selfPv)} />
            <Figure label="Group PV" value={fmtPv(p.pv.groupPv)} />
            <Figure label="Total PV" value={fmtPv(p.pv.totalPv)} strong />
          </div>
          <LegStrip selfPv={p.pv.selfPv} legs={p.pv.legs} height="h-4" />
          {p.pv.legs.length === 0 ? (
            <p className="text-sm text-muted mt-4">No direct legs yet — this AB has not sponsored anyone.</p>
          ) : (
            <ol className="mt-4 divide-y divide-line">
              {p.pv.legs.map((l) => (
                <li key={l.abNumber} className="flex items-center gap-3 py-2.5">
                  <span className="size-2.5 rounded-sm shrink-0" style={{ background: legColor(l.index - 1) }} />
                  <span className="text-xs text-muted w-14 shrink-0">Leg {l.index}</span>
                  <Link to={`/members/${l.abNumber}`} className="min-w-0 flex-1 hover:underline">
                    <span className="font-medium truncate block">{l.name}</span>
                    <span className="text-xs text-muted num">
                      {l.abNumber} · {fmtInt(l.legSize)} {l.legSize === 1 ? 'member' : 'members'}
                      {l.status === 'TERMINATED' && <span className="text-danger"> · terminated</span>}
                    </span>
                  </Link>
                  <span className={clsx('num font-semibold', l.pv === 0 ? 'text-faint' : '')}>{fmtPv(l.pv)}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Smart Report details" description={m.report.updatedAt ? `Last updated from Excel ${fmtDateTime(m.report.updatedAt)}` : 'No Excel data for this AB yet'}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Detail label="Joining date (Feeding Date)" value={fmtDate(m.report.joiningDate)} />
            <Detail label="Mobile" value={m.report.mobile ? <a className="text-leaf num" href={`tel:${m.report.mobile}`}>{m.report.mobile}</a> : '—'} />
            <Detail label="City" value={m.report.city} />
            <Detail label="District" value={m.report.district} />
            <Detail label="State" value={m.report.state} />
            <Detail
              label="Proposer in Smart Report"
              value={m.report.proposerAbNumber ? `${m.report.proposerName ?? ''} · ${m.report.proposerAbNumber}` : '—'}
            />
            <Detail label="PUC Home Delivery" value={yesNo(m.report.pucHomeDelivery)} />
            <Detail label="Display Wall" value={yesNo(m.report.displayWall)} />
          </dl>
        </Section>
      </div>

      <div className="grid gap-5 content-start">
        <Section title="Network summary" description="Everyone below this AB in the Sponsor tree, at every depth">
          <div className="grid grid-cols-2 gap-3">
            <Figure label="Total downline" value={fmtInt(s.totalDownline)} strong />
            <Figure label="Direct legs" value={fmtInt(s.directLegs)} />
            <Figure label="Active" value={fmtInt(s.active)} />
            <Figure label="Terminated" value={fmtInt(s.terminated)} tone={s.terminated ? 'danger' : undefined} />
            <Figure label="KYC not OK" value={fmtInt(s.kycNotOk)} tone={s.kycNotOk ? 'warn' : undefined} />
            <Figure label="Joinings proposed" value={fmtInt(p.joinings.total)} />
          </div>
          {s.totalDownline > 0 && (
            <Link to={`/members?under=${m.abNumber}`} className="inline-block mt-4 text-sm font-medium text-leaf">
              List everyone in this downline
            </Link>
          )}
        </Section>

        <Section title="Relationships">
          <dl className="grid gap-3 text-sm">
            <Detail
              label="Sponsor · tree position"
              value={
                m.sponsor ? (
                  <Link className="text-leaf" to={`/members/${m.sponsor.abNumber}`}>
                    {m.sponsor.name} · {m.sponsor.abNumber}
                  </Link>
                ) : m.external.sponsorAbNumber ? (
                  `${m.external.sponsorName ?? ''} · ${m.external.sponsorAbNumber} (outside network)`
                ) : (
                  '—'
                )
              }
            />
            <Detail
              label="Proposer · joining / introduced by"
              value={
                m.proposer ? (
                  <Link className="text-leaf" to={`/members/${m.proposer.abNumber}`}>
                    {m.proposer.name} · {m.proposer.abNumber}
                  </Link>
                ) : m.external.proposerAbNumber ? (
                  `${m.external.proposerName ?? ''} · ${m.external.proposerAbNumber} (outside network)`
                ) : (
                  'Not linked'
                )
              }
            />
          </dl>
        </Section>
        <PvAuditSection ab={m.abNumber} />
      </div>
    </div>
  );
}

function Figure({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'warn' | 'danger' }) {
  return (
    <div className="rounded-lg bg-paper px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={clsx(
          'num font-semibold mt-0.5',
          strong ? 'text-xl text-saffron-ink' : 'text-lg',
          tone === 'danger' && 'text-danger',
          tone === 'warn' && 'text-warn',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{value || '—'}</dd>
    </div>
  );
}

function PvHistorySection({ ab }: { ab: string }) {
  const q = useQuery({ queryKey: ['pv-history', ab], queryFn: () => membersApi.pvHistory(ab) });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const h = q.data!;
  if (h.months.length === 0) return <Section><EmptyState title="No PV recorded yet">Import a Smart Report or update PV manually.</EmptyState></Section>;
  const legName = new Map(h.legs.map((l) => [l.memberId, l]));

  return (
    <Section title="Month-wise PV" description="Each month is kept separately. Tap a month to see every leg." bodyClassName="p-0 pt-3">
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,5.25rem))] sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,7rem))] gap-2 px-4 sm:px-5 py-2 text-xs text-muted border-b border-line">
        <span>Month</span>
        <span className="text-right">Self</span>
        <span className="text-right">Group</span>
        <span className="text-right">Total</span>
      </div>
      <ul>
        {h.months.map((mo) => {
          const isOpen = open === mo.month;
          return (
            <li key={mo.month} className="border-b border-line last:border-0">
              <button
                className="w-full grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,5.25rem))] sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,7rem))] gap-2 items-center px-4 sm:px-5 py-3 text-left hover:bg-paper/60"
                onClick={() => setOpen(isOpen ? null : mo.month)}
                aria-expanded={isOpen}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  {isOpen ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
                  <span className="sm:hidden">{monthLabel(mo.month, true)}</span>
                  <span className="hidden sm:inline">{monthLabel(mo.month)}</span>
                </span>
                <span className="text-right num text-sm">{fmtPv(mo.selfPv)}</span>
                <span className="text-right num text-sm">{fmtPv(mo.groupPv)}</span>
                <span className="text-right num text-sm font-semibold text-saffron-ink">{fmtPv(mo.totalPv)}</span>
              </button>
              {isOpen && (
                <div className="px-4 sm:px-5 pb-4">
                  <LegStrip selfPv={mo.selfPv} legs={mo.legs.map((l) => ({ pv: l.pv, name: legName.get(l.memberId)?.name ?? '' }))} />
                  {mo.legs.length === 0 ? (
                    <p className="text-sm text-muted mt-3">No legs.</p>
                  ) : (
                    <ul className="mt-3 grid sm:grid-cols-2 gap-x-6">
                      {mo.legs.map((l) => {
                        const info = legName.get(l.memberId)!;
                        return (
                          <li key={l.memberId} className="flex justify-between gap-3 py-1.5 text-sm border-b border-line/70">
                            <span className="truncate">
                              <span className="text-muted text-xs mr-2">Leg {info.index}</span>
                              {info.name}
                            </span>
                            <span className={clsx('num', l.pv === 0 && 'text-faint')}>{fmtPv(l.pv)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function PvAuditSection({ ab }: { ab: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['pv-audit', ab], queryFn: () => membersApi.pvAudit(ab), enabled: open });
  return (
    <Section
      title="PV change log"
      actions={
        <button className="text-sm text-leaf font-medium" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show'}
        </button>
      }
      bodyClassName={open ? 'p-4 sm:p-5' : 'p-0'}
    >
      {open &&
        (q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
        ) : q.data!.length === 0 ? (
          <p className="text-sm text-muted">No PV changes recorded.</p>
        ) : (
          <ul className="text-sm divide-y divide-line">
            {q.data!.map((a, i) => (
              <li key={i} className="py-2 flex justify-between gap-3">
                <span>
                  {monthLabel(a.month, true)}: <span className="num">{a.oldPv === null ? '—' : fmtPv(a.oldPv)}</span> to{' '}
                  <span className="num font-semibold">{fmtPv(a.newPv)}</span>
                  <span className="block text-xs text-muted">{a.source === 'MANUAL' ? 'Manual update' : 'Excel import'}</span>
                </span>
                <span className="text-xs text-muted text-right">{fmtDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        ))}
    </Section>
  );
}

function JoiningsSection({ ab }: { ab: string }) {
  const q = useQuery({ queryKey: ['member-joinings', ab], queryFn: () => membersApi.joinings(ab) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const j = q.data!;
  if (j.total === 0) return <Section><EmptyState title="No joinings yet">No AB lists this member as their Proposer.</EmptyState></Section>;
  const byMonth = new Map<string, typeof j.items>();
  for (const it of j.items) {
    const k = it.joiningDate?.slice(0, 7) ?? 'unknown';
    byMonth.set(k, [...(byMonth.get(k) ?? []), it]);
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Section title="By month">
        <p className="text-3xl font-semibold num">{fmtInt(j.total)}</p>
        <p className="text-sm text-muted mb-3">total joinings proposed</p>
        <ul className="text-sm divide-y divide-line">
          {j.months.map((m) => (
            <li key={m.month} className="flex justify-between py-1.5">
              <span>{m.month === 'unknown' ? 'No date' : monthLabel(m.month)}</span>
              <span className="num font-medium">{m.count}</span>
            </li>
          ))}
        </ul>
      </Section>
      <div className="grid gap-4 content-start">
        {[...byMonth.entries()].map(([k, items]) => (
          <Section key={k} title={k === 'unknown' ? 'No date' : monthLabel(k)} description={`${items.length} joining${items.length === 1 ? '' : 's'}`} bodyClassName="p-0 pt-2">
            <ul className="divide-y divide-line">
              {items.map((it) => (
                <li key={it.abNumber} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    {it.mapped ? (
                      <Link to={`/members/${it.abNumber}`} className="font-medium hover:underline">
                        {it.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{it.name}</span>
                    )}
                    <span className="block text-xs text-muted num">
                      AB {it.abNumber} · joined {fmtDate(it.joiningDate)}
                    </span>
                  </div>
                  {it.mapped ? <StatusBadge status={it.status} /> : <Link to="/unmapped" className="text-xs text-warn font-medium whitespace-nowrap">Not placed</Link>}
                </li>
              ))}
            </ul>
          </Section>
        ))}
      </div>
    </div>
  );
}

function EditMemberDialog({ member: m, hasDownline, onClose }: { member: Member; hasDownline: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [name, setName] = useState(m.name);
  const [kyc, setKyc] = useState<Kyc>(m.kycStatus);
  const [status, setStatus] = useState<Status>(m.status);
  const [sponsor, setSponsor] = useState<Ref | null>(m.sponsor);
  const [proposer, setProposer] = useState<Ref | null>(m.proposer);
  const [ext, setExt] = useState({ ...m.external });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (name.trim() !== m.name) body.name = name.trim();
      if (kyc !== m.kycStatus) body.kycStatus = kyc;
      if (status !== m.status) body.status = status;
      if (!m.isMainLeader) {
        if (sponsor && sponsor.abNumber !== m.sponsor?.abNumber) body.sponsorAbNumber = sponsor.abNumber;
        if ((proposer?.abNumber ?? null) !== (m.proposer?.abNumber ?? null)) body.proposerAbNumber = proposer?.abNumber ?? null;
      } else {
        body.externalSponsorAbNumber = ext.sponsorAbNumber || null;
        body.externalSponsorName = ext.sponsorName || null;
        body.externalProposerAbNumber = ext.proposerAbNumber || null;
        body.externalProposerName = ext.proposerName || null;
      }
      return membersApi.update(m.abNumber, body);
    },
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });
  const del = useMutation({
    mutationFn: () => membersApi.remove(m.abNumber),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
      nav('/members');
    },
  });
  const sponsorChanged = !m.isMainLeader && sponsor && sponsor.abNumber !== m.sponsor?.abNumber;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${m.name}`}
      footer={
        <>
          {!m.isMainLeader && !hasDownline && (
            <button className="btn-danger mr-auto" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> Delete
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={save.isPending || (!m.isMainLeader && !sponsor) || !name.trim()} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="AB Name" htmlFor="e-name">
          <input id="e-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <div>
            <span className="label">KYC</span>
            <Segmented label="KYC" value={kyc} onChange={setKyc} options={[{ value: 'OK', label: 'OK' }, { value: 'NOT_OK', label: 'Not OK' }]} />
          </div>
          <div>
            <span className="label">Status</span>
            <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'TERMINATED', label: 'Terminated' }]} />
          </div>
        </div>
        {m.isMainLeader ? (
          <fieldset className="grid gap-3 rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-medium">Upline outside this network</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Sponsor AB" htmlFor="e-sab">
                <input id="e-sab" className="input num" inputMode="numeric" value={ext.sponsorAbNumber ?? ''} onChange={(e) => setExt({ ...ext, sponsorAbNumber: e.target.value })} />
              </Field>
              <Field label="Sponsor name" htmlFor="e-sn">
                <input id="e-sn" className="input" value={ext.sponsorName ?? ''} onChange={(e) => setExt({ ...ext, sponsorName: e.target.value })} />
              </Field>
              <Field label="Proposer AB" htmlFor="e-pab">
                <input id="e-pab" className="input num" inputMode="numeric" value={ext.proposerAbNumber ?? ''} onChange={(e) => setExt({ ...ext, proposerAbNumber: e.target.value })} />
              </Field>
              <Field label="Proposer name" htmlFor="e-pn">
                <input id="e-pn" className="input" value={ext.proposerName ?? ''} onChange={(e) => setExt({ ...ext, proposerName: e.target.value })} />
              </Field>
            </div>
          </fieldset>
        ) : (
          <>
            <Field label="Sponsor · tree position" htmlFor="e-sponsor" hint="Moving the Sponsor moves this AB and everyone below it.">
              <MemberPicker id="e-sponsor" value={sponsor} onChange={setSponsor} exclude={m.abNumber} />
            </Field>
            {sponsorChanged && (
              <Alert tone="warn">
                {m.name} {hasDownline ? 'and their whole downline ' : ''}will move to Sponsor {sponsor!.name}. PV totals of both uplines change accordingly.
              </Alert>
            )}
            <Field label="Proposer · joining / introduced by" htmlFor="e-proposer" hint="Used for joining analysis only. Does not change tree position.">
              <MemberPicker id="e-proposer" value={proposer} onChange={setProposer} exclude={m.abNumber} />
            </Field>
          </>
        )}
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        {confirmDelete && (
          <Alert tone="danger">
            <p>Delete AB {m.abNumber} and its PV history? This cannot be undone.</p>
            <div className="flex gap-2 mt-2">
              <button className="btn-danger !min-h-9" disabled={del.isPending} onClick={() => del.mutate()}>
                {del.isPending ? 'Deleting…' : 'Delete AB'}
              </button>
              <button className="btn-secondary !min-h-9" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </div>
            {del.isError && <p className="mt-2">{errorMessage(del.error)}</p>}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
