"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--foreground)] transition hover:border-[var(--emerald)] hover:text-[var(--emerald)]"
    >
      تسجيل الخروج
    </button>
  );
}
