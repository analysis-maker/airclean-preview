// @ts-check

import { previousNightDate } from "../engine/time.js";

/** @param {{ propertyId: string, night: string, status: string, blockReason?: string }[]} rows */
export function createCalendar(rows = []) {
  /** @type {Map<string, { status: string, blockReason?: string }>} */
  const nights = new Map();
  for (const row of rows) {
    nights.set(key(row.propertyId, row.night), {
      status: row.status,
      blockReason: row.blockReason,
    });
  }
  return {
    /** @param {string} propertyId @param {string} night */
    get(propertyId, night) {
      return nights.get(key(propertyId, night)) || { status: "vacant" };
    },
    /** @param {string} propertyId @param {string} checkInDate */
    previous(propertyId, checkInDate) {
      return this.get(propertyId, previousNightDate(checkInDate));
    },
    /**
     * @param {string} propertyId
     * @param {string} night
     * @param {{ status: string, blockReason?: string }} value
     */
    set(propertyId, night, value) {
      nights.set(key(propertyId, night), { ...value });
    },
    /** @param {string} propertyId @param {string} night @param {string} reason */
    block(propertyId, night, reason) {
      nights.set(key(propertyId, night), { status: "blocked", blockReason: reason });
    },
    snapshot() {
      return [...nights.entries()].map(([id, value]) => {
        const [propertyId, night] = id.split("|");
        return { propertyId, night, ...value };
      });
    },
  };
}

function key(propertyId, night) {
  return `${propertyId}|${night}`;
}
