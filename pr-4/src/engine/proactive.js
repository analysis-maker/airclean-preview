// @ts-check

import { instantToLocal, localToInstant } from "./time.js";

/** Open decision: same-day turns wait until the property is ready and the window is open. */
export const PROACTIVE_SAME_DAY_TURN = "queue_until_ready";

/**
 * @param {{
 *   now: Date | string | number,
 *   reservation: { id: string, checkInDate: string },
 *   property: { tz: string, stdCheckInTime: string },
 *   rule: any,
 *   prevNight: { status?: string },
 *   policy?: string,
 * }} input
 */
export function scheduleProactiveOffer(input) {
  const { reservation, property, rule, prevNight } = input;
  if (!rule.proactive?.enabled) return { status: "DISABLED" };

  const std = localToInstant(reservation.checkInDate, property.stdCheckInTime, property.tz);
  const unitMs = rule.proactive.unit === "hours" ? 3600000 : 86400000;
  const sendAt = new Date(std.getTime() - Number(rule.proactive.value) * unitMs);
  const local = instantToLocal(sendAt, property.tz);
  const when = {
    instant: sendAt.toISOString(),
    local: local.local,
    timeZoneName: local.timeZoneName,
  };

  const policy = input.policy || PROACTIVE_SAME_DAY_TURN;
  if (policy === PROACTIVE_SAME_DAY_TURN && rule.exceptions?.onlyWhenReady && prevNight?.status === "booked") {
    return { status: "QUEUED_UNTIL_READY", sendAt: when };
  }

  const now = input.now instanceof Date ? input.now : new Date(input.now);
  if (sendAt.getTime() < now.getTime()) return { status: "SKIP_PAST", sendAt: when };

  return {
    status: "SCHEDULED",
    sendAt: when,
    conditional: Boolean(rule.exceptions?.onlyWhenReady),
  };
}

/**
 * Mock send. Only a scheduled offer is appended.
 * @param {object[]} outbox
 */
export function enqueueProactiveOffer(outbox, offer, reservationId) {
  if (offer.status !== "SCHEDULED") return offer;
  const row = {
    reservationId,
    status: "SCHEDULED",
    sendAt: offer.sendAt,
    conditional: Boolean(offer.conditional),
  };
  outbox.push(row);
  return { ...offer, outboxIndex: outbox.length - 1 };
}
