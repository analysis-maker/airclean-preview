// @ts-check

import { instantToLocal, isFirstDayOfMonth, isLastDayOfMonth, localToInstant } from "./time.js";
import { priceForTier, tierKeyForExtension } from "./pricing.js";
import { resolvePaymentAccount } from "../adapters/payments.mock.js";

/**
 * Deterministic early check-in decision. `now` is an input. No clock reads.
 *
 * @param {{
 *   now: Date | string | number,
 *   reservation: { id: string, propertyId: string, channel: string, checkInDate: string, nightlyRate: number, currency: string },
 *   property: { id: string, tz: string, stdCheckInTime: string, listingSetIds?: string[] },
 *   requestedArrival: string,
 *   rule: any,
 *   readiness: { status: string, reasons?: string[] },
 *   prevNight: { status: string, blockReason?: string },
 *   paymentAccounts: any,
 *   ruleSource?: { scope: string, id: string, version: number },
 * }} input
 */
export function decideEarlyCheckin(input) {
  const { reservation, property, requestedArrival, rule, readiness, prevNight, paymentAccounts } = input;
  const now = toDate(input.now);

  if (!rule.enabled) return fail("DISABLED");
  if (rule.pricing?.mode === "smart") return fail("CONFIG_UNSUPPORTED");

  const std = localToInstant(reservation.checkInDate, property.stdCheckInTime, property.tz);
  const req = localToInstant(reservation.checkInDate, requestedArrival, property.tz);
  const extensionMin = Math.round((std.getTime() - req.getTime()) / 60000);

  if (extensionMin <= 0) return fail("NO_EXTENSION");
  if (requestedArrival < rule.earliestArrivalTime) return fail("BEFORE_EARLIEST_ARRIVAL");
  if (rule.exceptions?.firstDayOfMonth && isFirstDayOfMonth(reservation.checkInDate)) {
    return fail("FIRST_DAY_OF_MONTH");
  }
  if (rule.exceptions?.lastDayOfMonth && isLastDayOfMonth(reservation.checkInDate)) {
    return fail("LAST_DAY_OF_MONTH");
  }

  const opens = rule.window?.opensHoursBefore;
  const closes = rule.window?.closesHoursBefore;
  if (opens != null && now.getTime() < std.getTime() - opens * 3600000) {
    const from = new Date(std.getTime() - opens * 3600000);
    const local = instantToLocal(from, property.tz);
    return fail("NOT_YET_OPEN", {
      availableFrom: {
        instant: from.toISOString(),
        local: local.local,
        timeZoneName: local.timeZoneName,
      },
    });
  }
  if (closes != null && now.getTime() > std.getTime() - closes * 3600000) {
    return fail("WINDOW_CLOSED");
  }

  const tierKey = tierKeyForExtension(extensionMin);
  const tier = (rule.pricing?.tiers || []).find((item) => item.key === tierKey);
  if (!tier?.enabled) {
    const availableTiers = (rule.pricing?.tiers || []).filter((item) => item.enabled).map((item) => item.key);
    return fail("TIER_DISABLED", { availableTiers });
  }

  let needsBlock = false;
  if (rule.blockPolicy?.mode === "always") needsBlock = true;
  else if (rule.blockPolicy?.mode === "never") needsBlock = false;
  else needsBlock = extensionMin > Number(rule.blockPolicy?.thresholdHours) * 60;

  let calendarAction = "NONE";
  if (needsBlock) {
    if (prevNight?.status === "booked") return fail("PREV_NIGHT_BOOKED");
    if (prevNight?.status === "vacant") calendarAction = "BLOCK_PREVIOUS_NIGHT";
  }

  if (rule.exceptions?.onlyWhenReady && readiness?.status !== "READY") {
    return fail("NOT_READY_YET", { reasons: readiness?.reasons ? [...readiness.reasons] : [] });
  }

  let paymentRoute;
  if (reservation.channel === "airbnb") {
    paymentRoute = { route: "OTA_RESOLUTION_CENTRE" };
  } else {
    const account = resolvePaymentAccount(property, paymentAccounts);
    if (!account) return fail("NO_PAYMENT_ACCOUNT");
    paymentRoute = {
      route: "STRIPE",
      accountId: account.id,
      accountLabel: account.label,
    };
    if (reservation.channel === "booking" || reservation.channel === "vrbo") {
      paymentRoute.otaPolicyCheck = true;
    }
  }

  const amount = priceForTier(tier, reservation.nightlyRate);
  const guestMessageKey = paymentRoute.route === "OTA_RESOLUTION_CENTRE" ? "guest.ota" : "guest.available";

  return {
    available: true,
    reasonCode: "OK",
    extensionMin,
    tier: {
      key: tier.key,
      hours: tier.hours,
      enabled: tier.enabled,
      amount: tier.amount,
      type: tier.type,
    },
    price: { amount, currency: reservation.currency, basis: tier.type },
    calendarAction,
    paymentRoute,
    ruleSource: input.ruleSource || { scope: "input", id: "rule", version: 0 },
    guestMessageKey,
    opsMessageKey: "ops.office",
  };
}

function fail(reasonCode, extra = {}) {
  const result = {
    available: false,
    reasonCode,
    reasons: extra.reasons || [],
    guestMessageKey: reasonCode === "NOT_YET_OPEN" ? "guest.notYetOpen" : "guest.unavailable",
  };
  if (extra.availableFrom) result.availableFrom = extra.availableFrom;
  if (extra.availableTiers) result.availableTiers = extra.availableTiers;
  return result;
}

function toDate(value) {
  if (value instanceof Date) return value;
  return new Date(value);
}
