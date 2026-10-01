import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, FileSpreadsheet, Gauge, Network, Plus, UserRoundSearch, Users } from 'lucide-react';
import { Link } from 'react-router';
import { metaApi } from '../api/endpoints';
import { LegStrip, legColor } from '../components/LegStrip';
import { Alert, EmptyState, ErrorState, Loading, Section } from '../components/ui';
import { useAddMember } from '../features/AddMember';
import { useAuth } from '../hooks/useAuth';
import { useMonth } from '../hooks/useMonth';
import { fmtDateTime, fmtInt, fmtPv, monthLabel } from '../utils/format';

export function DashboardPage() {
  const { month } = useMonth();
  const { leader } = useAuth();
  const { openAdd } = useAddMember();
  const q = useQuery({ queryKey: ['dashboard', month], queryFn: () => metaApi.dashboard(month) });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const legsByPv = [...d.pv.legs].sort((a, b) => b.pv - a.pv);
  const maxTrendPv = Math.max(1, ...d.trend.map((t) => t.pv));
  const maxTrendJ = Math.max(1, ...d.trend.map((t) => t.joinings));
  const empty = d.network.downline === 0;

  return (
    <div className="grid gap-5">
      <div>
        <p className="text-sm text-muted">{leader?.name}’s network</p>
        <h1 className="text-2xl font-semibold tracking-tight">{monthLabel(d.month)}</h1>
      </div>

      {empty && (
        <Section>
          <EmptyState
            title="Your network is empty"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link to="/import" className="btn-primary">
                  <FileSpreadsheet className="size-4" /> Import Smart Report
                </Link>
                <button className="btn-secondary" onClick={() => openAdd()}>
                  <Plus className="size-4" /> Add AB
                </button>
              </div>
            }
          >
            Import the Smart Report, then place each AB under its Sponsor from the Unmapped list. Or add ABs one by one.
          </EmptyState>
        </Section>
      )}

      {d.unmappedCount > 0 && (
        <Alert tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong className="num">{fmtInt(d.unmappedCount)}</strong> AB{d.unmappedCount === 1 ? '' : 's'} from the Smart Report are not placed in the tree yet.
            </span>
            <Link to="/unmapped" className="font-semibold text-leaf">
              Place them
            </Link>
          </div>
        </Alert>
      )}

      {/* Hero: network PV for the month and where it comes from */}
      <section className="card p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-end gap-6">
          <div className="lg:w-72 shrink-0">
            <p className="text-sm text-muted">Total network PV</p>
            <p className="text-4xl sm:text-5xl font-semibold tracking-tight num text-ink mt-1">{fmtPv(d.pv.totalPv)}</p>
            <p className="text-sm text-muted mt-2 num">
              Self {fmtPv(d.pv.selfPv)} · Group {fmtPv(d.pv.groupPv)}
            </p>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between text-xs text-muted mb-2">
              <span>Split across {d.network.directLegs} direct legs</span>
              <Link to={leader ? `/members/${leader.abNumber}` : '/'} className="text-leaf font-medium">
                See every leg
              </Link>
            </div>
            <LegStrip selfPv={d.pv.selfPv} legs={d.pv.legs} height="h-5" />
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {legsByPv.slice(0, 6).map((l) => (
                <li key={l.abNumber} className="flex items-center gap-1.5 min-w-0">
                  <span className="size-2.5 rounded-sm shrink-0" style={{ background: legColor(l.index - 1) }} />
                  <Link to={`/members/${l.abNumber}`} className="truncate max-w-[10rem] hover:underline">
                    {l.name}
                  </Link>
                  <span className="text-muted num">{fmtPv(l.pv)}</span>
                </li>
              ))}
              {legsByPv.length > 6 && <li className="text-muted">+{legsByPv.length - 6} more</li>}
            </ul>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Members" value={d.network.totalMembers} to="/members" />
        <Stat label="Active" value={d.network.active} to="/members?status=ACTIVE" />
        <Stat label="Terminated" value={d.network.terminated} to="/members?status=TERMINATED" tone={d.network.terminated ? 'danger' : undefined} />
        <Stat label="KYC not OK" value={d.network.kycNotOk} to="/members?kyc=NOT_OK" tone={d.network.kycNotOk ? 'warn' : undefined} />
        <Stat label="Active with 0 PV" value={d.network.activeWithZeroPv} to="/members?status=ACTIVE&pv=ZERO" tone={d.network.activeWithZeroPv ? 'warn' : undefined} />
        <Stat label={`Joinings in ${monthLabel(d.month, true)}`} value={d.joinings.thisMonth} to="/joining" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section title="Last 6 months" description="Network PV and joinings per month">
          <div className="grid grid-cols-6 gap-2 sm:gap-4 items-end h-48" role="table" aria-label="Monthly PV and joinings">
            {d.trend.map((t) => (
              <div key={t.month} className="flex flex-col items-center gap-1 h-full justify-end" role="row">
                <span className="text-[11px] text-muted num hidden sm:block">{fmtPv(Math.round(t.pv))}</span>
                <div className="w-full flex items-end gap-1 flex-1">
                  <div className="flex-[3] rounded-t-md bg-saffron" style={{ height: `${(t.pv / maxTrendPv) * 100}%`, minHeight: t.pv ? 3 : 0 }} title={`PV ${fmtPv(t.pv)}`} />
                  <div className="flex-1 rounded-t-md bg-leaf" style={{ height: `${(t.joinings / maxTrendJ) * 60}%`, minHeight: t.joinings ? 3 : 0 }} title={`${t.joinings} joinings`} />
                </div>
                <span className={`text-xs ${t.month === d.month ? 'font-semibold' : 'text-muted'}`}>{monthLabel(t.month, true)}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 text-xs text-muted mt-3">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-saffron" /> PV
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-leaf" /> Joinings
            </span>
          </div>
        </Section>

        <Section title="Quick actions">
          <div className="grid grid-cols-2 gap-2">
            <QuickLink to="/tree" icon={Network} label="Open tree" />
            <button className="btn-secondary justify-start !min-h-12" onClick={() => openAdd()}>
              <Plus className="size-4 text-leaf" /> Add AB
            </button>
            <QuickLink to="/pv" icon={Gauge} label="Update PV" />
            <QuickLink to="/import" icon={FileSpreadsheet} label="Import Excel" />
            <QuickLink to="/members" icon={Users} label="View members" />
            <QuickLink to="/joining" icon={CalendarCheck} label="View joinings" />
          </div>
          <div className="mt-4 text-sm text-muted">
            {d.lastImport ? (
              <p>
                Last import: <span className="text-ink">{d.lastImport.fileName}</span> on {fmtDateTime(d.lastImport.at)}
                {d.lastImport.status === 'FAILED' ? ' (failed)' : ` — ${d.lastImport.matched} matched, ${d.lastImport.unmapped} unmapped`}
              </p>
            ) : (
              <p className="flex items-center gap-2">
                <UserRoundSearch className="size-4" /> No Smart Report imported yet.
              </p>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value, to, tone }: { label: string; value: number; to: string; tone?: 'warn' | 'danger' }) {
  return (
    <Link to={to} className="card px-4 py-3 hover:border-line-strong transition-colors">
      <p className="text-xs text-muted truncate">{label}</p>
      <p className={`text-2xl font-semibold num mt-0.5 ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : ''}`}>{fmtInt(value)}</p>
    </Link>
  );
}

function QuickLink({ to, icon: Icon, label }: { to: string; icon: typeof Network; label: string }) {
  return (
    <Link to={to} className="btn-secondary justify-start !min-h-12">
      <Icon className="size-4 text-leaf" /> {label}
    </Link>
  );
}
