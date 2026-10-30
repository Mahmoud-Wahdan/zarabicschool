"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "../../../i18n/navigation";
import EmptyState from "./empty-state";
import Icon, { type IconName } from "./icon";
import StatusBadge, { type BadgeTone } from "./status-badge";

/**
 * Shared table (owner, 2026-10-31): sort by clicking a column, quick filter chips and
 * an Excel export (CSV with a BOM so Excel reads Arabic). Rows arrive as plain,
 * already-formatted cells so a server page can pass them. Only pass columns the viewer
 * may see: the export writes exactly what the table shows.
 */
export type DataCell = {
  text: string;
  /** Sort key; defaults to the text. Use a number or an ISO string for dates and amounts. */
  sort?: string | number;
  tone?: BadgeTone;
  href?: string;
  strong?: boolean;
  /** Numbers and times: tabular digits, kept on one line. */
  numeric?: boolean;
};
export type DataColumn = { key: string; label: string; sortable?: boolean };
export type DataRow = { id: string; cells: Record<string, DataCell>; filter?: string };
export type QuickFilter = { key: string; label: string };

/** Spreadsheet formula injection: a cell starting with = + - @ is read as a formula. */
function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export default function DataTable({
  columns,
  rows,
  quickFilters,
  exportName,
  emptyTitle,
  emptyIcon = "inbox",
  initialSort,
  caption,
}: {
  columns: DataColumn[];
  rows: DataRow[];
  quickFilters?: QuickFilter[];
  /** File name without extension; omit to hide the export button. */
  exportName?: string;
  emptyTitle: string;
  emptyIcon?: IconName;
  initialSort?: { key: string; direction: "asc" | "desc" };
  /** Accessible name of the table. */
  caption: string;
}) {
  const t = useTranslations("dataTable");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState(initialSort ?? null);

  const visible = useMemo(() => {
    const filtered = filter === "all" ? rows : rows.filter((row) => row.filter === filter);
    if (!sort) return filtered;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = a.cells[sort.key]?.sort ?? a.cells[sort.key]?.text ?? "";
      const right = b.cells[sort.key]?.sort ?? b.cells[sort.key]?.text ?? "";
      if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * factor;
    });
  }, [rows, filter, sort]);

  const counts = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const row of rows) if (row.filter) byKey.set(row.filter, (byKey.get(row.filter) ?? 0) + 1);
    return byKey;
  }, [rows]);

  function toggleSort(key: string) {
    setSort((current) => (current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }));
  }

  function exportCsv() {
    const lines = [columns.map((column) => csvCell(column.label)).join(",")];
    for (const row of visible) lines.push(columns.map((column) => csvCell(row.cells[column.key]?.text ?? "")).join(","));
    const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${exportName}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const hasToolbar = Boolean(quickFilters?.length || exportName);

  const [titleColumn, ...detailColumns] = columns;
  const renderCell = (cell: DataCell) =>
    cell.tone ? (
      <StatusBadge tone={cell.tone}>{cell.text}</StatusBadge>
    ) : cell.href ? (
      <Link href={cell.href} className="font-semibold text-primary underline-offset-2 hover:underline">{cell.text}</Link>
    ) : (
      cell.text
    );

  return (
    <div className="flex min-w-0 flex-col">
      {hasToolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 sm:px-6">
          {quickFilters?.length ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filters")}>
              {[{ key: "all", label: t("all") }, ...quickFilters].map((item) => {
                const active = filter === item.key;
                const count = item.key === "all" ? rows.length : counts.get(item.key) ?? 0;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(item.key)}
                    className={`rounded-full border px-3 py-1 text-label-md transition-colors ${active ? "border-primary bg-primary text-on-primary" : "border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low"}`}
                  >
                    {item.label} <span className="tabular-nums opacity-75">{count}</span>
                  </button>
                );
              })}
            </div>
          ) : <span />}
          {exportName ? (
            <button type="button" className="btn btn-outline" onClick={exportCsv} disabled={visible.length === 0}>
              <Icon name="description" size={18} />
              <span>{t("export")}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState icon={emptyIcon} title={rows.length === 0 ? emptyTitle : t("noMatch")} />
      ) : (
        <>
        <ul className="divide-y divide-outline-variant border-t border-outline-variant md:hidden" aria-label={caption}>
          {visible.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 px-4 py-3">
              <p className="text-body-md font-semibold text-on-surface">{row.cells[titleColumn.key] ? renderCell(row.cells[titleColumn.key]) : "—"}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
                {detailColumns.map((column) => (
                  <div key={column.key} className="contents">
                    <dt className="text-on-surface-variant">{column.label}</dt>
                    <dd className={`text-on-surface ${row.cells[column.key]?.numeric ? "tabular-nums" : ""}`}>{row.cells[column.key] ? renderCell(row.cells[column.key]) : "—"}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="z-table min-w-[640px]" aria-label={caption}>
            <thead>
              <tr>
                {columns.map((column) => {
                  const sorted = sort?.key === column.key ? sort.direction : null;
                  return (
                    <th key={column.key} scope="col" aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}>
                      {column.sortable === false ? (
                        column.label
                      ) : (
                        <button type="button" className="inline-flex items-center gap-1 font-[inherit] hover:text-primary" onClick={() => toggleSort(column.key)}>
                          {column.label}
                          <span aria-hidden="true" className={sorted ? "text-primary" : "opacity-40"}>{sorted === "desc" ? "↓" : sorted === "asc" ? "↑" : "↕"}</span>
                          <span className="sr-only">{t("sortBy", { column: column.label })}</span>
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  {columns.map((column) => {
                    const cell = row.cells[column.key];
                    if (!cell) return <td key={column.key}>—</td>;
                    const content = renderCell(cell);
                    return (
                      <td key={column.key} className={`${cell.strong ? "font-semibold text-on-surface" : ""} ${cell.numeric ? "whitespace-nowrap tabular-nums" : ""}`}>
                        {content}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
