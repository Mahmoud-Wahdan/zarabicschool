"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { loginSchema } from "../../../lib/validation/auth";

type FieldErrors = Record<string, string[]>;

type SessionResponse = {
  user?: { role?: string | null; mustChangePassword?: boolean } | null;
  error?: string;
};

export default function LoginForm() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("login");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      username: formData.get("username"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }

    setPending(true);
    const result = await signIn("credentials", {
      redirect: false,
      username: parsed.data.username,
      password: parsed.data.password,
    });

    if (!result || result.error) {
      setPending(false);
      setFormError(t("invalidCredentials"));
      return;
    }

    const response = await fetch("/api/auth/session");
    const session: SessionResponse = response.ok ? await response.json() : {};
    const role = session.user?.role;
    const destination = session.user?.mustChangePassword
      ? `/${locale}/change-password`
      : role
        ? `/${locale}/${role.toLowerCase()}`
        : `/${locale}`;
    router.replace(destination);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="username" className="mb-1.5 block text-sm font-semibold text-title-md text-primary">
          {t("username")}
        </label>
        <div className="relative flex items-center">
          <span className="material-symbols-outlined pointer-events-none absolute end-3 text-xl text-on-surface-variant" aria-hidden="true">
            person
          </span>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            dir="ltr"
            className="z-input rounded-lg bg-surface-container-low py-2.5 pe-10 transition-all duration-200 placeholder:text-outline focus:bg-surface-container-lowest focus:shadow-md"
          />
        </div>
        {fieldErrors.username?.map((error) => (
          <p key={error} className="mt-1 text-body-sm text-error">
            {error}
          </p>
        ))}
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-title-md text-primary">
          {t("password")}
        </label>
        <div className="relative flex items-center">
          <span className="material-symbols-outlined pointer-events-none absolute end-3 text-xl text-on-surface-variant" aria-hidden="true">
            lock
          </span>
          <input
            id="password"
            name="password"
            type={passwordVisible ? "text" : "password"}
            autoComplete="current-password"
            dir="ltr"
            className="z-input rounded-lg bg-surface-container-low py-2.5 pe-10 ps-10 transition-all duration-200 placeholder:text-outline focus:bg-surface-container-lowest focus:shadow-md"
          />
          <button
            type="button"
            aria-label={t("togglePassword")}
            onClick={() => setPasswordVisible((value) => !value)}
            className="absolute start-3 flex items-center text-on-surface-variant transition-colors hover:text-primary"
          >
            <span className="material-symbols-outlined text-xl" aria-hidden="true">
              {passwordVisible ? "visibility_off" : "visibility"}
            </span>
          </button>
        </div>
        {fieldErrors.password?.map((error) => (
          <p key={error} className="mt-1 text-body-sm text-error">
            {error}
          </p>
        ))}
      </div>

      {formError ? (
        <div role="alert" className="flex items-start gap-3 rounded-lg bg-error-container p-3.5">
          <span className="material-symbols-outlined mt-0.5 shrink-0 text-xl text-error" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
            error
          </span>
          <div className="flex-1">
            <p className="text-body-sm font-semibold text-on-error-container">{t("errorTitle")}</p>
            <p className="mt-0.5 text-body-sm text-on-error-container opacity-90">{formError}</p>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2.5 rounded-lg bg-surface-container-low p-3">
        <span className="material-symbols-outlined shrink-0 text-lg text-primary-container" aria-hidden="true">
          verified_user
        </span>
        <span className="text-body-sm leading-tight text-on-surface-variant">{t("rolesHint")}</span>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-secondary px-4 py-3 text-title-md font-semibold text-on-secondary shadow-sm transition-all duration-150 hover:bg-on-secondary-container active:scale-[0.99] disabled:opacity-60"
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
