import type { ReactNode } from "react";

/**
 * Analytics charts (owner, 2026-10-31), server-rendered SVG following the dataviz
 * method: columns <= 24px with a 4px rounded data-end and a square base, a 2px surface
 * gap between stacked segments, 2px lines with >= 8px ringed markers, hairline solid
 * gridlines, a legend for two or more series, a selective direct label, a native
 * <title> tooltip on every mark (focusable group) and a table view for every chart.
 * Text never wears the series colour. Palette (validated, light surface, stack order):
 * completed #008f7f, missed #c2410c, scheduled #2f6db5 — ALL CHECKS PASS.
 */
export const CHART_COLORS = { completed: "var(--chart-completed)", missed: "var(--chart-missed)", scheduled: "var(--chart-scheduled)", single: "var(--chart-completed)" } as const;
const GRID = "var(--chart-grid, #e6e8ee)";
const SURFACE = "var(--color-surface-container-lowest, #ffffff)";
const MAX_BAR = 24;
const RADIUS = 4;

export function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

function topRounded(x: number, y: number, width: number, height: number) {
  const r = Math.min(RADIUS, width / 2, height);
  const base = y + height;
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${base} Z`;
}

/** Title, subtitle, legend, the plot and a table view. */
export function ChartCard({
  id,
  title,
  subtitle,
  legend,
  tableLabel,
  table,
  children,
  className = "",
}: {
  id: string;
  title: string;
  subtitle?: string;
  legend?: { label: string; color: string }[];
  tableLabel: string;
  table: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`z-card flex min-w-0 flex-col gap-3 rounded-xl p-4 sm:p-6 ${className}`} aria-labelledby={id}>
      <div>
        <h2 id={id} className="text-title-md font-bold text-primary">{title}</h2>
        {subtitle ? <p className="text-body-sm text-on-surface-variant">{subtitle}</p> : null}
      </div>
      {legend && legend.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-label-sm text-on-surface-variant">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
      {children}
      <details className="text-body-sm">
        <summary className="cursor-pointer text-label-md text-secondary">{tableLabel}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="z-table">
            <thead>
              <tr>{table.head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className="tabular-nums">{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

const W = 640;
const H = 220;
const PAD = { top: 18, right: 12, bottom: 30, left: 44 };
/** At most this many x-axis labels; the rest live in the tooltip and the table. */
const MAX_X_LABELS = 6;
const labelEvery = (count: number) => Math.max(1, Math.ceil(count / MAX_X_LABELS));

function Grid({ max, format, width = W }: { max: number; format: (value: number) => string; width?: number }) {
  const plotHeight = H - PAD.top - PAD.bottom;
  return (
    <g aria-hidden="true">
      {[0, max / 2, max].map((tick) => {
        const y = PAD.top + plotHeight - (tick / max) * plotHeight;
        return (
          <g key={tick}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" className="fill-on-surface-variant text-[13px]">{format(tick)}</text>
          </g>
        );
      })}
    </g>
  );
}

/** Stacked columns (bottom → top in `series` order). */
export function StackedColumns({
  label,
  buckets,
  series,
  format,
  width = W,
}: {
  label: string;
  buckets: { label: string; values: number[]; tooltip: string }[];
  series: { color: string }[];
  format: (value: number) => string;
  /** Drawing width: wider for a full-width card so the chart keeps a low height. */
  width?: number;
}) {
  const every = labelEvery(buckets.length);
  const totals = buckets.map((bucket) => bucket.values.reduce((sum, value) => sum + value, 0));
  const max = niceMax(Math.max(...totals, 0));
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = H - PAD.top - PAD.bottom;
  const baseline = PAD.top + plotHeight;
  const band = plotWidth / Math.max(buckets.length, 1);
  const barWidth = Math.min(MAX_BAR, band * 0.6);
  const peak = totals.indexOf(Math.max(...totals));
  return (
    <svg viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label} className="h-auto w-full" direction="ltr">
      <Grid max={max} format={format} width={width} />
      {buckets.map((bucket, index) => {
        const x = PAD.left + band * index + (band - barWidth) / 2;
        let top = baseline;
        const segments = bucket.values.map((value, seriesIndex) => {
          const height = (value / max) * plotHeight;
          const y = top - height;
          const isTop = bucket.values.slice(seriesIndex + 1).every((rest) => rest === 0);
          const gap = top === baseline ? 0 : 2;
          const segment = value > 0 ? (
            isTop ? (
              <path key={seriesIndex} d={topRounded(x, y, barWidth, Math.max(height - gap, 0))} fill={series[seriesIndex].color} />
            ) : (
              <rect key={seriesIndex} x={x} y={y} width={barWidth} height={Math.max(height - gap, 0)} fill={series[seriesIndex].color} />
            )
          ) : null;
          top = y;
          return segment;
        });
        return (
          <g key={bucket.label} tabIndex={0} aria-label={bucket.tooltip} className="outline-none focus-visible:[&>rect:first-of-type]:stroke-primary">
            <title>{bucket.tooltip}</title>
            <rect x={PAD.left + band * index} y={PAD.top} width={band} height={plotHeight} fill="transparent" strokeWidth={2} />
            {segments}
            {index === peak && totals[index] > 0 ? (
              <text x={x + barWidth / 2} y={top - 6} textAnchor="middle" className="fill-on-surface text-[13px] font-semibold">{format(totals[index])}</text>
            ) : null}
            {index % every === (buckets.length - 1) % every ? (
              <text x={x + barWidth / 2} y={H - 8} textAnchor="middle" className="fill-on-surface-variant text-[13px]">{bucket.label}</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** One series as a 2px line with ringed markers; null points leave a gap. */
export function LineSeries({
  label,
  points,
  max,
  format,
  color = CHART_COLORS.single,
  emptyLabel,
}: {
  label: string;
  /** Shown in the plot when no point has a value. */
  emptyLabel?: string;
  points: { label: string; value: number | null; tooltip: string }[];
  max: number;
  format: (value: number) => string;
  color?: string;
}) {
  const plotWidth = W - PAD.left - PAD.right;
  const plotHeight = H - PAD.top - PAD.bottom;
  const step = points.length > 1 ? plotWidth / (points.length - 1) : 0;
  const xy = points.map((point, index) => ({ ...point, x: PAD.left + step * index, y: point.value === null ? null : PAD.top + plotHeight - (point.value / max) * plotHeight }));
  const segments: string[] = [];
  let current = "";
  for (const point of xy) {
    if (point.y === null) {
      if (current) segments.push(current);
      current = "";
    } else current += `${current ? "L" : "M"}${point.x},${point.y} `;
  }
  if (current) segments.push(current);
  const last = [...xy].reverse().find((point) => point.y !== null);
  const every = labelEvery(points.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full" direction="ltr">
      <Grid max={max} format={format} />
      {segments.map((d) => <path key={d} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
      {xy.map((point) => (
        <g key={point.label} tabIndex={0} aria-label={point.tooltip} className="outline-none focus-visible:[&>rect]:stroke-primary">
          <title>{point.tooltip}</title>
          <rect x={point.x - step / 2} y={PAD.top} width={Math.max(step, 16)} height={plotHeight} fill="transparent" strokeWidth={2} />
          {point.y !== null ? <circle cx={point.x} cy={point.y} r={4} fill={color} stroke={SURFACE} strokeWidth={2} /> : null}
          {xy.indexOf(point) % every === (xy.length - 1) % every ? (
            <text x={point.x} y={H - 8} textAnchor="middle" className="fill-on-surface-variant text-[13px]">{point.label}</text>
          ) : null}
        </g>
      ))}
      {last && last.y !== null && last.value !== null ? (
        <text x={last.x - 6} y={last.y - 10} textAnchor="end" className="fill-on-surface text-[13px] font-semibold">{format(last.value)}</text>
      ) : null}
      {!last && emptyLabel ? (
        <text x={W / 2} y={PAD.top + (H - PAD.top - PAD.bottom) / 2} textAnchor="middle" className="fill-on-surface-variant text-[14px]">{emptyLabel}</text>
      ) : null}
    </svg>
  );
}

/** Horizontal bars, one series, longest first; the value sits past the bar end. */
export function BarList({
  label,
  items,
  color = CHART_COLORS.single,
}: {
  label: string;
  items: { name: string; value: number; valueLabel: string }[];
  color?: string;
}) {
  const max = Math.max(...items.map((item) => item.value), 0) || 1;
  return (
    <ul className="flex flex-col gap-2.5" aria-label={label}>
      {items.map((item) => (
        <li key={item.name} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3" title={`${item.name}: ${item.valueLabel}`}>
          <span className="truncate text-body-sm text-on-surface">{item.name}</span>
          <span className="flex items-center gap-2">
            <span className="h-4 rounded-e" style={{ width: `${Math.max((item.value / max) * 85, 1)}%`, background: color }} aria-hidden="true" />
            <span className="text-label-md font-semibold text-on-surface tabular-nums">{item.valueLabel}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
