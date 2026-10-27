import { Link } from "../../../i18n/navigation";

/** Previous / next month links for the indicator pages (`?month=YYYY-MM`). */
export default function MonthNav({ month, basePath, labels }: { month: string; basePath: string; labels: { previous: string; next: string; nav: string } }) {
  const shift = (delta: number) => {
    const [year, value] = month.split("-").map(Number);
    const index = year * 12 + (value - 1) + delta;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  };
  return (
    <nav className="flex flex-wrap gap-2" aria-label={labels.nav}>
      <Link href={{ pathname: basePath, query: { month: shift(-1) } }} className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-md">{labels.previous}</Link>
      <Link href={{ pathname: basePath, query: { month: shift(1) } }} className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-md">{labels.next}</Link>
    </nav>
  );
}
