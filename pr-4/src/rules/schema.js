// @ts-check

/** Screenshot-equivalent sample rule. Callers clone it before editing. */
export function defaultSettings() {
  return {
    enabled: true,
    earliestArrivalTime: "09:00",
    window: { opensHoursBefore: 16, closesHoursBefore: 1 },
    exceptions: { firstDayOfMonth: false, lastDayOfMonth: false, onlyWhenReady: false },
    blockPolicy: { mode: "if_extension_over", thresholdHours: 1 },
    pricing: {
      mode: "custom",
      tiers: [
        { key: "1h", hours: 1, enabled: true, amount: 10, type: "pct_nightly" },
        { key: "2h", hours: 2, enabled: true, amount: 20, type: "pct_nightly" },
        { key: "3h", hours: 3, enabled: false, amount: 30, type: "pct_nightly" },
        { key: "4h+", hours: 4, enabled: true, amount: 60, type: "pct_nightly" },
      ],
    },
    proactive: { enabled: true, value: 3, unit: "days" },
  };
}

export const TIER_KEYS = ["1h", "2h", "3h", "4h+"];

/**
 * @param {ReturnType<typeof defaultSettings>} rule
 * @returns {{ path: string, message: string }[]}
 */
export function validateSettings(rule) {
  /** @type {{ path: string, message: string }[]} */
  const errors = [];
  if (!rule || typeof rule !== "object") {
    return [{ path: "rule", message: "Settings are missing." }];
  }

  if (!isValidTime(rule.earliestArrivalTime)) {
    errors.push({ path: "earliestArrivalTime", message: "Enter a time as HH:MM." });
  }

  const open = rule.window?.opensHoursBefore;
  const close = rule.window?.closesHoursBefore;
  if (open != null && !isWholeIn(open, 0, 168)) {
    errors.push({ path: "window.opensHoursBefore", message: "Enter a whole number of hours, or choose no limit." });
  }
  if (close != null && !isWholeIn(close, 0, 168)) {
    errors.push({ path: "window.closesHoursBefore", message: "Enter a whole number of hours, or choose no limit." });
  }
  if (open != null && close != null && !(Number(open) > Number(close))) {
    errors.push({
      path: "window",
      message: "The opening time must be further before check-in than the closing time.",
    });
  }

  const mode = rule.blockPolicy?.mode;
  if (mode !== "always" && mode !== "if_extension_over" && mode !== "never") {
    errors.push({ path: "blockPolicy.mode", message: "Choose when to block the previous night." });
  }
  const threshold = rule.blockPolicy?.thresholdHours;
  if (!isWholeIn(threshold, 1, 12)) {
    errors.push({ path: "blockPolicy.thresholdHours", message: "Enter a whole number from 1 to 12." });
  }

  if (rule.pricing?.mode !== "custom" && rule.pricing?.mode !== "smart") {
    errors.push({ path: "pricing.mode", message: "Choose a pricing mode." });
  }

  const tiers = Array.isArray(rule.pricing?.tiers) ? rule.pricing.tiers : [];
  if (tiers.length !== 4 || tiers.some((tier, index) => tier.key !== TIER_KEYS[index])) {
    errors.push({ path: "pricing.tiers", message: "The four arrival lengths are required." });
  }
  for (const tier of tiers) {
    if (tier.type !== "pct_nightly" && tier.type !== "fixed") {
      errors.push({ path: `pricing.tiers.${tier.key}.type`, message: "Choose a price type." });
    }
    if (tier.type === "pct_nightly" && !isNumberIn(tier.amount, 0, 200)) {
      errors.push({
        path: `pricing.tiers.${tier.key}.amount`,
        message: "Enter a percentage from 0 to 200.",
      });
    }
    if (tier.type === "fixed" && !isMoney(tier.amount)) {
      errors.push({
        path: `pricing.tiers.${tier.key}.amount`,
        message: "Enter an amount of 0 or more, with up to 2 decimal places.",
      });
    }
  }
  if (rule.enabled && rule.pricing?.mode === "custom" && !tiers.some((tier) => tier.enabled)) {
    errors.push({ path: "pricing.tiers", message: "Turn on at least one arrival length." });
  }

  const proactive = rule.proactive || {};
  if (proactive.unit !== "days" && proactive.unit !== "hours") {
    errors.push({ path: "proactive.unit", message: "Choose days or hours." });
  }
  if (!isWholeIn(proactive.value, 1, 30)) {
    errors.push({ path: "proactive.value", message: "Enter a whole number from 1 to 30." });
  }

  return errors;
}

function isValidTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isWholeIn(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isNumberIn(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  const scaled = Math.round(value * 100);
  return Math.abs(value * 100 - scaled) < 1e-6;
}
