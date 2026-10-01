import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  CalendarCheck,
  Ellipsis,
  FileSpreadsheet,
  Gauge,
  LayoutDashboard,
  LogOut,
  Network,
  Plus,
  Settings,
  UserRoundSearch,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { metaApi } from '../api/endpoints';
import { MemberPicker } from '../components/MemberPicker';
import { MonthSelect } from '../components/MonthSelect';
import { Modal } from '../components/ui';
import { useAddMember } from '../features/AddMember';
import { useAuth } from '../hooks/useAuth';
import { useMonth } from '../hooks/useMonth';

const NAV: { to: string; label: string; short?: string; icon: typeof Users; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: LayoutDashboard, end: true },
  { to: '/tree', label: 'Network tree', short: 'Tree', icon: Network },
  { to: '/members', label: 'AB members', short: 'Members', icon: Users },
  { to: '/joining', label: 'Joining', short: 'Joining', icon: CalendarCheck },
  { to: '/pv', label: 'Update PV', icon: Gauge },
  { to: '/import', label: 'Excel import', icon: FileSpreadsheet },
  { to: '/unmapped', label: 'Unmapped ABs', icon: UserRoundSearch },
  { to: '/settings', label: 'Account', icon: Settings },
];

function UnmappedCount() {
  const { month } = useMonth();
  const d = useQuery({ queryKey: ['dashboard', month], queryFn: () => metaApi.dashboard(month), staleTime: 30_000 });
  const n = d.data?.unmappedCount ?? 0;
  if (!n) return null;
  return <span className="ml-auto rounded-full bg-saffron px-2 text-xs font-semibold text-forest num">{n}</span>;
}

export function AppLayout() {
  const { leader, signOut } = useAuth();
  const { openAdd } = useAddMember();
  const nav = useNavigate();
  const loc = useLocation();
  const [more, setMore] = useState(false);

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-forest text-white/85">
        <div className="px-5 pt-6 pb-5 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9 rounded-lg" />
          <div className="min-w-0">
            <p className="font-semibold text-white leading-tight">RCM Network</p>
            <p className="text-xs text-white/60 truncate">{leader ? `${leader.name} · ${leader.abNumber}` : ' '}</p>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-white/12 text-white' : 'hover:bg-white/6 hover:text-white',
                )
              }
            >
              <n.icon className="size-[18px] shrink-0" />
              {n.label}
              {n.to === '/unmapped' && <UnmappedCount />}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <button onClick={signOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-white/6">
            <LogOut className="size-[18px]" /> Log out
          </button>
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-paper/90 backdrop-blur border-b border-line">
        <div className="flex items-center gap-2 px-4 sm:px-6 h-14">
          <img src="/favicon.svg" alt="" className="size-8 rounded-lg lg:hidden" />
          <div className="hidden md:block w-80">
            <MemberPicker
              key={loc.pathname}
              value={null}
              onChange={(r) => r && nav(`/members/${r.abNumber}`)}
              placeholder="Find an AB by number or name"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <MonthSelect />
            <button className="btn-primary !px-3" onClick={() => openAdd()}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">Add AB</span>
            </button>
          </div>
        </div>
        <div className="md:hidden px-4 pb-3">
          <MemberPicker key={loc.pathname} value={null} onChange={(r) => r && nav(`/members/${r.abNumber}`)} placeholder="Find an AB" />
        </div>
      </header>

      <main className="px-4 sm:px-6 py-5 sm:py-6 pb-28 lg:pb-10 max-w-[1400px]">
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {[NAV[0]!, NAV[1]!, NAV[2]!, NAV[3]!].map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-leaf' : 'text-muted')
              }
            >
              <n.icon className="size-5" />
              {n.short}
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted">
            <Ellipsis className="size-5" />
            More
          </button>
        </div>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title="More">
        <div className="grid gap-1 -mx-2">
          {NAV.slice(4).map((n) => (
            <NavLink key={n.to} to={n.to} onClick={() => setMore(false)} className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-paper font-medium">
              <n.icon className="size-5 text-muted" />
              {n.label}
            </NavLink>
          ))}
          <button
            onClick={() => {
              setMore(false);
              signOut();
            }}
            className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-paper font-medium text-danger"
          >
            <LogOut className="size-5" /> Log out
          </button>
        </div>
      </Modal>
    </div>
  );
}
