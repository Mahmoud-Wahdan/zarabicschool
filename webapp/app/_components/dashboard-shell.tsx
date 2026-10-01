import type { ReactNode } from "react";

import SignOutButton from "./sign-out-button";

export default function DashboardShell({
  role,
  userName,
  children,
}: {
  role: string;
  userName: string;
  children: ReactNode;
}) {
  const roleLabel = { ADMIN: "الإدارة", TEACHER: "المعلمة", STUDENT: "الطالب", GUARDIAN: "ولي الأمر" }[role] ?? role;

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-bold text-[var(--navy)]">Zarabicschool</p>
            <p className="text-xs text-[var(--foreground)] opacity-60">{roleLabel}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--foreground)]">{userName}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
