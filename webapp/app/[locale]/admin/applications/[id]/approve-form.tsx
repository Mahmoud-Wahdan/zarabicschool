"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

type Body = {
  relationship?: "father" | "mother";
  existingGuardianId?: string;
  createGuardian?: { full_name: string; phone_whatsapp: string; relationship: "father" | "mother" };
  accounts?: { key: string; username: string }[];
  teachers?: Record<string, Record<string, string>>;
};

function subjectsOfAccount(
  applicationType: "GUARDIAN" | "STUDENT" | "TEACHER",
  details: Record<string, unknown>,
  key: string
): string[] {
  if (applicationType === "TEACHER") return [];
  if (key === "student") {
    return Array.isArray(details.subjects) ? details.subjects.filter((item): item is string => typeof item === "string") : [];
  }
  if (key.startsWith("child-")) {
    const index = Number(key.slice("child-".length));
    const children = Array.isArray(details.children) ? details.children : [];
    const child = children[index];
    if (child && typeof child === "object" && Array.isArray((child as { subjects?: unknown }).subjects)) {
      return ((child as { subjects: unknown[] }).subjects).filter((item): item is string => typeof item === "string");
    }
  }
  return [];
}

export default function ApproveForm({
  applicationType,
  details,
  childCount,
  subjectTeachersByEntry,
  busy,
  onSubmit,
  onError,
}: {
  applicationType: "GUARDIAN" | "STUDENT" | "TEACHER";
  details: Record<string, unknown>;
  childCount: number;
  subjectTeachersByEntry: Record<string, { teacherId: string; displayName: string }[]>;
  busy: boolean;
  onSubmit: (body: Body) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations("adminApplications");
  const [open, setOpen] = useState(false);
  const [relationship, setRelationship] = useState<"father" | "mother">("father");
  const [guardianMode, setGuardianMode] = useState<"existing" | "create">("create");
  const [existingGuardianId, setExistingGuardianId] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const keys = useMemo(() => {
    if (applicationType === "GUARDIAN") return ["guardian", ...Array.from({ length: childCount }, (_, i) => `child-${i}`)];
    if (applicationType === "STUDENT" && calculateAge(String(details.date_of_birth ?? "")) < 18) return ["guardian", "student"];
    return [applicationType === "TEACHER" ? "teacher" : "student"];
  }, [applicationType, childCount, details.date_of_birth]);
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [teacherSelections, setTeacherSelections] = useState<Record<string, Record<string, string>>>({});

  const accountSubjectEntries = useMemo(() => {
    return Object.fromEntries(keys.map((key) => [key, subjectsOfAccount(applicationType, details, key)]));
  }, [applicationType, details, keys]);

  async function submit() {
    const body: Body = { accounts: keys.map((key) => ({ key, username: usernames[key] ?? "" })).filter((item) => item.username) };
    if (applicationType === "GUARDIAN") body.relationship = relationship;
    if (applicationType === "STUDENT" && keys.includes("guardian")) {
      if (guardianMode === "existing") {
        if (!existingGuardianId.trim()) return onError(t("approveForm.existingGuardianRequired"));
        body.existingGuardianId = existingGuardianId.trim();
      } else {
        if (!guardianName.trim() || !guardianPhone.trim()) return onError(t("approveForm.guardianRequired"));
        body.createGuardian = { full_name: guardianName.trim(), phone_whatsapp: guardianPhone.trim(), relationship };
      }
    }
    if (applicationType !== "TEACHER") {
      const teachers: Record<string, Record<string, string>> = {};
      for (const [key, selections] of Object.entries(teacherSelections)) {
        for (const [entry, teacherId] of Object.entries(selections)) {
          if (!teacherId) continue;
          (teachers[key] ??= {})[entry] = teacherId;
        }
      }
      if (Object.keys(teachers).length > 0) body.teachers = teachers;
    }
    await onSubmit(body);
  }

  return (
    <>
      <button type="button" disabled={busy} onClick={() => setOpen((value) => !value)} className="rounded-lg bg-[var(--emerald)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {t("actions.approve")}
      </button>
      {open && (
        <div className="mt-4 basis-full rounded-lg border border-[var(--line)] bg-[var(--background)] p-4">
          <h3 className="font-semibold text-[var(--navy)]">{t("approveForm.title")}</h3>
          {applicationType === "GUARDIAN" && <RelationshipSelect value={relationship} onChange={setRelationship} t={t} />}
          {keys.includes("guardian") && applicationType === "STUDENT" && (
            <div className="mt-3 space-y-3">
              <p className="text-sm font-semibold">{t("approveForm.guardianMode")}</p>
              <div className="flex gap-4 text-sm">
                <label><input type="radio" checked={guardianMode === "existing"} onChange={() => setGuardianMode("existing")} /> {t("approveForm.guardianModeExisting")}</label>
                <label><input type="radio" checked={guardianMode === "create"} onChange={() => setGuardianMode("create")} /> {t("approveForm.guardianModeCreate")}</label>
              </div>
              {guardianMode === "existing" ? (
                <input value={existingGuardianId} onChange={(event) => setExistingGuardianId(event.target.value)} placeholder={t("approveForm.existingGuardian")} className="w-full rounded-lg border p-2 text-sm" />
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input value={guardianName} onChange={(event) => setGuardianName(event.target.value)} placeholder={t("approveForm.guardianName")} className="rounded-lg border p-2 text-sm" />
                  <input value={guardianPhone} onChange={(event) => setGuardianPhone(event.target.value)} placeholder={t("approveForm.guardianPhone")} className="rounded-lg border p-2 text-sm" />
                </div>
              )}
              <RelationshipSelect value={relationship} onChange={setRelationship} t={t} />
            </div>
          )}
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold">{t("approveForm.usernames")}</p>
            {keys.map((key, index) => (
              <input key={key} value={usernames[key] ?? ""} onChange={(event) => setUsernames((current) => ({ ...current, [key]: event.target.value }))} placeholder={t("approveForm.usernameFor", { account: accountLabel(t, key, index) })} className="w-full rounded-lg border p-2 text-sm" />
            ))}
            <p className="text-xs opacity-70">{t("approveForm.usernameHint")}</p>
          </div>
          {applicationType !== "TEACHER" && keys.some((key) => (accountSubjectEntries[key] ?? []).some((entry) => (subjectTeachersByEntry[entry] ?? []).length > 0)) ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-semibold">{t("approveForm.teachers.title")}</p>
              <p className="text-xs opacity-70">{t("approveForm.teachers.optional")}</p>
              {keys.map((key) => {
                const entries = (accountSubjectEntries[key] ?? []).filter((entry) => (subjectTeachersByEntry[entry] ?? []).length > 0);
                if (!entries.length) return null;
                return (
                  <div key={key} className="rounded-lg border border-[var(--line)] p-3">
                    <p className="text-xs font-semibold opacity-70">{accountLabel(t, key, Number(key.startsWith("child-") ? key.slice("child-".length) : 0))}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {entries.map((entry) => (
                        <label key={entry} className="block text-sm">
                          {entry}
                          <select
                            value={teacherSelections[key]?.[entry] ?? ""}
                            onChange={(event) => setTeacherSelections((current) => ({ ...current, [key]: { ...(current[key] ?? {}), [entry]: event.target.value } }))}
                            className="mt-1 w-full rounded-lg border p-2 text-sm"
                          >
                            <option value="">{t("approveForm.teachers.noTeacher")}</option>
                            {(subjectTeachersByEntry[entry] ?? []).map((teacher) => (
                              <option key={teacher.teacherId} value={teacher.teacherId}>{teacher.displayName}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          <button type="button" disabled={busy} onClick={() => void submit()} className="mt-4 rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? t("actions.submitting") : t("approveForm.confirm")}
          </button>
        </div>
      )}
    </>
  );
}

function RelationshipSelect({ value, onChange, t }: { value: "father" | "mother"; onChange: (value: "father" | "mother") => void; t: (key: string) => string }) {
  return <label className="mt-3 block text-sm">{t("approveForm.relationship")}<select value={value} onChange={(event) => onChange(event.target.value as "father" | "mother")} className="mt-1 block rounded-lg border p-2"><option value="father">{t("detail.relationships.father")}</option><option value="mother">{t("detail.relationships.mother")}</option></select></label>;
}

function accountLabel(t: (key: string, values?: Record<string, string>) => string, key: string, index: number) {
  if (key === "guardian") return t("approveForm.accounts.guardian");
  if (key === "student") return t("approveForm.accounts.student");
  if (key === "teacher") return t("approveForm.accounts.teacher");
  return t("approveForm.accounts.child", { index: String(index) });
}

function calculateAge(value: string) {
  const birth = new Date(value);
  if (!value || Number.isNaN(birth.getTime())) return 18;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
  return age;
}
