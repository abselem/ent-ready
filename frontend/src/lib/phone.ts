/** Accept local ten digits or full +7 / 8 country-prefix paste without truncating a digit. */
export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && /^[78]/.test(digits)) return digits.slice(1);
  if (value.startsWith("+7")) return digits.slice(1, 11);
  return digits.slice(0, 10);
}
