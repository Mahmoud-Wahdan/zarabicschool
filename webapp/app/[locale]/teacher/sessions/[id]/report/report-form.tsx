"use client";

import { useState } from "react";

export default function ReportForm({ sessionId, studentId }: { sessionId: string; studentId: string }) {
  const [form, setForm] = useState({
    attendanceOutcome: "ATTENDED",
    classRemark: "",
    summary: "",
    homework: "",
    notes: "",
    extraTimeMinutes: 0,
    operationalEvents: "{}",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    let operationalEvents: Record<string, unknown> | undefined;
    try {
      operationalEvents = form.operationalEvents.trim() ? JSON.parse(form.operationalEvents) : undefined;
    } catch {
      setError("Operational events must be valid JSON.");
      return;
    }
    const response = await fetch(`/api/sessions/${sessionId}/students/${studentId}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, operationalEvents }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error?.message ?? "Unable to submit report.");
      return;
    }
    setMessage("Report submitted for Admin/Supervisor review. No payment is posted at submission.");
  }

  return (
    <form onSubmit={submit} className="dashboard-card mt-6 space-y-4 p-5">
      <select value={form.attendanceOutcome} onChange={(e) => setForm({ ...form, attendanceOutcome: e.target.value })} className="w-full rounded-lg border border-[var(--line)] px-3 py-2">
        <option value="ATTENDED">Student attended</option>
        <option value="STUDENT_ABSENT">Student absent</option>
      </select>
      <input required minLength={2} placeholder="Class remark" value={form.classRemark} onChange={(e) => setForm({ ...form, classRemark: e.target.value })} className="w-full rounded-lg border border-[var(--line)] px-3 py-2" />
      <textarea required minLength={2} placeholder="Lesson summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} className="min-h-28 w-full rounded-lg border border-[var(--line)] px-3 py-2" />
      <textarea placeholder="Homework" value={form.homework} onChange={(e) => setForm({ ...form, homework: e.target.value })} className="min-h-24 w-full rounded-lg border border-[var(--line)] px-3 py-2" />
      <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="min-h-24 w-full rounded-lg border border-[var(--line)] px-3 py-2" />
      <label className="block text-sm">Extra time minutes<input type="number" min={0} max={600} value={form.extraTimeMinutes} onChange={(e) => setForm({ ...form, extraTimeMinutes: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2" /></label>
      <textarea placeholder='Operational facts JSON, e.g. {"disconnectionMinutes":8}' value={form.operationalEvents} onChange={(e) => setForm({ ...form, operationalEvents: e.target.value })} className="min-h-24 w-full rounded-lg border border-[var(--line)] px-3 py-2 font-mono text-sm" />
      {error ? <p role="alert" className="text-sm text-[var(--status-danger)]">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-[var(--emerald)]">{message}</p> : null}
      <button className="cta-primary rounded-lg px-4 py-2">Submit report</button>
    </form>
  );
}
