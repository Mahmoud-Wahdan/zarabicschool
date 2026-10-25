import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(/^[a-zA-Z0-9._-]+$/, "Username can only contain letters, numbers, dots, dashes and underscores");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[a-zA-Z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "Password is required").max(72),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required").max(72),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm the new password").max(72),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function rateLimitKeys(username: string, ip: string) {
  return [`login:user:${normalizeUsername(username)}`, `login:ip:${ip}`];
}
