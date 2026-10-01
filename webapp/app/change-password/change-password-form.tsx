"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { changePasswordSchema } from "../../lib/validation/auth";

type FieldErrors = Record<string, string[]>;

type ApiError = {
  error?: {
    code?: string;
    message?: string;
    fieldErrors?: Record<string, string[]>;
  };
};

export default function ChangePasswordForm({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const parsed = changePasswordSchema.safeParse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
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
      setFormError(apiError.error?.message ?? "حدث خطأ غير متوقع. حاول مرة أخرى.");
      return;
    }

    router.replace(`/${role.toLowerCase()}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
      <p className="text-xs text-[var(--foreground)] opacity-60">
        الحساب: <span dir="ltr" className="font-medium">{username}</span>
      </p>

      <div>
        <label htmlFor="currentPassword" className="block text-sm font-medium text-[var(--navy)]">
          كلمة المرور الحالية
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-left focus:border-[var(--emerald)] focus:outline-none"
        />
        {fieldErrors.currentPassword?.map((error) => (
          <p key={error} className="mt-1 text-xs text-red-600">{error}</p>
        ))}
      </div>

      <div>
        <label htmlFor="newPassword" className="block text-sm font-medium text-[var(--navy)]">
          كلمة المرور الجديدة
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-left focus:border-[var(--emerald)] focus:outline-none"
        />
        {fieldErrors.newPassword?.map((error) => (
          <p key={error} className="mt-1 text-xs text-red-600">{error}</p>
        ))}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-[var(--navy)]">
          تأكيد كلمة المرور الجديدة
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-left focus:border-[var(--emerald)] focus:outline-none"
        />
        {fieldErrors.confirmPassword?.map((error) => (
          <p key={error} className="mt-1 text-xs text-red-600">{error}</p>
        ))}
      </div>

      {formError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-[var(--emerald)] py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "جارٍ التغيير..." : "تغيير كلمة المرور"}
      </button>
    </form>
  );
}
