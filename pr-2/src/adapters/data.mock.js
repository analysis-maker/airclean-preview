// @ts-check

import { readJson } from "../io.js";

const FILES = [
  "qa_cleans",
  "qa_submissions",
  "qa_ai_reviews",
  "qa_maint_jobs",
  "qa_app_config",
  "ac_properties",
  "ac_listing_sets",
  "ac_reservations",
  "ac_calendar",
  "ac_readiness_overrides",
  "ac_payment_accounts",
  "ac_orders",
  "ac_codes",
];

export async function loadSeed() {
  /** @type {Record<string, any>} */
  const seed = {};
  for (const name of FILES) {
    seed[name] = await readJson(new URL(`../../seed/${name}.json`, import.meta.url));
  }
  return seed;
}

/** Shape consumed by the readiness engine. @param {any} seed */
export function readinessBundle(seed) {
  return {
    cleans: seed.qa_cleans,
    submissions: seed.qa_submissions,
    reviews: seed.qa_ai_reviews,
    jobs: seed.qa_maint_jobs,
    overrides: seed.ac_readiness_overrides,
    properties: seed.ac_properties,
  };
}

/** Payment lookup input, with listing-set priority attached. @param {any} seed */
export function paymentCatalog(seed) {
  return {
    ...seed.ac_payment_accounts,
    listingSets: seed.ac_listing_sets.map((set) => ({
      id: set.id,
      name: set.name,
      priority: set.priority,
    })),
  };
}

/** @param {string} status */
export function isCountedClean(status) {
  return status !== "Cancelled" && status !== "Quote";
}

/** @param {any[]} cleans @param {string} date */
export function cleansForDate(cleans, date) {
  return cleans.filter((clean) => clean.clean_date === date && isCountedClean(clean.hh_status));
}

/**
 * Paid early check-in for a property arriving on a date.
 * @param {any[]} orders
 * @param {any[]} reservations
 */
export function paidEarlyArrival(orders, reservations, propertyId, date) {
  return (
    orders.find((order) => {
      if (order.status !== "paid" || order.property_id !== propertyId) return false;
      return reservations.some(
        (reservation) =>
          reservation.id === order.reservation_id &&
          reservation.propertyId === propertyId &&
          reservation.checkInDate === date,
      );
    }) || null
  );
}
