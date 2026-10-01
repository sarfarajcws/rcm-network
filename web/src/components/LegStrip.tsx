import clsx from 'clsx';
import { fmtPv } from '../utils/format';

/**
 * The leg strip: one bar split into the AB's Self PV followed by each direct
 * leg, proportional to PV. Lets the leader see at a glance where volume comes
 * from — and which legs are empty.
 */
const LEG_SHADES = ['#d99a1e', '#b9801a', '#e8b65a', '#9a6a12', '#f0c97f', '#c48b1c', '#7d560e', '#f4d9a6'];

export function legColor(i: number) {
  return LEG_SHADES[i % LEG_SHADES.length]!;
}

export function LegStrip({
  selfPv,
  legs,
  height = 'h-3',
  className,
}: {
  selfPv: number;
  legs: { pv: number; name: string }[];
  height?: string;
  className?: string;
}) {
  const total = selfPv + legs.reduce((s, l) => s + l.pv, 0);
  if (total <= 0) {
    return <div className={clsx('w-full rounded-full bg-line', height, className)} title="No PV this month" />;
  }
  return (
    <div className={clsx('flex w-full overflow-hidden rounded-full bg-line gap-px', height, className)} role="img" aria-label="PV split by self and legs">
      {selfPv > 0 && <div style={{ width: `${(selfPv / total) * 100}%`, background: '#1e7a57' }} title={`Self: ${fmtPv(selfPv)}`} />}
      {legs.map((l, i) =>
        l.pv > 0 ? <div key={i} style={{ width: `${(l.pv / total) * 100}%`, background: legColor(i) }} title={`${l.name}: ${fmtPv(l.pv)}`} /> : null,
      )}
    </div>
  );
}
