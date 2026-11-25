"use client";

export function PrintEvidenceButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn btn-outline px-4 py-2 text-sm print:hidden"
    >
      {label}
    </button>
  );
}
