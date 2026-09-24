export const MAX_ENTRIES = 10;
export const UINT64_MAX = (1n << 64n) - 1n;

export type Token = {
  symbol: string;
  decimals: number;
  address: string;
};

export type PaymentEntry = {
  id: string;
  recipient: string;
  amount: string;
};

export type Validation = {
  entries: Record<string, { recipient?: string; amount?: string }>;
  form?: string;
  total?: bigint;
};

export function parseTokenAmount(input: string, decimals: number): bigint {
  const value = input.trim();
  const whole = "(?:\\d+|\\d{1,3}(?:,\\d{3})+)";
  const pattern = new RegExp(`^${whole}(?:\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(value)) {
    throw new Error(`Enter an amount with at most ${decimals} decimal places.`);
  }

  const [integer, fraction = ""] = value.replace(/,/g, "").split(".");
  return BigInt(integer) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}

export function formatTokenAmount(value: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = value % unit;
  if (fraction === 0n) return whole.toLocaleString("en-US");
  return `${whole.toLocaleString("en-US")}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export function hasEnoughBalance(total: bigint, balance: bigint): boolean {
  return total <= balance;
}

function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function validateEntries(entries: PaymentEntry[], token: Token, multisendAddress: string): Validation {
  const validation: Validation = { entries: {} };
  if (entries.length < 1 || entries.length > MAX_ENTRIES) {
    validation.form = `A payment needs 1 to ${MAX_ENTRIES} entries.`;
    return validation;
  }

  let total = 0n;
  for (const entry of entries) {
    const errors: { recipient?: string; amount?: string } = {};
    if (!isAddress(entry.recipient)) {
      errors.recipient = "Enter a full 20-byte address.";
    } else if (entry.recipient.toLowerCase() === "0x0000000000000000000000000000000000000000") {
      errors.recipient = "The zero address is not a valid recipient.";
    } else if (entry.recipient.toLowerCase() === multisendAddress.toLowerCase()) {
      errors.recipient = "The multisend contract cannot receive a payment.";
    }

    try {
      const amount = parseTokenAmount(entry.amount, token.decimals);
      if (amount > UINT64_MAX) {
        errors.amount = "Amount is larger than encrypted uint64.";
      } else {
        total += amount;
        if (total > UINT64_MAX) errors.amount = "This entry makes the encrypted total overflow uint64.";
      }
    } catch (error) {
      errors.amount = error instanceof Error ? error.message : "Enter a valid amount.";
    }

    if (errors.recipient || errors.amount) validation.entries[entry.id] = errors;
  }

  if (Object.keys(validation.entries).length === 0) validation.total = total;
  return validation;
}
