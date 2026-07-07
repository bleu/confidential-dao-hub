const DECIMALS = 6n;
const ONE = 10n ** DECIMALS;

/** Formats a 6-decimal base-unit amount as a human string (e.g. 400000000n -> "400"). */
export function formatAmount(value: bigint): string {
  const whole = value / ONE;
  const frac = value % ONE;
  if (frac === 0n) return whole.toLocaleString("en-US");
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

/** Parses a human decimal string (e.g. "400.5") into 6-decimal base units. Throws on invalid input. */
export function parseAmount(input: string): bigint {
  const trimmed = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(trimmed)) {
    throw new Error("Enter a positive amount with at most 6 decimals");
  }
  const [whole, frac = ""] = trimmed.split(".");
  return BigInt(whole) * ONE + BigInt(frac.padEnd(6, "0") || "0");
}

/** Formats a 2-decimal price (210n -> "2.10"). */
export function formatPrice(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** Parses a human price string ("2.1" -> 210n, 2-decimal fixed point). */
export function parsePrice(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) {
    throw new Error("Enter a price with at most 2 decimals");
  }
  const [whole, frac = ""] = trimmed.split(".");
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0") || "0");
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatTimestamp(ts: bigint | number): string {
  const n = Number(ts);
  if (n === 0) return "—";
  return new Date(n * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
