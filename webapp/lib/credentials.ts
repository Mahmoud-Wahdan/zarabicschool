import "server-only";

import { randomInt } from "node:crypto";

import { slugifyName, usernamePattern } from "./validation/shared";

const passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const temporaryPasswordLength = 16;

export const defaultRandomDigits = (): number => randomInt(0, 1000);

export function generateUsername(
  displayName: string,
  randomDigits: () => number = defaultRandomDigits
): string | null {
  const slug = slugifyName(displayName);
  if (!slug) return null;
  const digits = String(Math.abs(Math.trunc(randomDigits())) % 1000).padStart(3, "0");
  return `${slug}${digits}`;
}

export function isValidUsername(username: string): boolean {
  return username.length >= 3 && username.length <= 30 && usernamePattern.test(username);
}

export function generateTemporaryPassword(): string {
  for (;;) {
    let password = "";
    for (let i = 0; i < temporaryPasswordLength; i += 1) {
      password += passwordAlphabet[randomInt(0, passwordAlphabet.length)];
    }
    if (/[a-zA-Z]/.test(password) && /[0-9]/.test(password)) {
      return password;
    }
  }
}

export { slugifyName };
