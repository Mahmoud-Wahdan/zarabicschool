import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import type { RevenueBucket, RevenuePeriod } from "../../../lib/finance/revenue";
import { formatMoney } from "../../../lib/payments/format";
import { formatDateTime } from "../../../lib/schedules/display";

/**
 * EGP revenue columns for the Admin home (S-11 / D8). Server-rendered SVG, one
 * series (the title names it, so no legend box), dataviz marks: columns ≤ 24px with
 * a 4px rounded top and a square base, hairline solid gridlines, compact ticks, a
 * value label on the tallest column only. Hover/focus: every column is a focusable
 * group with a native <title> tooltip; the same values are in the table view.
 * Bar colour --chart-revenue (#008f7f) passed the palette validator vs #ffffff.
 */
const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 20, right: 12, bottom: 28, left: 56 };
const MAX_BAR = 24;
const RADIUS = 4;

function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

function columnPath(x: number, y: number, width: number, baseline: number) {
  const r = Math.min(RADIUS, width / 2, baseline - y);
  return `M${x},${baseline} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${baseline} Z`;
}

export default async function RevenueChart({ buckets, period, locale }: { buckets: RevenueBucket[]; period: RevenuePeriod; locale: string }) {
  const t = await getTranslations("revenueChart");
  const label = (key: string) => {
    const [year, part] = key.split("-");
    if (part.startsWith("Q")) return t("quarterLabel", { n: part.slice(1), year });
    if (part.startsWith("H")) return t("halfLabel", { n: part.slice(1), year });
    return formatDateTime(`${key}-15T12:00:00Z`, "UTC", locale, { month: "short", year: "2-digit" });
  };
  const pounds = buckets.map((bucket) => Number(bucket.totalMinor) / 100);
  const max = niceMax(Math.max(...pounds, 0));
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const baseline = PAD.top + plotHeight;
  const band = plotWidth / buckets.length;
  const barWidth = Math.min(MAX_BAR, band * 0.6);
  const compact = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB", { notation: "compact", maximumFractionDigits: 1 });
  const ticks = [0, max / 2, max];
  const tallest = pounds.indexOf(Math.max(...pounds));
  const money = (minor: bigint) => formatMoney(minor, "EGP", locale);
  const periods: RevenuePeriod[] = ["month", "quarter", "half"];

  return (
    <section className="z-card flex flex-col gap-3 rounded-xl p-4 sm:p-6" aria-labelledby="revenue-chart-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="revenue-chart-title" className="text-headline-sm font-bold text-primary">{t("title")}</h2>
          <p className="text-body-sm text-on-surface-variant">{t("subtitle")}</p>
        </div>
        <nav className="flex gap-1" aria-label={t("periodNav")}>
          {periods.map((value) => (
            <Link
              key={value}
              href={{ pathname: "/admin", query: { revenue: value } }}
              aria-current={value === period ? "true" : undefined}
              className={`rounded-full px-3 py-1 text-label-md ${value === period ? "bg-primary text-on-primary" : "border border-outline-variant"}`}
            >
              {t(`period.${value}`)}
            </Link>
          ))}
        </nav>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full text-on-surface-variant" direction="ltr" role="group" aria-label={t("title")}>
        {ticks.map((tick) => {
          const y = baseline - (tick / max) * plotHeight;
          return (
            <g key={tick}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor">{compact.format(tick)}</text>
            </g>
          );
        })}
        {buckets.map((bucket, index) => {
          const x = PAD.left + index * band;
          const height = (pounds[index] / max) * plotHeight;
          const top = baseline - height;
          const text = `${label(bucket.key)}: ${money(bucket.totalMinor)}`;
          return (
            <g key={bucket.key} tabIndex={0} aria-label={text} className="outline-none focus-visible:[&>rect]:stroke-primary">
              <title>{text}</title>
              <rect x={x} y={PAD.top} width={band} height={plotHeight} fill="transparent" strokeWidth={2} />
              {height > 0 ? <path d={columnPath(x + (band - barWidth) / 2, top, barWidth, baseline)} fill="var(--chart-revenue)" /> : null}
              {index === tallest && pounds[index] > 0 ? (
                <text x={x + band / 2} y={top - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor">{compact.format(pounds[index])}</text>
              ) : null}
              <text x={x + band / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="currentColor">{label(bucket.key)}</text>
            </g>
          );
        })}
      </svg>
      <details>
        <summary className="cursor-pointer text-label-md text-primary">{t("tableView")}</summary>
        <table className="mt-2 w-full text-start text-sm">
          <thead className="border-b border-outline-variant text-label-sm text-on-surface-variant">
            <tr>
              <th className="px-3 py-1.5 text-start">{t("colPeriod")}</th>
              <th className="px-3 py-1.5 text-start">{t("colRevenue")}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {buckets.map((bucket) => (
              <tr key={bucket.key} className="border-b border-outline-variant last:border-0">
                <td className="px-3 py-1.5">{label(bucket.key)}</td>
                <td className="px-3 py-1.5">{money(bucket.totalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
