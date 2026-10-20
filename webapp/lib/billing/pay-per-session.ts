import "server-only";

import { prisma } from "../prisma";

export const PAY_PER_SESSION_SETTING_PREFIX = "billing.pay_per_session";
export const DEFAULT_PAY_PER_SESSION_MIN = 1;
export const DEFAULT_PAY_PER_SESSION_MAX = 16;

export type PayPerSessionConfig = {
  minSessions: number;
  maxSessions: number;
};

/**
 * Pay-per-session ("على كيفك") configuration:
 * Min 1, Max 16 (Admin-configurable in AcademySettings — CONTEXT §7.2 / §20.1).
 * Credits purchased under this package type never expire.
 */
export async function getPayPerSessionConfig(academyId: string): Promise<PayPerSessionConfig> {
  try {
    const settings = await prisma.academySetting.findMany({
      where: {
        academyId,
        key: {
          in: [
            `${PAY_PER_SESSION_SETTING_PREFIX}.min`,
            `${PAY_PER_SESSION_SETTING_PREFIX}.max`,
          ],
        },
      },
    });

    let minSessions = DEFAULT_PAY_PER_SESSION_MIN;
    let maxSessions = DEFAULT_PAY_PER_SESSION_MAX;

    for (const setting of settings) {
      const val = parseInt(setting.value, 10);
      if (Number.isSafeInteger(val) && val > 0) {
        if (setting.key.endsWith(".min")) minSessions = val;
        if (setting.key.endsWith(".max")) maxSessions = val;
      }
    }

    if (minSessions > maxSessions) minSessions = maxSessions;

    return { minSessions, maxSessions };
  } catch {
    return { minSessions: DEFAULT_PAY_PER_SESSION_MIN, maxSessions: DEFAULT_PAY_PER_SESSION_MAX };
  }
}

export function validatePayPerSessionCount(count: number, config: PayPerSessionConfig): { valid: boolean; error?: string } {
  if (!Number.isSafeInteger(count) || count < config.minSessions || count > config.maxSessions) {
    return {
      valid: false,
      error: `Number of sessions must be between ${config.minSessions} and ${config.maxSessions}.`,
    };
  }
  return { valid: true };
}
