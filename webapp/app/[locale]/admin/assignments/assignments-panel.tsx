"use client";

import { useEffect, useState } from "react";

type Teacher = { id: string; displayName: string; teacherProfile?: { id: string; subjects: { subjectId: string }[] } | null };
type Subject = { id: string; nameEn: string; nameAr: string };

export default function AssignmentsPanel() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/admin/profiles?type=teacher"), fetch("/api/subjects")])
      .then(async ([teacherResponse, subjectResponse]) => {
        const [teacherPayload, subjectPayload] = await Promise.all([teacherResponse.json(), subjectResponse.json()]);
        setTeachers(teacherPayload.data ?? []);
        setSubjects(subjectPayload.data ?? subjectPayload);
      })
      .catch(() => setMessage("Unable to load assignments."));
  }, []);

  async function assign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/admin/teacher-subjects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ teacherId, subjectId }) });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.error?.message ?? "Unable to assign subject."); return; }
    setMessage("Assignment saved.");
  }

  return (
    <div className="mt-6 space-y-6">
      <form onSubmit={assign} className="dashboard-card grid gap-3 p-5 sm:grid-cols-3">
        <select required value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="rounded-lg border border-[var(--line)] px-3 py-2">
          <option value="">Choose teacher</option>
          {teachers.map((teacher) => <option key={teacher.teacherProfile?.id ?? teacher.id} value={teacher.teacherProfile?.id}>{teacher.displayName}</option>)}
        </select>
        <select required value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="rounded-lg border border-[var(--line)] px-3 py-2">
          <option value="">Choose subject</option>
          {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.nameEn} / {subject.nameAr}</option>)}
        </select>
        <button className="cta-primary rounded-lg px-3 py-2 text-sm">Assign subject</button>
        {message ? <p role="status" className="text-sm opacity-75 sm:col-span-3">{message}</p> : null}
      </form>
      <div className="dashboard-card p-5">
        <h2 className="font-semibold text-[var(--navy)]">Current assignments</h2>
        <div className="mt-4 space-y-2">{teachers.map((teacher) => <div key={teacher.id} className="rounded-lg bg-[var(--background)] p-3 text-sm"><strong>{teacher.displayName}</strong><span className="mx-2 opacity-60">·</span>{(teacher.teacherProfile?.subjects ?? []).map((item) => subjects.find((subject) => subject.id === item.subjectId)?.nameEn ?? item.subjectId).join(", ") || "No subjects assigned"}</div>)}</div>
      </div>
    </div>
  );
}
