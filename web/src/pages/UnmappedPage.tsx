import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { membersApi, importApi } from '../api/endpoints';
import { MemberPicker } from '../components/MemberPicker';
import { Alert, EmptyState, ErrorState, errorMessage, Field, Loading, Modal, PageHeader, Segmented } from '../components/ui';
import { useAddMember } from '../features/AddMember';
import { useDebounced } from '../hooks/useDebounced';
import type { BulkCreateResult, Kyc, Ref, Status, UnmappedRecord } from '../types/api';
import { fmtDate, fmtDateTime, fmtInt, fmtPv, monthLabel } from '../utils/format';

const NEED_SPONSOR = 'Select a Sponsor before placing this AB in the network.';

/**
 * ABs found in a Smart Report but not in the tree.
 * The report has no Sponsor information, so the Sponsor is ALWAYS chosen by the
 * user. The report's Proposer is only used as the Proposer (joining relationship).
 */
export function UnmappedPage() {
  const [qInput, setQInput] = useState('');
  const q = useDebounced(qInput.trim(), 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [result, setResult] = useState<BulkCreateResult | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const qc = useQueryClient();

  const list = useQuery({ queryKey: ['unmapped', q], queryFn: () => importApi.unmapped(q || undefined), placeholderData: keepPreviousData });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.abNumber));

  const toggle = (ab: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(ab)) n.delete(ab);
      else n.add(ab);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allSelected) rows.forEach((r) => n.delete(r.abNumber));
      else rows.forEach((r) => n.add(r.abNumber));
      return n;
    });

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Unmapped ABs"
        description="ABs from a Smart Report that are not in your tree yet. The report does not say who the Sponsor is, so choose the Sponsor for each AB. Its imported report data and PV attach automatically."
      />

      {placed && <Alert tone="success">{placed}</Alert>}
      {result && (
        <Alert tone={result.skipped.length ? 'warn' : 'success'}>
          <p>
            Placed <strong className="num">{result.created}</strong> AB{result.created === 1 ? '' : 's'} under Sponsor{' '}
            <span className="num">{result.createdItems[0]?.sponsorAbNumber}</span>.
            {result.skipped.length > 0 && ` ${result.skipped.length} could not be placed:`}
          </p>
          {result.skipped.length > 0 && (
            <ul className="mt-1.5 max-h-40 overflow-y-auto text-xs space-y-0.5">
              {result.skipped.slice(0, 50).map((s) => (
                <li key={s.abNumber}>
                  <span className="num">{s.abNumber}</span>: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <div className="card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint" />
          <input className="input pl-9" placeholder="Search AB number, name or proposer" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-hidden">
        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          q ? (
            <EmptyState title={`No unmapped AB matches “${q}”.`} />
          ) : (
            <EmptyState title="All imported ABs are currently mapped." action={<Link to="/import" className="btn-secondary">Import a Smart Report</Link>} />
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-paper/60">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="size-4 accent-[var(--color-leaf)]" checked={allSelected} onChange={toggleAll} />
                Select all {fmtInt(rows.length)}
              </label>
              <div className="flex items-center gap-2">
                {selected.size > 0 && <span className="text-sm text-muted num">{selected.size} selected</span>}
                <button className="btn-secondary !min-h-9" disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
                  Place selected under one Sponsor
                </button>
              </div>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <UnmappedCard
                  key={r.abNumber}
                  r={r}
                  checked={selected.has(r.abNumber)}
                  onCheck={() => toggle(r.abNumber)}
                  onPlaced={(msg) => {
                    setResult(null);
                    setPlaced(msg);
                    setSelected((s) => {
                      const n = new Set(s);
                      n.delete(r.abNumber);
                      return n;
                    });
                    qc.invalidateQueries();
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {bulkOpen && (
        <BulkPlaceDialog
          abNumbers={[...selected]}
          onClose={() => setBulkOpen(false)}
          onDone={(r) => {
            setPlaced(null);
            setResult(r);
            setSelected(new Set());
            setBulkOpen(false);
            qc.invalidateQueries();
          }}
        />
      )}
    </div>
  );
}

function UnmappedCard({ r, checked, onCheck, onPlaced }: { r: UnmappedRecord; checked: boolean; onCheck: () => void; onPlaced: (msg: string) => void }) {
  const { openAdd } = useAddMember();
  const qc = useQueryClient();
  const [sponsor, setSponsor] = useState<Ref | null>(null);
  const reportProposer: Ref | null = r.proposerAbNumber ? { abNumber: r.proposerAbNumber, name: r.proposerName ?? r.proposerAbNumber } : null;

  const place = useMutation({
    mutationFn: () =>
      membersApi.create({
        abNumber: r.abNumber,
        name: r.name,
        kycStatus: 'OK',
        status: 'ACTIVE',
        sponsorAbNumber: sponsor!.abNumber,
        // Proposer = the imported proposer, only when that AB exists in the network.
        proposerAbNumber: r.proposerInNetwork ? r.proposerAbNumber : null,
      }),
    onSuccess: () => onPlaced(`${r.name} (${r.abNumber}) placed under Sponsor ${sponsor!.name}.`),
  });
  const dismiss = useMutation({ mutationFn: () => importApi.dismiss(r.abNumber), onSuccess: () => qc.invalidateQueries() });

  return (
    <li data-ab={r.abNumber} className={clsx('flex gap-3 px-4 py-4', checked && 'bg-leaf-soft/40')}>
      <input type="checkbox" className="size-4 mt-1 accent-[var(--color-leaf)] shrink-0" checked={checked} onChange={onCheck} aria-label={`Select ${r.name}`} />
      <div className="min-w-0 flex-1 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-6">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
          <div className="col-span-2">
            <dt className="text-xs text-muted">New / unmapped AB</dt>
            <dd className="font-semibold">{r.name}</dd>
            <dd className="text-xs text-muted num">
              AB {r.abNumber}
              {r.city ? ` · ${r.city}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Joining date</dt>
            <dd>{fmtDate(r.joiningDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{r.latestPv ? `PV ${monthLabel(r.latestPv.month, true)}` : 'PV'}</dt>
            <dd className="num font-semibold">{r.latestPv ? fmtPv(r.latestPv.pv) : '—'}</dd>
          </div>
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-muted">Proposer · joining / introduced by (from report)</dt>
            <dd>
              {r.proposerInNetwork ? (
                <Link to={`/members/${r.proposerAbNumber}`} className="text-leaf hover:underline">
                  {r.proposerName}
                </Link>
              ) : (
                <span>{r.proposerName ?? '—'}</span>
              )}
              {r.proposerAbNumber && <span className="text-xs text-muted num"> ({r.proposerAbNumber})</span>}
              {r.proposerAbNumber && !r.proposerInNetwork && <span className="block text-xs text-muted">Not in the network yet — Proposer link can be added later.</span>}
            </dd>
          </div>
        </dl>

        <div className="grid gap-2 content-start">
          <label className="text-xs text-muted" htmlFor={`sp-${r.abNumber}`}>
            Sponsor · tree position
          </label>
          <MemberPicker id={`sp-${r.abNumber}`} value={sponsor} onChange={setSponsor} exclude={r.abNumber} placeholder="Search AB / select Sponsor" />
          {!sponsor && <p className="text-xs text-muted">{NEED_SPONSOR}</p>}
          {place.isError && <p className="text-xs text-danger">{errorMessage(place.error)}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary !min-h-9" disabled={!sponsor || place.isPending} onClick={() => place.mutate()} title={sponsor ? undefined : NEED_SPONSOR}>
              {place.isPending ? 'Placing…' : 'Create / Place AB'}
            </button>
            <button
              className="btn-ghost !min-h-9 !px-3"
              onClick={() =>
                openAdd({
                  abNumber: r.abNumber,
                  name: r.name,
                  fromUnmapped: true,
                  sponsor,
                  proposer: r.proposerInNetwork ? reportProposer : null,
                  reportProposer,
                })
              }
            >
              More options
            </button>
            <button
              className="btn-ghost !min-h-9 !px-3 text-xs"
              onClick={() => {
                if (confirm(`Dismiss AB ${r.abNumber}? It will come back if it appears in a later import.`)) dismiss.mutate();
              }}
              title={`Seen ${fmtDateTime(r.lastSeenAt)}`}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function BulkPlaceDialog({ abNumbers, onClose, onDone }: { abNumbers: string[]; onClose: () => void; onDone: (r: BulkCreateResult) => void }) {
  const [sponsor, setSponsor] = useState<Ref | null>(null);
  const [linkProposer, setLinkProposer] = useState(true);
  const [kyc, setKyc] = useState<Kyc>('OK');
  const [status, setStatus] = useState<Status>('ACTIVE');
  const run = useMutation({
    mutationFn: () => importApi.bulkCreate({ abNumbers, sponsorAbNumber: sponsor!.abNumber, linkProposer, kycStatus: kyc, status }),
    onSuccess: onDone,
  });
  const n = abNumbers.length;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Place ${fmtInt(n)} AB${n === 1 ? '' : 's'} under one Sponsor`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={run.isPending || !sponsor} onClick={() => run.mutate()}>
            {run.isPending ? 'Placing…' : `Place ${fmtInt(n)} under ${sponsor ? sponsor.name : 'Sponsor'}`}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Sponsor · tree position" htmlFor="bulk-sponsor" hint={sponsor ? `All ${n} selected ABs become direct legs of ${sponsor.name}.` : NEED_SPONSOR}>
          <MemberPicker id="bulk-sponsor" value={sponsor} onChange={setSponsor} placeholder="Search AB / select Sponsor" />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="size-4 mt-0.5 accent-[var(--color-leaf)]" checked={linkProposer} onChange={(e) => setLinkProposer(e.target.checked)} />
          <span>
            Link each AB’s imported Proposer (joining / introduced by) when that Proposer is in the network. This does not affect tree position.
          </span>
        </label>
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <Field label="KYC for all">
            <Segmented label="KYC" value={kyc} onChange={setKyc} options={[{ value: 'OK', label: 'OK' }, { value: 'NOT_OK', label: 'Not OK' }]} />
          </Field>
          <Field label="Status for all">
            <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'TERMINATED', label: 'Terminated' }]} />
          </Field>
        </div>
        {run.isError && <Alert tone="danger">{errorMessage(run.error)}</Alert>}
      </div>
    </Modal>
  );
}
