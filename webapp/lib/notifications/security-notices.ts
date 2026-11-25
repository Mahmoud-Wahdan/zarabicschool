import { getMessagingProvider } from "../messaging/provider";
import { prisma } from "../prisma";
import { platformUrl } from "../config/platform-url";
import type { Prisma, UserSecurityAction } from "../../generated/prisma/client";

export type AccountNoticeField =
  | "username"
  | "displayName"
  | "email"
  | "phone"
  | "dateOfBirth"
  | "preferredLanguage"
  | "timezone"
  | "announcementsOptOut";

const TRACKED_ACCOUNT_FIELDS: readonly AccountNoticeField[] = [
  "username",
  "displayName",
  "email",
  "phone",
  "dateOfBirth",
  "preferredLanguage",
  "timezone",
  "announcementsOptOut",
];

const FIELD_LABELS: Record<"ar" | "en", Record<AccountNoticeField, string>> = {
  ar: {
    username: "اسم المستخدم",
    displayName: "الاسم الظاهر",
    email: "البريد الإلكتروني",
    phone: "رقم الهاتف",
    dateOfBirth: "تاريخ الميلاد",
    preferredLanguage: "اللغة المفضلة",
    timezone: "المنطقة الزمنية",
    announcementsOptOut: "إعدادات الإعلانات",
  },
  en: {
    username: "username",
    displayName: "display name",
    email: "email",
    phone: "phone number",
    dateOfBirth: "date of birth",
    preferredLanguage: "preferred language",
    timezone: "time zone",
    announcementsOptOut: "announcements preference",
  },
};

/**
 * Records an account security event and enqueues its corresponding generic
 * notification job within the provided transaction.
 *
 * Persists ONLY identifiers, the action enum, changed field keys, and the notice kind;
 * never persists credentials, field values, OTPs, cookies, or JWTs.
 */
export async function recordAccountSecurityEvent(
  tx: Prisma.TransactionClient,
  input: {
    academyId: string;
    actorUserId: string;
    targetUserId: string;
    action: UserSecurityAction;
    inAppOnly?: boolean;
    changedFields?: AccountNoticeField[];
  },
): Promise<{ eventId: string; notificationJobId: string }> {
  const event = await tx.userSecurityEvent.create({
    data: {
      academyId: input.academyId,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: input.action,
    },
    select: { id: true },
  });

  const now = new Date();
  const job = await tx.notificationJob.create({
    data: {
      academyId: input.academyId,
      recipientUserId: input.targetUserId,
      kind: "ACCOUNT_SECURITY_NOTICE",
      dedupKey: `ACCOUNT_SECURITY_NOTICE:${event.id}`,
      scheduledFor: now,
      // Reserve direct old-number sends before commit. The queue cannot send them to the new number.
      ...(input.inAppOnly ? { status: "PROCESSING", attempts: 1 } : {}),
      payload: {
        action: input.action,
        inAppOnly: Boolean(input.inAppOnly),
        ...(input.changedFields?.length ? { changedFields: input.changedFields } : {}),
      },
    },
    select: { id: true },
  });

  return { eventId: event.id, notificationJobId: job.id };
}

export function composeAccountSecurityNotice(
  language: "ar" | "en",
  loginUrl: string,
  options?: { action?: UserSecurityAction | string; changedFields?: AccountNoticeField[] },
): string {
  const action = options?.action;
  const fields = options?.changedFields?.filter((f): f is AccountNoticeField => f in FIELD_LABELS[language]) ?? [];

  if (action === "PASSWORD_RESET") {
    return language === "en"
      ? `Your account password was reset by the administration. Sign in to set a new password: ${loginUrl}`
      : `تم إعادة تعيين كلمة المرور لحسابك من قبل الإدارة. يرجى تسجيل الدخول لتعيين كلمة مرور جديدة: ${loginUrl}`;
  }
  if (action === "PASSWORD_CHANGED") {
    return language === "en"
      ? `Your account password was changed. If you did not make this change, contact the administration immediately: ${loginUrl}`
      : `تم تغيير كلمة المرور لحسابك. إذا لم تقم بذلك تواصل مع الإدارة فورًا: ${loginUrl}`;
  }
  if (action === "SESSIONS_REVOKED") {
    return language === "en"
      ? `All active sessions for your account were signed out by the administration: ${loginUrl}`
      : `تم تسجيل خروج جميع الجلسات النشطة لحسابك من قبل الإدارة: ${loginUrl}`;
  }
  if (action === "ACCOUNT_DEACTIVATED") {
    return language === "en"
      ? `Your account has been deactivated by the administration. Contact the administration for details: ${loginUrl}`
      : `تم إيقاف حسابك من قبل الإدارة. للمزيد يرجى التواصل مع الإدارة: ${loginUrl}`;
  }
  if (action === "ACCOUNT_ACTIVATED") {
    return language === "en"
      ? `Your account has been activated by the administration. You can sign in here: ${loginUrl}`
      : `تم تفعيل حسابك من قبل الإدارة. يمكنك تسجيل الدخول من هنا: ${loginUrl}`;
  }

  if (fields.includes("phone") && fields.length === 1) {
    return language === "en"
      ? `The phone number on your account was changed. If you did not make this change, contact the administration: ${loginUrl}`
      : `تم تغيير رقم الهاتف المسجل في حسابك. إذا لم تقم بذلك تواصل مع الإدارة: ${loginUrl}`;
  }

  if (fields.length > 0) {
    const labels = fields.map((f) => FIELD_LABELS[language][f]).join(language === "en" ? ", " : "، ");
    return language === "en"
      ? `Your account (${labels}) was updated. If you did not expect this change, contact the administration: ${loginUrl}`
      : `تم تحديث (${labels}) في حسابك. إذا لم تكن تتوقع هذا التغيير تواصل مع الإدارة: ${loginUrl}`;
  }

  return language === "en"
    ? `Your account information has changed. ${loginUrl}`
    : `تم تغيير معلومات حسابك. ${loginUrl}`;
}

type PhoneChangeNotice = {
  notificationJobId: string;
  userId: string;
  oldPhone: string | null;
  language: "ar" | "en";
  action: UserSecurityAction;
  changedFields: AccountNoticeField[];
};

export async function sendPhoneChangeNotice(input: PhoneChangeNotice): Promise<{ status: "SENT" | "FAILED" }> {
  const url = platformUrl(`/${input.language}/login`);
  let sent = false;
  try {
    if (input.oldPhone && url) {
      const result = await getMessagingProvider().sendText(
        { userId: input.userId, phone: input.oldPhone },
        composeAccountSecurityNotice(input.language, url, {
          action: input.action,
          changedFields: input.changedFields,
        }),
        { idempotencyKey: `notification-job:${input.notificationJobId}` },
      );
      sent = result.ok;
    }
  } catch {
    // Provider exceptions may include recipient data. Persist only the outcome.
  }
  const status = sent ? "SENT" : "FAILED";
  try {
    await prisma.notificationJob.update({
      where: { id: input.notificationJobId },
      data: { status, sentAt: sent ? new Date() : null, lastError: sent ? null : "Account notice delivery failed." },
      select: { id: true },
    });
  } catch {
    // The account transaction committed. Stale-job recovery will close this reserved job without retrying.
    return { status: "FAILED" };
  }
  return { status };
}

function listChangedFields(current: object, patch: object): AccountNoticeField[] {
  return TRACKED_ACCOUNT_FIELDS.filter((key) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return false;
    const value = Reflect.get(patch, key);
    if (value === undefined) return false;
    const previous = Reflect.get(current, key);
    if (value instanceof Date && previous instanceof Date) return value.getTime() !== previous.getTime();
    return value !== previous;
  });
}

/** Compare normalized scalar writes, including date-only fields represented as Date. */
export function accountFieldsChanged(current: object, patch: object): boolean {
  return Object.entries(patch).some(([key, value]) => {
    const previous = Reflect.get(current, key);
    if (value instanceof Date && previous instanceof Date) return value.getTime() !== previous.getTime();
    return value !== previous;
  });
}

export async function recordAccountUpdate(
  tx: Prisma.TransactionClient,
  actor: { id: string; academyId: string },
  target: { id: string; phone: string | null; preferredLanguage: string },
  patch: { phone?: string | null },
  action: UserSecurityAction = "ACCOUNT_UPDATED",
): Promise<PhoneChangeNotice | null> {
  const changedFields = listChangedFields(target, patch);
  const phoneChanged = patch.phone !== undefined && patch.phone !== target.phone;
  const { notificationJobId } = await recordAccountSecurityEvent(tx, {
    academyId: actor.academyId,
    actorUserId: actor.id,
    targetUserId: target.id,
    action,
    inAppOnly: phoneChanged,
    changedFields,
  });
  return phoneChanged
    ? {
        notificationJobId,
        userId: target.id,
        oldPhone: target.phone,
        language: target.preferredLanguage === "en" ? "en" : "ar",
        action,
        changedFields,
      }
    : null;
}
