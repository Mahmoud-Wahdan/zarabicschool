"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

type Body = {
  relationship?: "father" | "mother";
  existingGuardianId?: string;
  createGuardian?: { full_name: string; phone_whatsapp: string; relationship: "father" | "mother" };
  accounts?: { key: string; username: string }[];
};

export default function ApproveForm({
  applicationType,
  details,
  childCount,
  busy,
  onSubmit,
  onError,
}: {
  applicationType: "GUARDIAN" | "STUDENT" | "TEACHER";
  details: Record<string, unknown>;
  childCount: number;
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
