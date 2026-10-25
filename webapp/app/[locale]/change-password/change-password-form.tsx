"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { changePasswordSchema } from "../../../lib/validation/auth";

type FieldErrors = Record<string, string[]>;

type ApiError = {
  error?: {
    code?: string;
    message?: string;
    fieldErrors?: Record<string, string[]>;
  };
};

function PasswordField({
  id,
  label,
  hint,
  autoComplete,
  icon,
  value,
  onChange,
  errors,
  toggleLabel,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  autoComplete: string;
  icon: string;
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
  toggleLabel: string;
  children?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center justify-between text-body-sm font-medium text-on-surface">
        <span>{label}</span>
        {hint ? <span className="text-label-sm text-on-surface-variant">{hint}</span> : null}
      </label>
      <div className="relative flex items-center">
        <span className="material-symbols-outlined pointer-events-none absolute end-3 text-[20px] text-outline" aria-hidden="true">
          {icon}
        </span>
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          dir="ltr"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="z-input h-11 rounded-lg bg-surface-container-lowest pe-10 ps-10 shadow-sm transition-all placeholder:text-outline focus:ring-2 focus:ring-secondary"
          aria-invalid={errors && errors.length > 0 ? "true" : undefined}
        />
        <button
          type="button"
          aria-label={toggleLabel}
          onClick={() => setVisible((state) => !state)}
          className="absolute start-2.5 flex items-center justify-center rounded p-1 text-outline transition-colors hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            {visible ? "visibility_off" : "visibility"}
          </span>
        </button>
      </div>
      {errors?.map((error) => (
        <p key={error} className="text-body-sm text-error">
          {error}
        </p>
      ))}
      {children}
    </div>
  );
}

export default function ChangePasswordForm({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("changePassword");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const strength = useMemo(() => {
    const rules = [/^.{8,}$/, /[a-zA-Z]/, /[0-9]/];
    const met = rules.filter((rule) => rule.test(newPassword)).length;
    if (met < rules.length) return met;
    return newPassword.length >= 12 ? 4 : 3;
  }, [newPassword]);

  const requirements = [
    { key: "reqLength", met: /^.{8,}$/.test(newPassword), icon: "radio_button_unchecked" },
    { key: "reqLetter", met: /[a-zA-Z]/.test(newPassword), icon: "radio_button_unchecked" },
    { key: "reqNumber", met: /[0-9]/.test(newPassword), icon: "radio_button_unchecked" },
  ];

  const matchStatus = confirmPassword
    ? confirmPassword === newPassword
      ? t("confirmMatch")
      : t("confirmMismatch")
    : "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});

    const parsed = changePasswordSchema.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }

    setPending(true);
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });

    if (!response.ok) {
      setPending(false);
      const apiError: ApiError = await response.json().catch(() => ({}));
      if (apiError.error?.fieldErrors) {
        setFieldErrors(apiError.error.fieldErrors);
      }
      setFormError(apiError.error?.message ?? t("unexpectedError"));
      return;
    }

    const sessionRefresh = await signIn("credentials", {
      redirect: false,
      username,
      password: parsed.data.newPassword,
    });
    if (!sessionRefresh || sessionRefresh.error) {
      setPending(false);
      setFormError(t("unexpectedError"));
      return;
    }

    router.replace(`/${locale}/${role.toLowerCase()}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <p className="text-label-md text-on-surface-variant">
        {t("account")}: <span dir="ltr" className="font-medium text-on-surface">{username}</span>
      </p>

      <PasswordField
        id="currentPassword"
        label={t("currentPassword")}
        hint={t("currentPasswordHint")}
        autoComplete="current-password"
        icon="key"
        value={currentPassword}
        onChange={setCurrentPassword}
        errors={fieldErrors.currentPassword}
        toggleLabel={t("togglePassword")}
      />

      <PasswordField
        id="newPassword"
        label={t("newPassword")}
        autoComplete="new-password"
        icon="lock"
        value={newPassword}
        onChange={setNewPassword}
        errors={fieldErrors.newPassword}
        toggleLabel={t("togglePassword")}
      >
        <div className="mt-1 flex w-full gap-1.5" aria-hidden="true">
          {[1, 2, 3, 4].map((bar) => (
            <span
              key={bar}
              className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                bar <= strength
                  ? bar <= 2
                    ? "bg-error"
                    : bar === 3
                      ? "bg-tertiary-container"
                      : "bg-secondary"
                  : "bg-surface-container"
              }`}
            />
          ))}
        </div>
      </PasswordField>

      <div className="flex flex-col gap-2 rounded-lg bg-surface p-3.5">
        <span className="text-label-sm font-medium text-on-surface-variant">{t("requirementsTitle")}</span>
        <div className="grid grid-cols-1 gap-2 text-body-sm sm:grid-cols-2">
          {requirements.map((requirement) => (
            <span
              key={requirement.key}
              className={`flex items-center gap-2 transition-colors ${
                requirement.met ? "text-secondary" : "text-on-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                {requirement.met ? "check_circle" : requirement.icon}
              </span>
              <span>{t(requirement.key)}</span>
            </span>
          ))}
        </div>
      </div>

      <PasswordField
        id="confirmPassword"
        label={t("confirmPassword")}
        hint={matchStatus || undefined}
        autoComplete="new-password"
        icon="lock_reset"
        value={confirmPassword}
        onChange={setConfirmPassword}
        errors={fieldErrors.confirmPassword}
        toggleLabel={t("togglePassword")}
      />

      {formError ? (
        <p role="alert" className="rounded-lg bg-error-container px-3.5 py-2.5 text-body-sm text-on-error-container">
          {formError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-secondary px-4 py-3 text-title-md font-semibold text-on-secondary shadow-sm transition-all duration-150 hover:bg-on-secondary-container active:scale-[0.99] disabled:opacity-60"
      >
        {pending ? (
          <span className="material-symbols-outlined animate-spin text-xl" aria-hidden="true">
            progress_activity
          </span>
        ) : null}
        <span>{pending ? t("submitting") : t("submit")}</span>
      </button>
    </form>
  );
}
