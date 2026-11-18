// @ts-check

import { localToInstant } from "./time.js";

/**
 * @param {any} reservation
 * @param {any} rules
 */
export function screenReservation(reservation, rules) {
  const reasons = [];
  const settings = rules || {};
  if (settings.lastMinute?.enabled) {
    const checkIn = localToInstant(
      reservation.checkInDate,
      reservation.stdCheckInTime || "15:00",
      reservation.tz || "Australia/Sydney",
    );
    const booked = new Date(reservation.bookedAt).getTime();
    const hours = (checkIn.getTime() - booked) / 3600000;
    if (Number.isFinite(hours) && hours < Number(settings.lastMinute.withinHours)) reasons.push("LAST_MINUTE");
  }
  if (settings.flaggedCountries?.enabled) {
    const list = settings.flaggedCountries.countries || [];
    if (list.includes(reservation.country)) reasons.push("FLAGGED_COUNTRY");
  }
  if (settings.terseAnswers?.enabled) {
    const text = String(reservation.arrivalForm || "").trim();
    if (text.length < Number(settings.terseAnswers.minCharacters)) reasons.push("TERSE_ANSWER");
  }
  if (settings.guestCount?.enabled && Number(reservation.guestsAdults) > Number(settings.guestCount.maxAdults)) {
    reasons.push("ADULT_COUNT");
  }
  return { level: reasons.length ? "red" : "green", reasons };
}
