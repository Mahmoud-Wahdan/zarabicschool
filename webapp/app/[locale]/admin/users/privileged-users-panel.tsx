"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type DirectoryUserRole = "ADMIN" | "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN";

export type DirectoryUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: DirectoryUserRole;
  isActive: boolean;
  timezone: string;
  dateOfBirth: string | null;
  preferredLanguage: string;
  announcementsOptOut: boolean;
};

type EditDraft = {
  username: string;
  displayName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  preferredLanguage: "ar" | "en";
  timezone: string;
  announcementsOptOut: boolean;
};

type PendingAction = "reset" | "deactivate" | "activate" | "revoke" | null;

function toDraft(account: DirectoryUser): EditDraft {
  return {
    username: account.username,
    displayName: account.displayName,
    email: account.email ?? "",
    phone: account.phone ?? "",
    dateOfBirth: account.dateOfBirth ?? "",
    preferredLanguage: account.preferredLanguage === "en" ? "en" : "ar",
    timezone: account.timezone,
    announcementsOptOut: account.announcementsOptOut,
  };
}

function buildAccountPatch(original: DirectoryUser, draft: EditDraft, isAdmin: boolean) {
  const patch: Record<string, string | boolean | null> = {};
  if (draft.username !== original.username) patch.username = draft.username;
  if (draft.displayName !== original.displayName) patch.displayName = draft.displayName;
  if (draft.email !== (original.email ?? "")) patch.email = draft.email || null;
  if (draft.phone !== (original.phone ?? "")) patch.phone = draft.phone || null;
  if (draft.dateOfBirth !== (original.dateOfBirth ?? "")) patch.dateOfBirth = draft.dateOfBirth || null;
  if (draft.preferredLanguage !== original.preferredLanguage) patch.preferredLanguage = draft.preferredLanguage;
  if (draft.timezone !== original.timezone) patch.timezone = draft.timezone;
  if (isAdmin && draft.announcementsOptOut !== original.announcementsOptOut) {
    patch.announcementsOptOut = draft.announcementsOptOut;
  }
  return patch;
}

export default function PrivilegedUsersPanel({
  initialUsers,
  currentUserId,
  isAdmin,
}: {
  initialUsers: DirectoryUser[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const t = useTranslations("privilegedUsers");
  const [users, setUsers] = useState<DirectoryUser[]>(initialUsers);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | DirectoryUserRole>("ALL");
  const [statusMessage, setStatusMessage] = useState("");
  const [createForm, setCreateForm] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "SUPERVISOR" as "ADMIN" | "SUPERVISOR",
  });

  const [editingUser, setEditingUser] = useState<DirectoryUser | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editingUser && !dialog.open) {
      dialog.showModal();
    } else if (!editingUser && dialog.open) {
      dialog.close();
    }
  }, [editingUser]);

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((account) => {
      if (!isAdmin && account.role === "ADMIN") return false;
      if (roleFilter !== "ALL" && account.role !== roleFilter) return false;
      if (!query) return true;
      return (
        account.displayName.toLowerCase().includes(query) ||
        account.username.toLowerCase().includes(query) ||
        (account.email?.toLowerCase().includes(query) ?? false) ||
        (account.phone?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [users, isAdmin, roleFilter, search]);

  function openEditor(account: DirectoryUser) {
    setEditingUser(account);
    setDraft(toDraft(account));
    setDialogError("");
    setPendingAction(null);
    setNewPassword("");
  }

  function closeEditor() {
    setEditingUser(null);
    setDraft(null);
    setDialogError("");
    setPendingAction(null);
    setNewPassword("");
  }

  async function createPrivilegedUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage("");
    setBusy(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? t("actionFailed"));
        return;
      }
      const created: DirectoryUser = {
        email: null,
        phone: null,
        timezone: "Africa/Cairo",
        dateOfBirth: null,
        preferredLanguage: "ar",
        announcementsOptOut: false,
        ...payload.data,
      };
      setUsers((current) => [...current, created]);
      setCreateForm({ username: "", displayName: "", password: "", role: "SUPERVISOR" });
      setStatusMessage(t("created"));
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser || !draft) return;
    const patch = buildAccountPatch(editingUser, draft, isAdmin);
    if (Object.keys(patch).length === 0) {
      closeEditor();
      return;
    }

    setBusy(true);
    setDialogError("");
    setStatusMessage("");
    try {
      const response = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await response.json();
      if (!response.ok) {
        setDialogError(payload.error?.message ?? t("actionFailed"));
        return;
      }
      const updatedFields = payload.data ?? patch;
      setUsers((current) =>
        current.map((item) => (item.id === editingUser.id ? { ...item, ...updatedFields } : item)),
      );
      closeEditor();
      setStatusMessage(payload.whatsappDelivery === "FAILED" ? t("deliveryWarning") : t("saved"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSecurityAction() {
    if (!editingUser || !pendingAction) return;
    setBusy(true);
    setDialogError("");
    setStatusMessage("");
    try {
      let url = `/api/admin/users/${editingUser.id}`;
      let init: RequestInit = { method: "PATCH" };
      if (pendingAction === "reset") {
        url = `/api/admin/users/${editingUser.id}/password`;
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: newPassword }),
        };
      } else if (pendingAction === "revoke") {
        url = `/api/admin/users/${editingUser.id}/sessions/revoke`;
        init = { method: "POST", body: undefined };
      } else {
        init = {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isActive: pendingAction === "activate" }),
        };
      }

      const response = await fetch(url, init);
      const payload = await response.json();
      if (!response.ok) {
        setDialogError(payload.error?.message ?? t("actionFailed"));
        return;
      }

      if (pendingAction === "deactivate" || pendingAction === "activate") {
        const nextActive = pendingAction === "activate";
        setUsers((current) =>
          current.map((item) => (item.id === editingUser.id ? { ...item, isActive: nextActive } : item)),
        );
      }

      const successKey =
        pendingAction === "reset"
          ? "passwordResetDone"
          : pendingAction === "revoke"
            ? "sessionsRevoked"
            : "accountUpdated";

      closeEditor();
      setStatusMessage(t(successKey));
    } finally {
      setBusy(false);
    }
  }

  const isSelf = editingUser?.id === currentUserId;
  const availableRoles: DirectoryUserRole[] = isAdmin
    ? ["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]
    : ["SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"];

  return (
    <div className="mt-6 space-y-6">
      {isAdmin ? (
        <form
          method="post"
          onSubmit={createPrivilegedUser}
          className="z-card grid gap-3 rounded-xl p-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <input
            required
            minLength={3}
            placeholder={t("username")}
            aria-label={t("username")}
            value={createForm.username}
            onChange={(event) => setCreateForm({ ...createForm, username: event.target.value })}
            className="z-input"
          />
          <input
            required
            minLength={2}
            placeholder={t("displayName")}
            aria-label={t("displayName")}
            value={createForm.displayName}
            onChange={(event) => setCreateForm({ ...createForm, displayName: event.target.value })}
            className="z-input"
          />
          <input
            required
            minLength={12}
            type="password"
            placeholder={t("password")}
            aria-label={t("password")}
            value={createForm.password}
            onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })}
            className="z-input"
          />
          <div className="flex gap-2">
            <select
              aria-label={t("role")}
              value={createForm.role}
              onChange={(event) =>
                setCreateForm({ ...createForm, role: event.target.value as "ADMIN" | "SUPERVISOR" })
              }
              className="z-input min-w-0 flex-1"
            >
              <option value="SUPERVISOR">{t("roles.SUPERVISOR")}</option>
              <option value="ADMIN">{t("roles.ADMIN")}</option>
            </select>
            <button type="submit" disabled={busy} className="btn btn-primary">
              {t("create")}
            </button>
          </div>
        </form>
      ) : null}

      <div className="z-card space-y-4 rounded-xl p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="search"
            aria-label={t("search")}
            placeholder={t("search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="z-input sm:max-w-xs"
          />
          <select
            aria-label={t("roleFilter")}
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as "ALL" | DirectoryUserRole)}
            className="z-input sm:max-w-[220px]"
          >
            <option value="ALL">{t("allRoles")}</option>
            {availableRoles.map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </select>
        </div>

        {statusMessage ? (
          <p role="status" className="text-body-sm text-on-surface-variant">
            {statusMessage}
          </p>
        ) : null}

        {visibleUsers.length === 0 ? (
          <p className="py-6 text-center text-body-sm text-on-surface-variant">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {visibleUsers.map((account) => (
              <li
                key={account.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-on-surface">{account.displayName}</span>
                    <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-label-sm text-on-surface-variant">
                      {t(`roles.${account.role}`)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-label-sm ${
                        account.isActive
                          ? "bg-primary-container/20 text-primary"
                          : "bg-error-container/30 text-error"
                      }`}
                    >
                      {account.isActive ? t("active") : t("inactive")}
                    </span>
                  </div>
                  <p className="text-body-sm text-on-surface-variant">
                    @{account.username} · {account.timezone}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEditor(account)}
                  className="btn btn-outline self-start sm:self-center"
                >
                  {t("edit")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editingUser && draft ? (
        <dialog
          ref={dialogRef}
          onClose={closeEditor}
          aria-labelledby="user-settings-dialog-title"
          className="z-card m-auto w-full max-w-xl rounded-2xl p-6 text-start backdrop:bg-primary/40"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 id="user-settings-dialog-title" className="text-title-lg font-semibold text-on-surface">
                {editingUser.displayName}
              </h2>
              <p className="text-label-md text-on-surface-variant">
                {t("role")}: {t(`roles.${editingUser.role}`)} · {editingUser.isActive ? t("active") : t("inactive")}
              </p>
            </div>
            <button type="button" onClick={closeEditor} className="btn btn-outline">
              {t("cancel")}
            </button>
          </div>

          <form onSubmit={saveProfile} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-label-md">
                <span>{t("username")}</span>
                <input
                  required
                  minLength={3}
                  value={draft.username}
                  onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                  className="z-input"
                />
              </label>
              <label className="flex flex-col gap-1 text-label-md">
                <span>{t("displayName")}</span>
                <input
                  required
                  minLength={1}
                  value={draft.displayName}
                  onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                  className="z-input"
                />
              </label>
              <label className="flex flex-col gap-1 text-label-md">
                <span>{t("email")}</span>
                <input
                  type="email"
                  value={draft.email}
                  onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                  className="z-input"
                />
              </label>
              <label className="flex flex-col gap-1 text-label-md">
                <span>{t("phone")}</span>
                <input
                  value={draft.phone}
                  onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                  className="z-input"
                />
              </label>
              <label className="flex flex-col gap-1 text-label-md">
                <span>{t("dateOfBirth")}</span>
                <input
                  type="date"
                  value={draft.dateOfBirth}
                  onChange={(event) => setDraft({ ...draft, dateOfBirth: event.target.value })}
                  className="z-input"
                />
              </label>
              <label className="flex flex-col gap-1 text-label-md">
                <span>{t("preferredLanguage")}</span>
                <select
                  value={draft.preferredLanguage}
                  onChange={(event) =>
                    setDraft({ ...draft, preferredLanguage: event.target.value === "en" ? "en" : "ar" })
                  }
                  className="z-input"
                >
                  <option value="ar">{t("languages.ar")}</option>
                  <option value="en">{t("languages.en")}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-label-md sm:col-span-2">
                <span>{t("timezone")}</span>
                <input
                  required
                  value={draft.timezone}
                  onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
                  className="z-input"
                />
              </label>
            </div>

            {isAdmin ? (
              <label className="flex items-center gap-2 pt-1 text-body-sm">
                <input
                  type="checkbox"
                  checked={draft.announcementsOptOut}
                  onChange={(event) => setDraft({ ...draft, announcementsOptOut: event.target.checked })}
                />
                <span>{t("optOut")}</span>
              </label>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button type="submit" disabled={busy} className="btn btn-primary">
                {t("save")}
              </button>
            </div>
          </form>

          <div className="mt-5 border-t border-outline-variant pt-4">
            <p className="mb-2 text-label-md font-semibold text-on-surface">{t("securitySection")}</p>
            {isSelf ? (
              <p className="mb-2 text-body-sm text-on-surface-variant">{t("selfProtectedHint")}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || isSelf}
                onClick={() => {
                  setPendingAction("reset");
                  setNewPassword("");
                  setDialogError("");
                }}
                className="btn btn-outline disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("reset")}
              </button>
              <button
                type="button"
                disabled={busy || isSelf}
                onClick={() => {
                  setPendingAction(editingUser.isActive ? "deactivate" : "activate");
                  setDialogError("");
                }}
                className="btn btn-outline disabled:cursor-not-allowed disabled:opacity-40"
              >
                {editingUser.isActive ? t("deactivate") : t("activate")}
              </button>
              <button
                type="button"
                disabled={busy || isSelf}
                onClick={() => {
                  setPendingAction("revoke");
                  setDialogError("");
                }}
                className="btn btn-ghost-danger disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("revoke")}
              </button>
            </div>

            {pendingAction ? (
              <div className="mt-4 space-y-3 rounded-xl border border-outline-variant bg-surface-container-low p-4">
                <p className="text-body-sm font-medium text-on-surface">
                  {pendingAction === "reset"
                    ? t("confirmReset")
                    : pendingAction === "revoke"
                      ? t("confirmRevoke")
                      : pendingAction === "deactivate"
                        ? t("confirmDeactivate")
                        : t("confirmActivate")}
                </p>
                {pendingAction === "reset" ? (
                  <label className="flex flex-col gap-1 text-label-md">
                    <span>{t("newPassword")}</span>
                    <input
                      type="password"
                      minLength={12}
                      required
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      className="z-input"
                    />
                  </label>
                ) : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingAction(null);
                      setNewPassword("");
                    }}
                    className="btn btn-outline"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={busy || (pendingAction === "reset" && newPassword.length < 12)}
                    onClick={confirmSecurityAction}
                    className="btn btn-primary"
                  >
                    {t("confirm")}
                  </button>
                </div>
              </div>
            ) : null}

            {dialogError ? (
              <p role="alert" className="mt-3 text-body-sm text-error">
                {dialogError}
              </p>
            ) : null}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
