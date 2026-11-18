// @ts-check

import { instantToLocal, isFirstDayOfMonth, isLastDayOfMonth, localToInstant } from "./time.js";
import { priceForTier, tierKeyForExtension } from "./pricing.js";
import { resolvePaymentAccount } from "../adapters/payments.mock.js";

export const PROACTIVE_LATE_TURNOVER = "queue_until_turnover";

/**
 * @param {any} input
 */
export function decideLateCheckout(input) {
  const { reservation, property, requestedDeparture, rule, followingNight, paymentAccounts } = input;
  const now = toDate(input.now);
  if (!rule.enabled) return fail("DISABLED");
  if (rule.pricing?.mode === "smart") return fail("CONFIG_UNSUPPORTED");

  const std = localToInstant(reservation.checkOutDate, property.stdCheckOutTime || "10:00", property.tz);
  const req = localToInstant(reservation.checkOutDate, requestedDeparture, property.tz);
  const extensionMin = Math.round((req.getTime() - std.getTime()) / 60000);
  if (extensionMin <= 0) return fail("NO_EXTENSION");
  if (requestedDeparture > rule.latestDepartureTime) return fail("AFTER_LATEST_DEPARTURE");
  if (rule.exceptions?.firstDayOfMonth && isFirstDayOfMonth(reservation.checkOutDate)) return fail("FIRST_DAY_OF_MONTH");
  if (rule.exceptions?.lastDayOfMonth && isLastDayOfMonth(reservation.checkOutDate)) return fail("LAST_DAY_OF_MONTH");

  const opens = rule.window?.opensHoursBefore;
  const closes = rule.window?.closesHoursBefore;
  if (opens != null && now.getTime() < std.getTime() - opens * 3600000) {
    const from = new Date(std.getTime() - opens * 3600000);
    const local = instantToLocal(from, property.tz);
    return fail("NOT_YET_OPEN", {
      availableFrom: { instant: from.toISOString(), local: local.local, timeZoneName: local.timeZoneName },
    });
  }
  if (closes != null && now.getTime() > std.getTime() - closes * 3600000) return fail("WINDOW_CLOSED");

  const tierKey = tierKeyForExtension(extensionMin);
  const tier = (rule.pricing?.tiers || []).find((item) => item.key === tierKey);
  if (!tier?.enabled) {
    return fail("TIER_DISABLED", {
      availableTiers: (rule.pricing?.tiers || []).filter((item) => item.enabled).map((item) => item.key),
    });
  }

  let needsBlock = false;
  if (rule.blockPolicy?.mode === "always") needsBlock = true;
  else if (rule.blockPolicy?.mode === "never") needsBlock = false;
  else needsBlock = extensionMin > Number(rule.blockPolicy?.thresholdHours) * 60;

  let calendarAction = "NONE";
  if (needsBlock) {
    if (followingNight?.status === "booked") return fail("FOLLOWING_NIGHT_BOOKED");
    if (followingNight?.status === "vacant") calendarAction = "BLOCK_FOLLOWING_NIGHT";
  }

  if (rule.exceptions?.onlyWhenTurnoverFits) {
    const cleanEnd = new Date(req.getTime() + Number(rule.turnover?.minimumCleanMinutes || 0) * 60000);
    const next = input.nextArrival;
    if (next?.date && next?.time) {
      const arrival = localToInstant(next.date, next.time, property.tz);
      if (cleanEnd.getTime() > arrival.getTime()) return fail("TURNOVER_TOO_SHORT");
    }
    if (input.cleanerShift?.end) {
      const shiftEnd = localToInstant(reservation.checkOutDate, input.cleanerShift.end, property.tz);
      if (cleanEnd.getTime() > shiftEnd.getTime()) return fail("CLEANER_SHIFT_ENDS");
    }
  }

  const paymentRoute = routePayment(reservation, property, paymentAccounts);
  if (paymentRoute.reasonCode) return fail(paymentRoute.reasonCode);
  const amount = priceForTier(tier, reservation.nightlyRate);
  return {
    available: true,
    reasonCode: "OK",
    extensionMin,
    tier: { key: tier.key, hours: tier.hours, enabled: true, amount: tier.amount, type: tier.type },
    price: { amount, currency: reservation.currency, basis: tier.type },
    calendarAction,
    night: reservation.checkOutDate,
    paymentRoute,
    ruleSource: input.ruleSource || { scope: "input", id: "rule", version: 0 },
    guestMessageKey: paymentRoute.route === "OTA_RESOLUTION_CENTRE" ? "guest.lateOta" : "guest.lateAvailable",
    opsMessageKey: "ops.lateOffice",
    housekeeperMessageKey: "ops.lateHousekeeper",
  };
}

/** @param {any} input */
export function scheduleLateOffer(input) {
  const { reservation, property, rule } = input;
  if (!rule.proactive?.enabled) return { status: "DISABLED" };
  const std = localToInstant(reservation.checkOutDate, property.stdCheckOutTime || "10:00", property.tz);
  const unitMs = rule.proactive.unit === "hours" ? 3600000 : 86400000;
  const sendAt = new Date(std.getTime() - Number(rule.proactive.value) * unitMs);
  const local = instantToLocal(sendAt, property.tz);
  const when = { instant: sendAt.toISOString(), local: local.local, timeZoneName: local.timeZoneName };
  const sameDay = input.nextArrival?.date === reservation.checkOutDate;
  if ((input.policy || PROACTIVE_LATE_TURNOVER) === PROACTIVE_LATE_TURNOVER && rule.exceptions?.onlyWhenTurnoverFits && sameDay) {
    return { status: "QUEUED_UNTIL_TURNOVER", sendAt: when };
  }
  const now = input.now instanceof Date ? input.now : new Date(input.now);
  if (sendAt.getTime() < now.getTime()) return { status: "SKIP_PAST", sendAt: when };
  return { status: "SCHEDULED", sendAt: when };
}

function routePayment(reservation, property, paymentAccounts) {
  if (reservation.channel === "airbnb") return { route: "OTA_RESOLUTION_CENTRE" };
  const account = resolvePaymentAccount(property, paymentAccounts);
  if (!account) return { reasonCode: "NO_PAYMENT_ACCOUNT" };
  const route = { route: "STRIPE", accountId: account.id, accountLabel: account.label };
  if (reservation.channel === "booking" || reservation.channel === "vrbo") route.otaPolicyCheck = true;
  return route;
}

function fail(reasonCode, extra = {}) {
  const result = {
    available: false,
    reasonCode,
    reasons: extra.reasons || [],
    guestMessageKey: reasonCode === "NOT_YET_OPEN" ? "guest.lateNotYetOpen" : "guest.lateUnavailable",
  };
  if (extra.availableFrom) result.availableFrom = extra.availableFrom;
  if (extra.availableTiers) result.availableTiers = extra.availableTiers;
  return result;
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}
