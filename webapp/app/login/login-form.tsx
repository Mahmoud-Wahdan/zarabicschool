"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { loginSchema } from "../../lib/validation/auth";

type FieldErrors = Record<string, string[]>;

type SessionResponse = {
  user?: { mustChangePassword?: boolean } | null;
  error?: string;
};

export default function LoginForm() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);

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
      setFormError("اسم المستخدم أو كلمة المرور غير صحيحة، أو تم تجاوز عدد المحاولات المسموح. حاول مرة أخرى بعد قليل.");
      return;
    }

    const response = await fetch("/api/auth/session");
    const session: SessionResponse = response.ok ? await response.json() : {};
    const destination = session.user?.mustChangePassword ? "/change-password" : "/";
    router.replace(destination);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
      <div>
        <label htmlFor="username" className="block text-sm font-medium text-[var(--navy)]">
          اسم المستخدم
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          dir="ltr"
          className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-left focus:border-[var(--emerald)] focus:outline-none"
        />
        {fieldErrors.username?.map((error) => (
          <p key={error} className="mt-1 text-xs text-red-600">{error}</p>
        ))}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-[var(--navy)]">
          كلمة المرور
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-left focus:border-[var(--emerald)] focus:outline-none"
        />
        {fieldErrors.password?.map((error) => (
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
        {pending ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}
      </button>
    </form>
  );
}
