// @ts-check

import { instantToLocal } from "./time.js";

/** @type {any} */
let source = null;
let strictness = "lenient";

/** @param {any} data */
export function useReadinessData(data) {
  source = data;
}

/** @param {string} value */
export function setReadinessStrictness(value) {
  strictness = value === "strict" ? "strict" : "lenient";
}

/**
 * @param {string} propertyId
 * @param {string} arrivalDate
 * @param {Date | string | number} now
 * @param {any} [data]
 */
export function getReadiness(propertyId, arrivalDate, now, data) {
  const bundle = data || source;
  if (!bundle) throw new Error("Readiness data is not loaded");
  return computeReadiness(bundle, propertyId, arrivalDate, now, strictness);
}

/**
 * @param {any} bundle
 * @param {string} propertyId
 * @param {string} arrivalDate
 * @param {Date | string | number} now
 * @param {string} mode
 */
export function computeReadiness(bundle, propertyId, arrivalDate, now, mode = strictness) {
  const override = (bundle.overrides || []).find(
    (row) => row.property_id === propertyId && row.arrival_date === arrivalDate,
  );
  if (override && (override.status === "HOLD" || override.reason === "MANUAL_HOLD")) {
    return {
      status: "NOT_READY",
      reasons: ["MANUAL_HOLD"],
      override: { by: override.by, reason: override.reason },
    };
  }
  if (override && override.status === "READY") {
    return {
      status: "READY",
      reasons: [],
      override: { by: override.by, reason: override.reason },
    };
  }

  const property = (bundle.properties || []).find((row) => row.id === propertyId);
  const tz = property?.tz || "Australia/Sydney";
  const matches = (bundle.cleans || []).filter((clean) => {
    if (clean.property_id !== propertyId || !clean.next_arrival_at) return false;
    return instantToLocal(clean.next_arrival_at, tz).date === arrivalDate;
  });
  if (matches.length === 0) return { status: "UNKNOWN", reasons: ["NO_CLEAN_RECORD"] };

  matches.sort((a, b) => String(a.clean_date).localeCompare(String(b.clean_date)));
  const clean = matches[matches.length - 1];
  const submission = (bundle.submissions || []).find((row) => row.res === clean.res) || null;
  const review = submission
    ? (bundle.reviews || []).find((row) => row.submission_id === submission.id) || null
    : null;

  /** @type {string[]} */
  const reasons = [];
  if (!submission || !submission.submitted_at) reasons.push("CLEAN_NOT_SUBMITTED");
  if (!submission || !submission.hh_done_at) reasons.push("NOT_COMPLETE_IN_PMS");

  const failedReview = review && review.verdict === "fail" && review.checked_agree !== true;
  const strictMiss = mode === "strict" && (!review || (review.verdict !== "pass" && review.checked_agree !== true));
  if (failedReview || strictMiss) reasons.push("AI_REVIEW_FAILED");

  if (clean.next_pre_inspection) reasons.push("PRE_INSPECTION_PENDING");
  if (clean.next_pre_maintenance) reasons.push("PRE_MAINTENANCE_PENDING");

  const urgent = (bundle.jobs || []).some(
    (job) =>
      job.property_id === propertyId &&
      String(job.status).toLowerCase() === "open" &&
      String(job.priority).toLowerCase() === "urgent",
  );
  if (urgent) reasons.push("URGENT_MAINTENANCE_OPEN");

  const synced = new Date(clean.synced_at).getTime();
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  if (Number.isFinite(synced) && nowMs - synced > 3 * 60 * 60 * 1000) reasons.push("DATA_STALE");

  if (reasons.includes("DATA_STALE")) return { status: "UNKNOWN", reasons, cleanRes: clean.res };
  if (reasons.length) return { status: "NOT_READY", reasons, cleanRes: clean.res };
  return { status: "READY", reasons: [], cleanRes: clean.res };
}
