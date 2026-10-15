/**
 * Rejected input is attacker-shaped text that can reach the agent through an error message, so echo
 * only a short, plain, quoted form of it. Non-strings are reported by type alone.
 */
export function safeEcho(value: unknown): string {
  if (typeof value !== "string") return `(a value of type ${value === null ? "null" : typeof value})`;
  const cleaned = value.slice(0, 24).replace(/[^A-Za-z0-9._/:~@+-]/g, "?");
  return `"${cleaned}${value.length > 24 ? "..." : ""}"`;
}
