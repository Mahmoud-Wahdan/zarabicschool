export function isValidBirthDate(value: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value <= today.toISOString().slice(0, 10);
}

export function isAdultAge(age: number): boolean {
  return age >= 18;
}

export function calculateAdultStatus(dateOfBirth: string | Date | null, today = new Date()): boolean {
  if (!dateOfBirth) return false;
  const birthDate = dateOfBirth instanceof Date
    ? dateOfBirth
    : new Date(dateOfBirth + "T00:00:00Z");
  if (!Number.isFinite(birthDate.getTime())) return false;

  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDifference = today.getUTCMonth() - birthDate.getUTCMonth();
  const dayDifference = today.getUTCDate() - birthDate.getUTCDate();
  if (monthDifference < 0 || (monthDifference === 0 && dayDifference < 0)) age -= 1;

  return isAdultAge(age);
}

export function resolveAdultStatus(
  dateOfBirth: string | Date | null,
  storedIsAdult: boolean | null | undefined,
): boolean {
  return dateOfBirth ? calculateAdultStatus(dateOfBirth) : (storedIsAdult ?? false);
}
