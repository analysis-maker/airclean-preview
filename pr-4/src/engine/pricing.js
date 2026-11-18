// @ts-check

/** Half-up to a whole currency unit. Positive amounts only in this phase. */
export function roundHalfUp(amount) {
  if (!Number.isFinite(amount)) throw new Error("Amount is not a finite number");
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.trunc(abs);
  const frac = abs - whole;
  const rounded = frac + 1e-9 >= 0.5 ? whole + 1 : whole;
  return negative ? -rounded : rounded;
}

/** @param {number} extensionMin */
export function tierKeyForExtension(extensionMin) {
  const hours = Math.min(4, Math.ceil(extensionMin / 60));
  if (hours <= 1) return "1h";
  if (hours === 2) return "2h";
  if (hours === 3) return "3h";
  return "4h+";
}

/**
 * @param {{ type: string, amount: number }} tier
 * @param {number} nightlyRate
 */
export function priceForTier(tier, nightlyRate) {
  if (tier.type === "fixed") return roundHalfUp(Number(tier.amount));
  const raw = (Number(nightlyRate) * Number(tier.amount)) / 100;
  return roundHalfUp(raw);
}
