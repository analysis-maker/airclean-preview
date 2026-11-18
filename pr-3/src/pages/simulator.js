// @ts-check

import { loadSeed, paymentCatalog, readinessBundle } from "../adapters/data.mock.js";
import { createCalendar } from "../adapters/calendar.mock.js";
import { createNotifier } from "../adapters/notify.mock.js";
import { createPayments } from "../adapters/payments.mock.js";
import { createLocalStorageDriver, createStore, seedStateFrom } from "../adapters/store.mock.js";
import { decideEarlyCheckin } from "../engine/earlyCheckin.js";
import { decideLateCheckout, scheduleLateOffer } from "../engine/lateCheckout.js";
import { decideExtraNights, scheduleExtraOffer } from "../engine/extraNights.js";
import { getReadiness } from "../engine/readiness.js";
import { scheduleProactiveOffer } from "../engine/proactive.js";
import { defaultExtraNights, defaultLateCheckout } from "../rules/products.js";
import { localToInstant } from "../engine/time.js";
import { channelName, formatPrice, renderMessage } from "../messages.js";
import { resolveRule } from "../rules/resolve.js";
import { createIds, pay, quote } from "../services/purchase.js";
import { bootBrand, escapeHtml } from "../ui/brand.js";

export async function bootSimulator() {
  const config = await bootBrand("Simulator");
  const seed = await loadSeed();
  const store = createStore(createLocalStorageDriver(localStorage), seedStateFrom(seed));
  const select = document.querySelector("#sim-reservation");
  select.innerHTML = seed.ac_reservations.map((reservation) => {
    const property = seed.ac_properties.find((item) => item.id === reservation.propertyId);
    return `<option value="${escapeHtml(reservation.id)}">${escapeHtml(property.name)} · ${escapeHtml(reservation.checkInDate)} · ${escapeHtml(reservation.channel)}</option>`;
  }).join("");
  const demo = `${config.product.demoDate}T08:00`;
  document.querySelector("#sim-now").value = demo;
  document.querySelector("#sim-form").addEventListener("submit", (event) => event.preventDefault());
  document.querySelector("#sim-product").addEventListener("change", () => render(seed, store, false));
  document.querySelector("#sim-run").addEventListener("click", () => render(seed, store, false));
  document.querySelector("#sim-buy").addEventListener("click", () => render(seed, store, true));
  render(seed, store, false);
}

function render(seed, store, buy) {
  const state = store.load();
  const reservation = seed.ac_reservations.find((item) => item.id === document.querySelector("#sim-reservation").value);
  const property = seed.ac_properties.find((item) => item.id === reservation.propertyId);
  const membership = state.listingSets.filter((set) => set.propertyIds.includes(property.id)).map((set) => set.id);
  const propertyRule = state.rules.properties?.[property.id] ? { id: property.id, ...state.rules.properties[property.id] } : null;
  const product = document.querySelector("#sim-product").value;
  document.querySelector("#sim-arrival-field").hidden = product !== "early_checkin";
  document.querySelector("#sim-depart-field").hidden = product !== "late_checkout";
  document.querySelector("#sim-extra-field").hidden = product !== "extra_nights";
  const productTree = product === "late_checkout" ? "lateCheckout" : product === "extra_nights" ? "extraNights" : null;
  const bucket = productTree ? (state.rules[productTree] || { global: { version: 1, settings: product === "late_checkout" ? defaultLateCheckout() : defaultExtraNights() }, listingSets: {}, properties: {} }) : state.rules;
  const productPropertyRule = productTree && bucket.properties?.[property.id] ? { id: property.id, ...bucket.properties[property.id] } : propertyRule;
  const resolved = resolveRule({
    defaults: product === "late_checkout" ? defaultLateCheckout : product === "extra_nights" ? defaultExtraNights : undefined,
    globalRule: bucket.global,
    setRules: Object.entries(bucket.listingSets || {}).map(([id, rule]) => ({ id, ...rule })),
    propertyRule: productTree ? productPropertyRule : propertyRule,
    property: { ...property, listingSetIds: membership },
    listingSets: state.listingSets,
  });
  const [date, time] = document.querySelector("#sim-now").value.split("T");
  const now = localToInstant(date, time || "08:00", property.tz);
  const requestedArrival = document.querySelector("#sim-arrival").value || "14:00";
  const readinessChoice = document.querySelector("#sim-readiness").value;
  let readiness;
  if (readinessChoice === "auto") readiness = getReadiness(property.id, reservation.checkInDate, now, readinessBundle(seed));
  else if (readinessChoice === "READY") readiness = { status: "READY", reasons: [] };
  else if (readinessChoice === "NOT_READY") readiness = { status: "NOT_READY", reasons: ["CLEAN_NOT_SUBMITTED"] };
  else readiness = { status: "UNKNOWN", reasons: ["DATA_STALE"] };

  const calendar = createCalendar(state.calendar);
  const prevChoice = document.querySelector("#sim-prev").value;
  const prevNight = prevChoice === "auto"
    ? calendar.previous(property.id, reservation.checkInDate)
    : { status: prevChoice, blockReason: prevChoice === "blocked" ? "owner" : "" };

  const catalog = { ...paymentCatalog(seed), listingSets: state.listingSets };
  const nextStay = seed.ac_reservations
    .filter((item) => item.propertyId === property.id && item.id !== reservation.id && item.checkInDate >= reservation.checkOutDate)
    .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))[0];
  const input = {
    now,
    product,
    reservation,
    property: { ...property, listingSetIds: membership, stdCheckOutTime: property.stdCheckOutTime || "10:00" },
    requestedArrival,
    requestedDeparture: document.querySelector("#sim-depart").value || "12:00",
    side: document.querySelector("#sim-side").value,
    nights: Number(document.querySelector("#sim-nights").value || 1),
    rule: resolved.rule,
    readiness,
    prevNight,
    followingNight: calendar.get(property.id, reservation.checkOutDate),
    nextArrival: nextStay ? { date: nextStay.checkInDate, time: property.stdCheckInTime || "15:00" } : null,
    cleanerShift: { end: "16:00" },
    paymentAccounts: catalog,
    ruleSource: { scope: "resolved", id: property.id, version: bucket.global?.version || 1 },
    listingSetName: state.listingSets.filter((set) => membership.includes(set.id)).sort((a, b) => a.priority - b.priority)[0]?.name || "",
  };
  const decision = product === "late_checkout"
    ? decideLateCheckout(input)
    : product === "extra_nights"
      ? decideExtraNights(input)
      : decideEarlyCheckin(input);
  const offer = product === "late_checkout"
    ? scheduleLateOffer(input)
    : product === "extra_nights"
      ? scheduleExtraOffer(input)
      : scheduleProactiveOffer({ now, reservation, property, rule: resolved.rule, prevNight, policy: "queue_until_ready" });
  const guest = guestText(decision, input);
  document.querySelector("#sim-summary").textContent = summary(decision, guest);
  document.querySelector("#sim-guest").textContent = guest;
  document.querySelector("#sim-price").textContent = decision.available
    ? formatPrice(decision.price.amount, decision.price.currency)
    : "No price";
  document.querySelector("#sim-calendar").textContent = decision.calendarAction || "None";
  document.querySelector("#sim-payment").textContent = decision.paymentRoute
    ? `${decision.paymentRoute.route}${decision.paymentRoute.accountLabel ? ` · ${decision.paymentRoute.accountLabel}` : ""}`
    : decision.reasonCode;
  document.querySelector("#sim-offer").textContent = `${offer.status}${offer.sendAt ? ` · ${offer.sendAt.local} ${offer.sendAt.timeZoneName}` : ""}`;
  document.querySelector("#sim-sources").textContent = sourceLines(resolved.sources, state.listingSets);
  document.querySelector("#sim-json").textContent = JSON.stringify({ decision, readiness, offer, rule: resolved.rule }, null, 2);

  const purchaseBox = document.querySelector("#sim-purchase");
  if (!buy) {
    purchaseBox.textContent = "Purchase has not been run.";
    return;
  }
  const world = {
    calendar,
    payments: createPayments(),
    notify: createNotifier(),
    audit: { rows: [], write(row) { this.rows.push({ ...row, id: `aud_${this.rows.length + 1}` }); } },
    ids: createIds(),
    decisions: { writeBackToBookingSystem: false },
  };
  const quoted = quote(input, world);
  const night = nightDate(reservation.checkInDate);
  if (document.querySelector("#sim-race").checked) {
    calendar.set(property.id, night, { status: "booked" });
  }
  const result = pay(quoted, world);
  state.audit = [...(state.audit || []), ...world.audit.rows];
  state.notifications = [...(state.notifications || []), ...world.notify.items];
  if (result.ok && result.decision.calendarAction && result.decision.calendarAction !== "NONE") {
    const nights = result.decision.nightDates
      || (result.decision.calendarAction === "BLOCK_FOLLOWING_NIGHT" ? [reservation.checkOutDate] : [night]);
    const reason = `upsell:${result.order.order_id}`;
    for (const blocked of nights) {
      const row = state.calendar.find((item) => item.propertyId === property.id && item.night === blocked);
      if (row) {
        row.status = "blocked";
        row.blockReason = reason;
      } else {
        state.calendar.push({ reservationId: reservation.id, propertyId: property.id, night: blocked, status: "blocked", blockReason: reason });
      }
    }
  }
  if (result.order) state.orders = [...state.orders, result.order];
  store.save(state);
  purchaseBox.textContent = result.ok
    ? `Order ${result.order.order_id} is ${result.order.status}. Calendar: ${calendar.previous(property.id, reservation.checkInDate).status} ${calendar.previous(property.id, reservation.checkInDate).blockReason || ""}. Notices: ${world.notify.items.length}.`
    : `Purchase refused (${result.reasonCode}). No payment was taken.`;
}

function nightDate(checkIn) {
  const [y, m, d] = checkIn.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}

function guestText(decision, input) {
  const price = decision.price ? formatPrice(decision.price.amount, decision.price.currency) : "";
  const vars = {
    time: input.requestedDeparture || input.requestedArrival,
    date: decision.nightDates?.[0] || (input.product === "late_checkout" ? input.reservation.checkOutDate : input.reservation.checkInDate),
    price,
    nights: input.nights || "",
    stdTime: input.product === "late_checkout" ? (input.property.stdCheckOutTime || "10:00") : input.property.stdCheckInTime,
    channelName: channelName(input.reservation.channel),
    availableFromLocal: decision.availableFrom ? `${decision.availableFrom.local} ${decision.availableFrom.timeZoneName}` : "",
  };
  return renderMessage(decision.guestMessageKey || "guest.unavailable", vars);
}

function summary(decision, guest) {
  if (!decision.available) return `Not available (${decision.reasonCode}). ${guest}`;
  const route = decision.paymentRoute.route === "OTA_RESOLUTION_CENTRE" ? "Resolution Centre" : "card payment";
  return `Available. ${decision.tier.key} for ${formatPrice(decision.price.amount, decision.price.currency)} via ${route}. Calendar: ${decision.calendarAction}.`;
}

function sourceLines(sources, sets) {
  const interesting = ["enabled", "exceptions.onlyWhenReady", "blockPolicy.mode", "blockPolicy.thresholdHours", "proactive.value"];
  return interesting.map((path) => {
    const source = sources[path];
    if (!source) return "";
    const name = source.scope === "listingSet"
      ? (sets.find((set) => set.id === source.id)?.name || source.id)
      : source.scope === "global" ? "Default for all properties" : "This property";
    return `${path}: ${name}`;
  }).filter(Boolean).join("\n");
}
