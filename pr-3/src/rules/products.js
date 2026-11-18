// @ts-check

import { TIER_KEYS } from "./schema.js";

function tiers() {
  return [
    { key: "1h", hours: 1, enabled: true, amount: 10, type: "pct_nightly" },
    { key: "2h", hours: 2, enabled: true, amount: 20, type: "pct_nightly" },
    { key: "3h", hours: 3, enabled: false, amount: 30, type: "pct_nightly" },
    { key: "4h+", hours: 4, enabled: true, amount: 60, type: "pct_nightly" },
  ];
}

export function defaultLateCheckout() {
  return {
    enabled: true,
    latestDepartureTime: "14:00",
    window: { opensHoursBefore: 16, closesHoursBefore: 1 },
    exceptions: { firstDayOfMonth: false, lastDayOfMonth: false, onlyWhenTurnoverFits: true },
    turnover: { minimumCleanMinutes: 120 },
    blockPolicy: { mode: "if_extension_over", thresholdHours: 1 },
    pricing: { mode: "custom", tiers: tiers() },
    proactive: { enabled: true, value: 1, unit: "days" },
  };
}

export function defaultExtraNights() {
  return {
    enabled: true,
    maxNights: 3,
    sides: { before: true, after: true },
    pricing: { mode: "nightly", discountPct: 0 },
    window: { closesHoursBefore: 24 },
    proactive: { enabled: true, value: 5, unit: "days" },
  };
}

export function defaultRiskRules() {
  return {
    lastMinute: { enabled: true, withinHours: 48 },
    flaggedCountries: { enabled: true, countries: ["ZZ"] },
    terseAnswers: { enabled: true, minCharacters: 12 },
    guestCount: { enabled: true, maxAdults: 8 },
  };
}

/** @param {ReturnType<typeof defaultLateCheckout>} rule */
export function validateLateCheckout(rule) {
  /** @type {{ path: string, message: string }[]} */
  const errors = [];
  if (!isTime(rule?.latestDepartureTime)) errors.push({ path: "latestDepartureTime", message: "Enter a time as HH:MM." });
  const open = rule?.window?.opensHoursBefore;
  const close = rule?.window?.closesHoursBefore;
  if (open != null && !isWhole(open, 0, 168)) errors.push({ path: "window.opensHoursBefore", message: "Enter a whole number of hours, or choose no limit." });
  if (close != null && !isWhole(close, 0, 168)) errors.push({ path: "window.closesHoursBefore", message: "Enter a whole number of hours, or choose no limit." });
  if (open != null && close != null && !(Number(open) > Number(close))) {
    errors.push({ path: "window", message: "The opening time must be further before check-out than the closing time." });
  }
  if (!isWhole(rule?.turnover?.minimumCleanMinutes, 30, 480)) {
    errors.push({ path: "turnover.minimumCleanMinutes", message: "Enter a whole number of minutes from 30 to 480." });
  }
  errors.push(...tierErrors(rule));
  if (!isWhole(rule?.proactive?.value, 1, 30)) errors.push({ path: "proactive.value", message: "Enter a whole number from 1 to 30." });
  return errors;
}

/** @param {ReturnType<typeof defaultExtraNights>} rule */
export function validateExtraNights(rule) {
  /** @type {{ path: string, message: string }[]} */
  const errors = [];
  if (!isWhole(rule?.maxNights, 1, 14)) errors.push({ path: "maxNights", message: "Enter a whole number of nights from 1 to 14." });
  if (!rule?.sides?.before && !rule?.sides?.after) errors.push({ path: "sides", message: "Allow nights before the stay, after the stay, or both." });
  if (rule?.pricing?.mode !== "nightly" && rule?.pricing?.mode !== "discount") {
    errors.push({ path: "pricing.mode", message: "Choose full nightly rate or a discount." });
  }
  if (!isWhole(rule?.pricing?.discountPct, 0, 100)) errors.push({ path: "pricing.discountPct", message: "Enter a discount from 0 to 100." });
  const close = rule?.window?.closesHoursBefore;
  if (close != null && !isWhole(close, 0, 168)) errors.push({ path: "window.closesHoursBefore", message: "Enter a whole number of hours, or choose no limit." });
  if (!isWhole(rule?.proactive?.value, 1, 30)) errors.push({ path: "proactive.value", message: "Enter a whole number from 1 to 30." });
  return errors;
}

function tierErrors(rule) {
  /** @type {{ path: string, message: string }[]} */
  const errors = [];
  const list = rule?.pricing?.tiers || [];
  if (list.length !== 4 || list.some((tier, index) => tier.key !== TIER_KEYS[index])) {
    errors.push({ path: "pricing.tiers", message: "The four departure lengths are required." });
  }
  for (const tier of list) {
    if (tier.type === "pct_nightly" && !(typeof tier.amount === "number" && tier.amount >= 0 && tier.amount <= 200)) {
      errors.push({ path: `pricing.tiers.${tier.key}.amount`, message: "Enter a percentage from 0 to 200." });
    }
    if (tier.type === "fixed" && !(typeof tier.amount === "number" && tier.amount >= 0)) {
      errors.push({ path: `pricing.tiers.${tier.key}.amount`, message: "Enter an amount of 0 or more." });
    }
  }
  if (rule?.enabled && rule?.pricing?.mode === "custom" && !list.some((tier) => tier.enabled)) {
    errors.push({ path: "pricing.tiers", message: "Turn on at least one departure length." });
  }
  return errors;
}

function isTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isWhole(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}
