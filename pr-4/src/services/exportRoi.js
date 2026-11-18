// @ts-check

import { instantToLocal } from "../engine/time.js";

export const CSV_HEADER = [
  "order_id",
  "created_at_local",
  "property_id",
  "property_name",
  "listing_set",
  "reservation_id",
  "channel",
  "product",
  "extension_hours",
  "tier",
  "amount",
  "currency",
  "payment_route",
  "payment_account",
  "status",
  "calendar_action",
].join(",");

/**
 * @param {any[]} orders
 * @param {{ month: string, properties: { id: string, tz: string }[] }} options
 */
export function ordersToCsv(orders, options) {
  const lines = [CSV_HEADER];
  for (const order of orders) {
    const property = options.properties.find((item) => item.id === order.property_id);
    const tz = property?.tz || "Australia/Sydney";
    const local = instantToLocal(order.created_at, tz);
    if (local.date.slice(0, 7) !== options.month) continue;
    const row = [
      order.order_id,
      local.local,
      order.property_id,
      order.property_name,
      order.listing_set,
      order.reservation_id,
      order.channel,
      order.product,
      order.extension_hours,
      order.tier,
      order.amount,
      order.currency,
      order.payment_route,
      order.payment_account,
      order.status,
      order.calendar_action,
    ];
    lines.push(row.map(csvField).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** @param {unknown} value */
export function csvField(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Minimal RFC 4180 reader for one header row plus body. @param {string} csv */
export function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((item) => item.length > 1 || item[0] !== "");
}
