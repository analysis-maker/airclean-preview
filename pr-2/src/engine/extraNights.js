// @ts-check

import { shiftDate, localToInstant, instantToLocal } from "./time.js";
import { roundHalfUp } from "./pricing.js";
import { resolvePaymentAccount } from "../adapters/payments.mock.js";

/** @param {string} checkIn @param {string} checkOut @param {"before"|"after"} side @param {number} nights */
export function gapDates(checkIn, checkOut, side, nights) {
  const dates = [];
  for (let i = 0; i < nights; i += 1) {
    dates.push(side === "before" ? shiftDate(checkIn, -(nights - i)) : shiftDate(checkOut, i));
  }
  return dates;
}

/**
 * @param {any} input
 */
export function decideExtraNights(input) {
  const { reservation, property, rule, paymentAccounts } = input;
  const nights = Number(input.nights);
  const side = input.side;
  if (!rule.enabled) return fail("DISABLED");
  if (!Number.isInteger(nights) || nights < 1 || nights > Number(rule.maxNights)) return fail("NIGHT_COUNT");
  if (side !== "before" && side !== "after") return fail("SIDE_DISABLED");
  if (side === "before" && !rule.sides?.before) return fail("SIDE_DISABLED");
  if (side === "after" && !rule.sides?.after) return fail("SIDE_DISABLED");

  const anchorTime = side === "before" ? (property.stdCheckInTime || "15:00") : (property.stdCheckOutTime || "10:00");
  const anchorDate = side === "before" ? reservation.checkInDate : reservation.checkOutDate;
  const anchor = localToInstant(anchorDate, anchorTime, property.tz);
  const closes = rule.window?.closesHoursBefore;
  const now = input.now instanceof Date ? input.now : new Date(input.now);
  if (closes != null && now.getTime() > anchor.getTime() - closes * 3600000) return fail("WINDOW_CLOSED");

  const nightDates = gapDates(reservation.checkInDate, reservation.checkOutDate, side, nights);
  const occupied = input.occupied || nightDates.map((date) => ({ date, status: "vacant" }));
  const blocked = nightDates.filter((date) => {
    const row = occupied.find((item) => item.date === date) || { status: "vacant" };
    return row.status !== "vacant";
  });
  if (blocked.length) return fail("NIGHT_UNAVAILABLE", { nights: blocked });

  const discount = rule.pricing?.mode === "discount" ? Number(rule.pricing.discountPct || 0) : 0;
  const raw = reservation.nightlyRate * nights * (100 - discount) / 100;
  const amount = roundHalfUp(raw);
  const paymentRoute = routePayment(reservation, property, paymentAccounts);
  if (paymentRoute.reasonCode) return fail(paymentRoute.reasonCode);
  return {
    available: true,
    reasonCode: "OK",
    extensionMin: nights * 60,
    extensionHours: nights,
    nightDates,
    tier: { key: `${nights}n`, hours: nights, enabled: true, amount: discount, type: rule.pricing?.mode || "nightly" },
    price: { amount, currency: reservation.currency, basis: rule.pricing?.mode || "nightly" },
    calendarAction: "BLOCK_NIGHTS",
    paymentRoute,
    ruleSource: input.ruleSource || { scope: "input", id: "rule", version: 0 },
    guestMessageKey: paymentRoute.route === "OTA_RESOLUTION_CENTRE" ? "guest.extraOta" : "guest.extraAvailable",
    opsMessageKey: "ops.extraOffice",
    housekeeperMessageKey: "ops.extraHousekeeper",
  };
}

/** @param {any} input */
export function scheduleExtraOffer(input) {
  const { reservation, property, rule } = input;
  if (!rule.proactive?.enabled) return { status: "DISABLED" };
  const std = localToInstant(reservation.checkInDate, property.stdCheckInTime || "15:00", property.tz);
  const unitMs = rule.proactive.unit === "hours" ? 3600000 : 86400000;
  const sendAt = new Date(std.getTime() - Number(rule.proactive.value) * unitMs);
  const local = instantToLocal(sendAt, property.tz);
  const when = { instant: sendAt.toISOString(), local: local.local, timeZoneName: local.timeZoneName };
  const now = input.now instanceof Date ? input.now : new Date(input.now);
  if (sendAt.getTime() < now.getTime()) return { status: "SKIP_PAST", sendAt: when };
  return { status: "SCHEDULED", sendAt: when };
}

function routePayment(reservation, property, paymentAccounts) {
  if (reservation.channel === "airbnb") return { route: "OTA_RESOLUTION_CENTRE" };
  const account = resolvePaymentAccount(property, paymentAccounts);
  if (!account) return { reasonCode: "NO_PAYMENT_ACCOUNT" };
  return { route: "STRIPE", accountId: account.id, accountLabel: account.label };
}

function fail(reasonCode, extra = {}) {
  return {
    available: false,
    reasonCode,
    reasons: extra.nights || [],
    guestMessageKey: "guest.extraUnavailable",
  };
}
