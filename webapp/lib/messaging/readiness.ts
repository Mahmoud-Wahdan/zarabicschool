import "server-only";

import { prisma } from "../prisma";

let whatsAppDeliveryReady: boolean | null = null;

/**
 * True once migration 20261026000000_whatsapp_delivery_admin_messages is applied
 * (admin_messages table + notification_jobs.provider_message_id). Only a positive
 * result is cached, so the check self-heals after the owner applies it.
 */
export async function isWhatsAppDeliveryReady(): Promise<boolean> {
  if (whatsAppDeliveryReady === true) return true;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_messages') + " +
        "(SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_jobs' AND column_name = 'provider_message_id') AS count",
    )) as { count: number }[];
    whatsAppDeliveryReady = rows[0]?.count === 2;
  } catch {
    whatsAppDeliveryReady = null;
    return false;
  }
  return whatsAppDeliveryReady;
}
