// @ts-check

import { t } from "./config.js";

export const HOUSEKEEPER_DENY = ["urgent", "late", "problem", "complaint"];

export const templates = {
  "guest.available":
    "Good news! You can check in from {time} on {date} for {price}. Tap to confirm.",
  "guest.unavailable":
    "Thanks for asking! We can't offer an earlier check-in for this stay. Your check-in time is {stdTime}.",
  "guest.notYetOpen":
    "Early check-in for your stay opens at {availableFromLocal}. We'll be happy to help then.",
  "guest.ota":
    "To confirm, please send {price} through the {channelName} Resolution Centre. We'll confirm as soon as it arrives.",
  "ops.housekeeper":
    "Heads up: guests at {propertyName} are arriving early at {time} on {date}. Thanks for having it looking great!",
  "ops.office":
    "Early check-in sold: {propertyName}, {date} {time}, {price} via {route}. Previous night {nightNote}.",
  "guest.sender": "Message from {companySenderName}.",
};

const CHANNEL_NAMES = {
  direct: "direct booking",
  airbnb: "Airbnb",
  booking: "Booking.com",
  vrbo: "Vrbo",
};

/** @param {string} channel */
export function channelName(channel) {
  return CHANNEL_NAMES[channel] || channel;
}

/** @param {string} key @param {Record<string, unknown>} vars */
export function renderMessage(key, vars) {
  const template = templates[key];
  if (!template) throw new Error(`Unknown message ${key}`);
  return t(template, vars);
}

/** @param {string} text */
export function housekeeperLint(text) {
  const hits = [];
  for (const word of HOUSEKEEPER_DENY) {
    const pattern = new RegExp(`\\b${word}\\b`, "i");
    if (pattern.test(text)) hits.push(word);
  }
  return hits;
}

/** @param {number} amount @param {string} currency */
export function formatPrice(amount, currency) {
  return `${currency} ${amount}`;
}
