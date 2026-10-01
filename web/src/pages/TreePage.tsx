import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Maximize, Minus, Plus, Rows3, Workflow } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { treeApi } from '../api/endpoints';
import { MemberPicker } from '../components/MemberPicker';
import { Alert, ErrorState, errorMessage, Loading, PageHeader, Segmented, Spinner } from '../components/ui';
import { useMonth } from '../hooks/useMonth';
import type { TreeNode } from '../types/api';
import { fmtInt, fmtPv, monthLabel } from '../utils/format';

interface TreeCtx {
  month: string;
  expanded: Set<string>;
  toggle: (ab: string) => void;
  located: string | null;
  open: (ab: string) => void;
}
const Ctx = createContext<TreeCtx | null>(null);
const useTree = () => useContext(Ctx)!;

function useChildren(ab: string, enabled: boolean) {
  const { month } = useTree();
  return useQuery({ queryKey: ['tree-children', ab, month], queryFn: () => treeApi.children(ab, month), enabled, staleTime: 30_000 });
}

/**
 * Network tree. The tree is the same Sponsor hierarchy everywhere; `?root=AB`
 * starts it from any member (used by "Open in tree" on a profile).
 */
export function TreePage({ embeddedRoot }: { embeddedRoot?: string } = {}) {
  const { month } = useMonth();
  const [params, setParams] = useSearchParams();
  const rootAb = embeddedRoot ?? params.get('root') ?? null;
  const navigate = useNavigate();
  const isSmall = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
  const [view, setView] = useState<'chart' | 'outline'>(isSmall || embeddedRoot ? 'outline' : 'chart');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [located, setLocated] = useState<string | null>(null);
  const [locateError, setLocateError] = useState<string | null>(null);

  const root = useQuery({
    queryKey: ['tree-root', rootAb, month],
    queryFn: () => (rootAb ? treeApi.node(rootAb, month) : treeApi.root(month)),
  });

  // Expand the root by default.
  useEffect(() => {
    if (root.data) setExpanded((s) => (s.has(root.data.abNumber) ? s : new Set(s).add(root.data.abNumber)));
  }, [root.data]);

  const toggle = useCallback((ab: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(ab)) n.delete(ab);
      else n.add(ab);
      return n;
    });
  }, []);

  const locate = async (ab: string) => {
    setLocateError(null);
    try {
      const { path } = await treeApi.path(ab);
      const startIdx = root.data ? path.findIndex((p) => p.abNumber === root.data!.abNumber) : 0;
      if (startIdx < 0) {
        setLocateError('That AB is not inside this part of the tree.');
        return;
      }
      setExpanded((s) => {
        const n = new Set(s);
        path.slice(startIdx, -1).forEach((p) => n.add(p.abNumber));
        return n;
      });
      setLocated(ab);
    } catch (e) {
      setLocateError(errorMessage(e));
    }
  };

  const ctx = useMemo<TreeCtx>(
    () => ({ month, expanded, toggle, located, open: (ab) => navigate(`/members/${ab}`) }),
    [month, expanded, toggle, located, navigate],
  );

  const body = root.isLoading ? (
    <Loading label="Loading tree…" />
  ) : root.isError ? (
    <ErrorState error={root.error} onRetry={() => root.refetch()} />
  ) : (
    <Ctx.Provider value={ctx}>
      {view === 'chart' ? <ChartView root={root.data!} /> : <OutlineView root={root.data!} />}
    </Ctx.Provider>
  );

  const controls = (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
      <div className="sm:w-72">
        <MemberPicker value={null} onChange={(r) => r && locate(r.abNumber)} placeholder="Locate an AB in the tree" />
      </div>
      <Segmented
        label="Tree view"
        value={view}
        onChange={setView}
        options={[
          { value: 'chart', label: <span className="flex items-center gap-1.5"><Workflow className="size-4" />Chart</span> },
          { value: 'outline', label: <span className="flex items-center gap-1.5"><Rows3 className="size-4" />List</span> },
        ]}
      />
    </div>
  );

  if (embeddedRoot) {
    return (
      <div className="grid gap-3">
        {controls}
        {locateError && <Alert tone="warn">{locateError}</Alert>}
        {body}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Network tree"
        description={
          <>
            Sponsor-based tree, PV for {monthLabel(month)}.
            {rootAb && (
              <>
                {' '}Showing from AB {rootAb}.{' '}
                <button className="text-leaf font-medium" onClick={() => setParams({})}>
                  Show from Main Leader
                </button>
              </>
            )}
          </>
        }
      />
      {controls}
      {locateError && <Alert tone="warn">{locateError}</Alert>}
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart view: top-down org chart with pan & zoom
// ---------------------------------------------------------------------------

function ChartView({ root }: { root: TreeNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, s: 1 });
  type DragState = { x: number; y: number; moved: boolean; pointers: Map<number, { x: number; y: number }>; pinch?: number };
  const drag = useRef<DragState | null>(null);
  const { located } = useTree();

  const center = useCallback(() => {
    const vp = viewport.current;
    const canvas = vp?.querySelector<HTMLElement>('[data-canvas]');
    if (!vp || !canvas) return;
    const rootCard = canvas.querySelector<HTMLElement>('[data-node]');
    if (!rootCard) return;
    // Position of the root card inside the (possibly scaled) canvas, in canvas units.
    const scale = canvas.getBoundingClientRect().width / canvas.offsetWidth || 1;
    const left = (rootCard.getBoundingClientRect().left - canvas.getBoundingClientRect().left) / scale;
    setT({ x: vp.clientWidth / 2 - (left + rootCard.offsetWidth / 2), y: 24, s: 1 });
  }, []);

  // Keep the root centred while the first levels load, until the user moves the view.
  const userMoved = useRef(false);
  useEffect(() => {
    userMoved.current = false;
    const canvas = viewport.current?.querySelector<HTMLElement>('[data-canvas]');
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      if (!userMoved.current) center();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [center, root.abNumber]);

  // Bring a located node into view once it renders.
  useEffect(() => {
    if (!located) return;
    let tries = 0;
    const tick = () => {
      const vp = viewport.current;
      const el = vp?.querySelector<HTMLElement>(`[data-node="${located}"]`);
      if (vp && el) {
        userMoved.current = true;
        const vr = vp.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        setT((p) => ({ ...p, x: p.x + (vr.left + vr.width / 2 - (er.left + er.width / 2)), y: p.y + (vr.top + vr.height / 3 - (er.top + er.height / 2)) }));
        return;
      }
      if (tries++ < 30) setTimeout(tick, 150);
    };
    tick();
  }, [located]);

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    userMoved.current = true;
    const vp = viewport.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    setT((p) => {
      const s = Math.min(2, Math.max(0.25, p.s * factor));
      const k = s / p.s;
      return { s, x: px - (px - p.x) * k, y: py - (py - p.y) * k };
    });
  };

  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userMoved.current = true;
      const r = vp.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top);
      else setT((p) => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY }));
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    const d: DragState = drag.current ?? { x: e.clientX, y: e.clientY, moved: false, pointers: new Map() };
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.pointers.size === 2) {
      const [a, b] = [...d.pointers.values()];
      d.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
    drag.current = d;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !d.pointers.has(e.pointerId)) return;
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.pointers.size === 2 && d.pinch) {
      const [a, b] = [...d.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const r = viewport.current!.getBoundingClientRect();
      zoomAt(dist / d.pinch, (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top);
      d.pinch = dist;
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      d.moved = true;
      userMoved.current = true;
    }
    d.x = e.clientX;
    d.y = e.clientY;
    setT((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.pointers.delete(e.pointerId);
    if (d.pointers.size < 2) d.pinch = undefined;
    if (d.pointers.size === 0) drag.current = null;
  };

  return (
    <div className="card relative overflow-hidden">
      <div
        ref={viewport}
        className="h-[calc(100dvh-15rem)] min-h-[420px] cursor-grab active:cursor-grabbing touch-none select-none bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] [background-size:22px_22px]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div data-canvas className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}>
          <div className="org w-max pb-16">
            <ul className="!pt-0">
              <ChartNode node={root} />
            </ul>
          </div>
        </div>
      </div>
      <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
        <button className="btn-secondary !px-2.5 shadow-sm" onClick={() => zoomAt(1.2)} aria-label="Zoom in">
          <Plus className="size-4" />
        </button>
        <button className="btn-secondary !px-2.5 shadow-sm" onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out">
          <Minus className="size-4" />
        </button>
        <button className="btn-secondary !px-2.5 shadow-sm" onClick={center} aria-label="Reset view">
          <Maximize className="size-4" />
        </button>
      </div>
      <p className="absolute left-3 bottom-3 text-xs text-muted bg-surface/80 rounded px-2 py-1 hidden sm:block">
        Drag to move · Ctrl + scroll or pinch to zoom
      </p>
    </div>
  );
}

function ChartNode({ node }: { node: TreeNode }) {
  const { expanded, toggle, located, open } = useTree();
  const isOpen = expanded.has(node.abNumber);
  const kids = useChildren(node.abNumber, isOpen && node.directCount > 0);
  return (
    <li>
      <NodeCard node={node} isOpen={isOpen} onToggle={() => toggle(node.abNumber)} onOpen={() => open(node.abNumber)} located={located === node.abNumber} />
      {isOpen && node.directCount > 0 && (
        <ul>
          {kids.isLoading && (
            <li className="org-pending">
              <Spinner />
            </li>
          )}
          {kids.isError && (
            <li className="org-pending">
              <span className="text-xs text-danger">Could not load</span>
            </li>
          )}
          {kids.data?.map((c) => <ChartNode key={c.abNumber} node={c} />)}
        </ul>
      )}
    </li>
  );
}

function NodeCard({ node, isOpen, onToggle, onOpen, located }: { node: TreeNode; isOpen: boolean; onToggle: () => void; onOpen: () => void; located: boolean }) {
  const groupPv = node.totalPv - node.selfPv;
  return (
    <div
      data-node={node.abNumber}
      className={clsx(
        'relative w-48 rounded-xl border bg-surface text-left shadow-[0_1px_0_rgba(18,59,47,0.06)]',
        node.status === 'TERMINATED' ? 'border-danger/40 bg-danger-soft/30' : 'border-line-strong',
        located && 'node-located',
      )}
    >
      <button onClick={onOpen} className="block w-full px-3 pt-2.5 pb-2 text-left rounded-t-xl hover:bg-paper/70">
        <span className="flex items-center gap-1.5">
          <span className={clsx('size-2 rounded-full shrink-0', node.status === 'TERMINATED' ? 'bg-danger' : 'bg-leaf')} />
          <span className="font-semibold text-sm truncate">{node.name}</span>
        </span>
        <span className="block text-xs text-muted num mt-0.5">
          {node.abNumber}
          {node.kycStatus === 'NOT_OK' && <span className="ml-1.5 text-warn font-medium">KYC not OK</span>}
        </span>
        <span className="mt-2 flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-muted">Total PV</span>
          <span className="font-semibold num text-saffron-ink">{fmtPv(node.totalPv)}</span>
        </span>
        <span className="flex items-baseline justify-between gap-2 text-[11px] text-muted num">
          <span>Self {fmtPv(node.selfPv)}</span>
          <span>Group {fmtPv(groupPv)}</span>
        </span>
      </button>
      {node.directCount > 0 ? (
        <button
          onClick={onToggle}
          aria-expanded={isOpen}
          className="flex w-full items-center justify-center gap-1 border-t border-line py-1 text-xs font-medium text-leaf hover:bg-leaf-soft rounded-b-xl"
        >
          {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {node.directCount} {node.directCount === 1 ? 'leg' : 'legs'} · {fmtInt(node.downlineCount)} below
        </button>
      ) : (
        <div className="border-t border-line py-1 text-center text-[11px] text-faint">No downline</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outline view: indented list, best on phones and for very wide trees
// ---------------------------------------------------------------------------

function OutlineView({ root }: { root: TreeNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_7rem_7rem_6rem] gap-2 px-4 py-2 text-xs text-muted border-b border-line bg-paper/60">
        <span>AB</span>
        <span className="text-right">Self PV</span>
        <span className="text-right">Total PV</span>
        <span className="text-right">Downline</span>
      </div>
      <ul role="tree">
        <OutlineRow node={root} depth={0} />
      </ul>
    </div>
  );
}

function OutlineRow({ node, depth }: { node: TreeNode; depth: number }) {
  const { expanded, toggle, located } = useTree();
  const isOpen = expanded.has(node.abNumber);
  const kids = useChildren(node.abNumber, isOpen && node.directCount > 0);
  const indent = Math.min(depth, 12) * 16;
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (located === node.abNumber) rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [located, node.abNumber]);

  return (
    <li role="treeitem" aria-expanded={node.directCount ? isOpen : undefined}>
      <div
        ref={rowRef}
        className={clsx(
          'grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_7rem_7rem_6rem] gap-2 items-center pr-4 py-2 border-b border-line',
          located === node.abNumber && 'bg-saffron-soft',
        )}
        style={{ paddingLeft: 8 + indent }}
      >
        <div className="flex items-center gap-1 min-w-0">
          {node.directCount > 0 ? (
            <button onClick={() => toggle(node.abNumber)} className="p-1.5 rounded-md hover:bg-paper text-muted shrink-0" aria-label={isOpen ? 'Collapse' : 'Expand'}>
              {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ) : (
            <span className="w-7 shrink-0" />
          )}
          <Link to={`/members/${node.abNumber}`} className="min-w-0 hover:underline decoration-line-strong">
            <span className="flex items-center gap-1.5">
              <span className={clsx('size-2 rounded-full shrink-0', node.status === 'TERMINATED' ? 'bg-danger' : 'bg-leaf')} />
              <span className="font-medium truncate">{node.name}</span>
              {depth > 12 && <span className="text-[10px] text-faint">L{depth}</span>}
            </span>
            <span className="block text-xs text-muted num">
              {node.abNumber}
              {node.kycStatus === 'NOT_OK' && <span className="ml-1.5 text-warn">KYC not OK</span>}
              <span className="sm:hidden">{node.directCount > 0 && <> · {node.directCount} {node.directCount === 1 ? 'leg' : 'legs'} · {fmtInt(node.downlineCount)} below</>}</span>
            </span>
          </Link>
        </div>
        <span className="hidden sm:block text-right num text-sm">{fmtPv(node.selfPv)}</span>
        <span className="text-right num text-sm font-semibold text-saffron-ink">{fmtPv(node.totalPv)}</span>
        <span className="hidden sm:block text-right num text-sm text-muted">{fmtInt(node.downlineCount)}</span>
      </div>
      {isOpen && node.directCount > 0 && (
        <ul role="group">
          {kids.isLoading && (
            <li className="py-2 flex items-center gap-2 text-sm text-muted" style={{ paddingLeft: 40 + indent }}>
              <Spinner className="size-4 text-muted" /> Loading…
            </li>
          )}
          {kids.isError && (
            <li className="py-2 text-sm text-danger" style={{ paddingLeft: 40 + indent }}>
              {errorMessage(kids.error)}
            </li>
          )}
          {kids.data?.map((c) => <OutlineRow key={c.abNumber} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

