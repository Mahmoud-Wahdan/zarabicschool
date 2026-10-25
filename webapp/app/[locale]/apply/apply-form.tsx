"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, AlertCircle, Plus, Trash2 } from "lucide-react";
import { Link } from "../../../i18n/navigation";

export type SubjectOption = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
};

type RoleType = "guardian" | "student" | "teacher";

interface ApplyFormProps {
  type: RoleType;
  subjects: SubjectOption[];
  locale: string;
}

interface ChildFormState {
  name: string;
  age: string;
  subjects: string[];
}

export default function ApplyForm({ type, subjects, locale }: ApplyFormProps) {
  const t = useTranslations("applyForm");
  const formId = useId();

  // Common fields
  const [fullName, setFullName] = useState("");
  const [phoneWhatsapp, setPhoneWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [timezone] = useState("Africa/Cairo");
  const [preferredLanguage, setPreferredLanguage] = useState(locale === "en" ? "en" : "ar");
  const [preferredTimes, setPreferredTimes] = useState("");
  const [notes, setNotes] = useState("");
  const [honeypot, setHoneypot] = useState("");

  // Guardian fields
  const [children, setChildren] = useState<ChildFormState[]>([
    { name: "", age: "", subjects: [] },
  ]);

  // Student fields
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [studentSubjects, setStudentSubjects] = useState<string[]>([]);
  const [level, setLevel] = useState<"beginner" | "intermediate" | "advanced">("beginner");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianRelationship, setGuardianRelationship] = useState<"father" | "mother">("father");

  // Teacher fields
  const [teacherSubjects, setTeacherSubjects] = useState<string[]>([]);
  const [yearsExperience, setYearsExperience] = useState("");
  const [qualifications, setQualifications] = useState("");
  const [availableTimes, setAvailableTimes] = useState("");

  // State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Compute student age
  const isMinor = (() => {
    if (type !== "student" || !dateOfBirth) return false;
    const birth = new Date(`${dateOfBirth}T00:00:00Z`);
    if (isNaN(birth.getTime())) return false;
    const now = new Date();
    let age = now.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
    const dayDiff = now.getUTCDate() - birth.getUTCDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
    return age < 18;
  })();

  const handleAddChild = () => {
    if (children.length >= 10) return;
    setChildren([...children, { name: "", age: "", subjects: [] }]);
  };

  const handleRemoveChild = (index: number) => {
    if (children.length <= 1) return;
    setChildren(children.filter((_, i) => i !== index));
  };

  const handleChildChange = (index: number, field: "name" | "age", value: string) => {
    const updated = [...children];
    updated[index] = { ...updated[index], [field]: value };
    setChildren(updated);
  };

  const handleChildSubjectToggle = (childIndex: number, subjectSlug: string) => {
    const updated = [...children];
    const currentSubs = updated[childIndex].subjects;
    const nextSubs = currentSubs.includes(subjectSlug)
      ? currentSubs.filter((s) => s !== subjectSlug)
      : [...currentSubs, subjectSlug];
    updated[childIndex] = { ...updated[childIndex], subjects: nextSubs };
    setChildren(updated);
  };

  const handleSubjectToggle = (
    subjectSlug: string,
    current: string[],
    setter: (val: string[]) => void
  ) => {
    if (current.includes(subjectSlug)) {
      setter(current.filter((s) => s !== subjectSlug));
    } else {
      setter([...current, subjectSlug]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);

    // Build payload according to type
    let payload: Record<string, unknown> = {
      type: type.toUpperCase(),
      full_name: fullName.trim(),
      phone_whatsapp: phoneWhatsapp.trim(),
      email: email.trim() || undefined,
      timezone,
      preferred_language: preferredLanguage,
      preferred_times: preferredTimes.trim() || undefined,
      notes: notes.trim() || undefined,
      honeypot: honeypot || undefined,
    };

    if (type === "guardian") {
      payload = {
        ...payload,
        children: children.map((c) => ({
          name: c.name.trim(),
          age: parseInt(c.age, 10) || 0,
          subjects: c.subjects,
        })),
      };
    } else if (type === "student") {
      payload = {
        ...payload,
        date_of_birth: dateOfBirth,
        subjects: studentSubjects,
        level,
        guardian_name: isMinor ? guardianName.trim() : undefined,
        guardian_phone: isMinor ? guardianPhone.trim() : undefined,
        guardian_relationship: isMinor ? guardianRelationship : undefined,
      };
    } else if (type === "teacher") {
      payload = {
        ...payload,
        subjects: teacherSubjects,
        years_experience: parseInt(yearsExperience, 10) || 0,
        qualifications: qualifications.trim(),
        available_times: availableTimes.trim() || undefined,
      };
    }

    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.status === 201) {
        setIsSuccess(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (res.status === 400) {
        if (data.error?.fieldErrors) {
          setFieldErrors(data.error.fieldErrors);
        }
        setGeneralError(t("validationError"));
      } else if (res.status === 409) {
        setGeneralError(t("duplicateError"));
      } else if (res.status === 429) {
        setGeneralError(t("rateLimitError"));
      } else {
        setGeneralError(data.error?.message || t("generalError"));
      }
    } catch {
      setGeneralError(t("generalError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-16 w-16 text-[var(--emerald)]" />
        <h2 className="mt-4 text-2xl font-bold text-[var(--navy)]">{t("successTitle")}</h2>
        <p className="mt-3 leading-relaxed text-[var(--foreground)]/80">
          {t("successMessage")}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/" className="cta-primary">
            {t("backHome")}
          </Link>
          <button
            type="button"
            onClick={() => {
              setIsSuccess(false);
              setFullName("");
              setPhoneWhatsapp("");
              setEmail("");
              setChildren([{ name: "", age: "", subjects: [] }]);
              setDateOfBirth("");
              setStudentSubjects([]);
              setGuardianName("");
              setGuardianPhone("");
              setTeacherSubjects([]);
              setYearsExperience("");
              setQualifications("");
            }}
            className="cta-secondary"
          >
            {t("submitAnother")}
          </button>
        </div>
      </div>
    );
  }

  const roleTitle = t(`${type}Title`);
  const roleSubtitle = t(`${type}Subtitle`);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          href="/apply"
          className="text-sm font-semibold text-[var(--emerald)] hover:underline"
        >
          {t("backToRoles")}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-[var(--navy)] sm:text-3xl">
          {roleTitle}
        </h1>
        <p className="mt-1 text-sm text-[var(--foreground)]/80">{roleSubtitle}</p>
      </div>

      {generalError ? (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
          <p>{generalError}</p>
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit}
        noValidate
        className="space-y-6 rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm sm:p-8"
      >
        {/* Honeypot field (hidden from legitimate users) */}
        <div className="absolute left-[-9999px] h-0 w-0 overflow-hidden opacity-0" aria-hidden="true">
          <label htmlFor={`${formId}-hp`}>Leave this empty</label>
          <input
            id={`${formId}-hp`}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        {/* Full Name */}
        <div>
          <label htmlFor={`${formId}-name`} className="block text-sm font-semibold text-[var(--navy)]">
            {t("fullName")} <span className="text-red-500">*</span>
          </label>
          <input
            id={`${formId}-name`}
            type="text"
            required
            disabled={isSubmitting}
            placeholder={t("fullNamePlaceholder")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={`mt-1.5 w-full rounded-xl border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2 focus:ring-[var(--emerald)] ${
              fieldErrors.full_name ? "border-red-400 bg-red-50/50" : "border-[var(--line)] bg-white"
            }`}
          />
          {fieldErrors.full_name ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.full_name[0]}</p>
          ) : null}
        </div>

        {/* WhatsApp Phone */}
        <div>
          <label htmlFor={`${formId}-phone`} className="block text-sm font-semibold text-[var(--navy)]">
            {t("phoneWhatsapp")} <span className="text-red-500">*</span>
          </label>
          <input
            id={`${formId}-phone`}
            type="tel"
            required
            dir="ltr"
            disabled={isSubmitting}
            placeholder={t("phoneWhatsappPlaceholder")}
            value={phoneWhatsapp}
            onChange={(e) => setPhoneWhatsapp(e.target.value)}
            className={`mt-1.5 w-full rounded-xl border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2 focus:ring-[var(--emerald)] ${
              fieldErrors.phone_whatsapp ? "border-red-400 bg-red-50/50" : "border-[var(--line)] bg-white"
            }`}
          />
          {fieldErrors.phone_whatsapp ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.phone_whatsapp[0]}</p>
          ) : null}
        </div>

        {/* Email (Optional) */}
        <div>
          <label htmlFor={`${formId}-email`} className="block text-sm font-semibold text-[var(--navy)]">
            {t("email")}
          </label>
          <input
            id={`${formId}-email`}
            type="email"
            dir="ltr"
            disabled={isSubmitting}
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`mt-1.5 w-full rounded-xl border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2 focus:ring-[var(--emerald)] ${
              fieldErrors.email ? "border-red-400 bg-red-50/50" : "border-[var(--line)] bg-white"
            }`}
          />
          {fieldErrors.email ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.email[0]}</p>
          ) : null}
        </div>

        {/* Preferred Language */}
        <div>
          <label className="block text-sm font-semibold text-[var(--navy)]">
            {t("preferredLanguage")}
          </label>
          <div className="mt-2 flex gap-4">
            <label className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
              <input
                type="radio"
                name="preferred_language"
                value="ar"
                checked={preferredLanguage === "ar"}
                onChange={() => setPreferredLanguage("ar")}
                className="text-[var(--emerald)] focus:ring-[var(--emerald)]"
              />
              {t("langAr")}
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
              <input
                type="radio"
                name="preferred_language"
                value="en"
                checked={preferredLanguage === "en"}
                onChange={() => setPreferredLanguage("en")}
                className="text-[var(--emerald)] focus:ring-[var(--emerald)]"
              />
              {t("langEn")}
            </label>
          </div>
        </div>

        {/* ROLE SPECIFIC FIELDS */}

        {/* 1. GUARDIAN: Children Details */}
        {type === "guardian" ? (
          <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--background)] p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[var(--navy)]">{t("childrenSectionTitle")}</h3>
              {children.length < 10 ? (
                <button
                  type="button"
                  onClick={handleAddChild}
                  className="flex items-center gap-1 text-xs font-semibold text-[var(--emerald)] hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("addChild")}
                </button>
              ) : null}
            </div>

            {children.map((child, index) => (
              <div
                key={index}
                className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--emerald)]">
                    {t("childNumber", { num: index + 1 })}
                  </span>
                  {children.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => handleRemoveChild(index)}
                      className="flex items-center gap-1 text-xs text-red-600 hover:underline"
                    >
                      <Trash2 className="h-3 w-3" />
                      {t("removeChild")}
                    </button>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--navy)]">
                      {t("childName")} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      disabled={isSubmitting}
                      value={child.name}
                      onChange={(e) => handleChildChange(index, "name", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--emerald)]"
                    />
                    {fieldErrors[`children.${index}.name`] ? (
                      <p className="mt-1 text-xs text-red-600">
                        {fieldErrors[`children.${index}.name`][0]}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--navy)]">
                      {t("childAge")} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={3}
                      max={25}
                      required
                      disabled={isSubmitting}
                      value={child.age}
                      onChange={(e) => handleChildChange(index, "age", e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--emerald)]"
                    />
                    {fieldErrors[`children.${index}.age`] ? (
                      <p className="mt-1 text-xs text-red-600">
                        {fieldErrors[`children.${index}.age`][0]}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Child subjects checklist */}
                <div>
                  <label className="block text-xs font-semibold text-[var(--navy)]">
                    {t("childSubjects")} <span className="text-red-500">*</span>
                  </label>
                  {subjects.length === 0 ? (
                    <p className="mt-1 text-xs text-[var(--foreground)]/70">
                      {t("noSubjectsAvailable")}
                    </p>
                  ) : (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {subjects.map((sub) => {
                        const checked = child.subjects.includes(sub.slug);
                        const subName = locale === "en" ? sub.nameEn : sub.nameAr;
                        return (
                          <label
                            key={sub.id}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs transition ${
                              checked
                                ? "border-[var(--emerald)] bg-[var(--emerald)]/5 text-[var(--navy)] font-semibold"
                                : "border-[var(--line)] bg-white text-[var(--foreground)]"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleChildSubjectToggle(index, sub.slug)}
                              className="rounded text-[var(--emerald)] focus:ring-[var(--emerald)]"
                            />
                            <span>{subName}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {fieldErrors[`children.${index}.subjects`] ? (
                    <p className="mt-1 text-xs text-red-600">
                      {fieldErrors[`children.${index}.subjects`][0]}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* 2. STUDENT: DOB, Level, Subjects, Guardian Info if < 18 */}
        {type === "student" ? (
          <>
            <div>
              <label htmlFor={`${formId}-dob`} className="block text-sm font-semibold text-[var(--navy)]">
                {t("dateOfBirth")} <span className="text-red-500">*</span>
              </label>
              <input
                id={`${formId}-dob`}
                type="date"
                required
                disabled={isSubmitting}
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className={`mt-1.5 w-full rounded-xl border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2 focus:ring-[var(--emerald)] ${
                  fieldErrors.date_of_birth ? "border-red-400 bg-red-50/50" : "border-[var(--line)] bg-white"
                }`}
              />
              {fieldErrors.date_of_birth ? (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.date_of_birth[0]}</p>
              ) : null}
            </div>

            {/* Student Subjects */}
            <div>
              <label className="block text-sm font-semibold text-[var(--navy)]">
                {t("subjectsTitle")} <span className="text-red-500">*</span>
              </label>
              <p className="mt-0.5 text-xs text-[var(--foreground)]/70">{t("subjectsDescription")}</p>
              {subjects.length === 0 ? (
                <p className="mt-2 text-xs text-[var(--foreground)]/70">{t("noSubjectsAvailable")}</p>
              ) : (
                <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {subjects.map((sub) => {
                    const checked = studentSubjects.includes(sub.slug);
                    const subName = locale === "en" ? sub.nameEn : sub.nameAr;
                    return (
                      <label
                        key={sub.id}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm transition ${
                          checked
                            ? "border-[var(--emerald)] bg-[var(--emerald)]/5 text-[var(--navy)] font-semibold"
                            : "border-[var(--line)] bg-white text-[var(--foreground)]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleSubjectToggle(sub.slug, studentSubjects, setStudentSubjects)}
                          className="rounded text-[var(--emerald)] focus:ring-[var(--emerald)]"
                        />
                        <span>{subName}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {fieldErrors.subjects ? (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.subjects[0]}</p>
              ) : null}
            </div>

            {/* Level */}
            <div>
              <label htmlFor={`${formId}-level`} className="block text-sm font-semibold text-[var(--navy)]">
                {t("level")} <span className="text-red-500">*</span>
              </label>
              <select
                id={`${formId}-level`}
                value={level}
                disabled={isSubmitting}
                onChange={(e) => setLevel(e.target.value as "beginner" | "intermediate" | "advanced")}
                className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--emerald)]"
              >
                <option value="beginner">{t("levelBeginner")}</option>
                <option value="intermediate">{t("levelIntermediate")}</option>
                <option value="advanced">{t("levelAdvanced")}</option>
              </select>
            </div>

            {/* Minor Notice & Guardian Details */}
            {isMinor ? (
              <div className="rounded-2xl border border-[var(--gold)]/40 bg-[var(--gold)]/10 p-4 space-y-4 sm:p-5">
                <p className="text-xs font-semibold text-[var(--navy)] leading-relaxed">
                  {t("minorNotice")}
                </p>

                <div>
                  <label htmlFor={`${formId}-gname`} className="block text-xs font-semibold text-[var(--navy)]">
                    {t("guardianName")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={`${formId}-gname`}
                    type="text"
                    required
                    disabled={isSubmitting}
                    placeholder={t("guardianNamePlaceholder")}
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                    className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm transition outline-none focus:ring-2 focus:ring-[var(--emerald)] ${
                      fieldErrors.guardian_name ? "border-red-400 bg-red-50/50" : "border-[var(--line)] bg-white"
                    }`}
                  />
                  {fieldErrors.guardian_name ? (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.guardian_name[0]}</p>
                  ) : null}
                </div>

                <div>
                  <label htmlFor={`${formId}-gphone`} className="block text-xs font-semibold text-[var(--navy)]">
                    {t("guardianPhone")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={`${formId}-gphone`}
                    type="tel"
                    required
                    dir="ltr"
                    disabled={isSubmitting}
                    placeholder={t("guardianPhonePlaceholder")}
                    value={guardianPhone}
                    onChange={(e) => setGuardianPhone(e.target.value)}
                    className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm transition outline-none focus:ring-2 focus:ring-[var(--emerald)] ${
                      fieldErrors.guardian_phone ? "border-red-400 bg-red-50/50" : "border-[var(--line)] bg-white"
                    }`}
                  />
                  {fieldErrors.guardian_phone ? (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.guardian_phone[0]}</p>
                  ) : null}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--navy)]">
                    {t("guardianRelationship")} <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1.5 flex gap-4">
                    <label className="flex items-center gap-2 text-xs font-medium text-[var(--foreground)]">
                      <input
                        type="radio"
                        name="guardian_relationship"
                        value="father"
                        checked={guardianRelationship === "father"}
                        onChange={() => setGuardianRelationship("father")}
                        className="text-[var(--emerald)] focus:ring-[var(--emerald)]"
                      />
                      {t("relationshipFather")}
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-[var(--foreground)]">
                      <input
                        type="radio"
                        name="guardian_relationship"
                        value="mother"
                        checked={guardianRelationship === "mother"}
                        onChange={() => setGuardianRelationship("mother")}
                        className="text-[var(--emerald)] focus:ring-[var(--emerald)]"
                      />
                      {t("relationshipMother")}
                    </label>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {/* 3. TEACHER: Subjects, Experience, Qualifications, Available Times */}
        {type === "teacher" ? (
          <>
            <div>
              <label className="block text-sm font-semibold text-[var(--navy)]">
                {t("subjectsTitle")} <span className="text-red-500">*</span>
              </label>
              <p className="mt-0.5 text-xs text-[var(--foreground)]/70">{t("subjectsDescription")}</p>
              {subjects.length === 0 ? (
                <p className="mt-2 text-xs text-[var(--foreground)]/70">{t("noSubjectsAvailable")}</p>
              ) : (
                <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {subjects.map((sub) => {
                    const checked = teacherSubjects.includes(sub.slug);
                    const subName = locale === "en" ? sub.nameEn : sub.nameAr;
                    return (
                      <label
                        key={sub.id}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm transition ${
                          checked
                            ? "border-[var(--emerald)] bg-[var(--emerald)]/5 text-[var(--navy)] font-semibold"
                            : "border-[var(--line)] bg-white text-[var(--foreground)]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleSubjectToggle(sub.slug, teacherSubjects, setTeacherSubjects)}
                          className="rounded text-[var(--emerald)] focus:ring-[var(--emerald)]"
                        />
                        <span>{subName}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {fieldErrors.subjects ? (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.subjects[0]}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor={`${formId}-exp`} className="block text-sm font-semibold text-[var(--navy)]">
                {t("yearsExperience")} <span className="text-red-500">*</span>
              </label>
              <input
                id={`${formId}-exp`}
                type="number"
                min={0}
                max={50}
                required
                disabled={isSubmitting}
                placeholder="0"
                value={yearsExperience}
                onChange={(e) => setYearsExperience(e.target.value)}
                className={`mt-1.5 w-full rounded-xl border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2 focus:ring-[var(--emerald)] ${
                  fieldErrors.years_experience ? "border-red-400 bg-red-50/50" : "border-[var(--line)] bg-white"
                }`}
              />
              {fieldErrors.years_experience ? (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.years_experience[0]}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor={`${formId}-qual`} className="block text-sm font-semibold text-[var(--navy)]">
                {t("qualifications")} <span className="text-red-500">*</span>
              </label>
              <textarea
                id={`${formId}-qual`}
                rows={3}
                required
                disabled={isSubmitting}
                placeholder={t("qualificationsPlaceholder")}
                value={qualifications}
                onChange={(e) => setQualifications(e.target.value)}
                className={`mt-1.5 w-full rounded-xl border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2 focus:ring-[var(--emerald)] ${
                  fieldErrors.qualifications ? "border-red-400 bg-red-50/50" : "border-[var(--line)] bg-white"
                }`}
              />
              {fieldErrors.qualifications ? (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.qualifications[0]}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor={`${formId}-avail`} className="block text-sm font-semibold text-[var(--navy)]">
                {t("availableTimes")}
              </label>
              <input
                id={`${formId}-avail`}
                type="text"
                disabled={isSubmitting}
                placeholder={t("availableTimesPlaceholder")}
                value={availableTimes}
                onChange={(e) => setAvailableTimes(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--emerald)]"
              />
            </div>
          </>
        ) : null}

        {/* Preferred times for guardian or student */}
        {type !== "teacher" ? (
          <div>
            <label htmlFor={`${formId}-times`} className="block text-sm font-semibold text-[var(--navy)]">
              {t("preferredTimes")}
            </label>
            <input
              id={`${formId}-times`}
              type="text"
              disabled={isSubmitting}
              placeholder={t("preferredTimesPlaceholder")}
              value={preferredTimes}
              onChange={(e) => setPreferredTimes(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--emerald)]"
            />
          </div>
        ) : null}

        {/* Additional notes */}
        <div>
          <label htmlFor={`${formId}-notes`} className="block text-sm font-semibold text-[var(--navy)]">
            {t("notes")}
          </label>
          <textarea
            id={`${formId}-notes`}
            rows={2}
            disabled={isSubmitting}
            placeholder={t("notesPlaceholder")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--emerald)]"
          />
        </div>

        {/* Submit button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="cta-primary w-full justify-center text-center shadow-md disabled:opacity-60"
          >
            {isSubmitting ? t("submitting") : t("submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
