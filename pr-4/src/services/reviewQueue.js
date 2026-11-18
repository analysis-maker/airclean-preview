// @ts-check

import { screenReservation } from "../engine/risk.js";
import { requestAccessRelease } from "./accessGate.js";

/**
 * @param {any} item
 * @param {any} rules
 * @param {{ decision: "approved"|"denied", by: string, reason: string, riskScreeningEnabled?: boolean }} review
 */
export function submitReview(item, rules, review) {
  const screening = screenReservation(item, rules);
  const result = requestAccessRelease({
    screening,
    review,
    riskScreeningEnabled: review.riskScreeningEnabled !== false,
  });
  const audit = {
    action: review.decision === "approved" ? "access_approved" : "access_denied",
    entity: "access_review",
    entityId: item.id,
    at: review.at,
    by: review.by,
    detail: { reason: review.reason, reasons: screening.reasons, status: result.status },
  };
  return { screening, result, audit };
}

/** @param {any[]} items @param {any} rules */
export function queueForReview(items, rules) {
  return items
    .map((item) => ({ item, screening: screenReservation(item, rules) }))
    .filter((row) => row.screening.level === "red" && !row.item.review);
}
