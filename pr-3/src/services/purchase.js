// @ts-check

import { decideEarlyCheckin } from "../engine/earlyCheckin.js";
import { decideLateCheckout } from "../engine/lateCheckout.js";
import { decideExtraNights } from "../engine/extraNights.js";
import { previousNightDate } from "../engine/time.js";
import { formatPrice, renderMessage } from "../messages.js";

function decideFor(input) {
  if (input.product === "late_checkout") return decideLateCheckout(input);
  if (input.product === "extra_nights") return decideExtraNights(input);
  return decideEarlyCheckin(input);
}

function withFreshCalendar(input, ctx) {
  if (input.product === "late_checkout") {
    return { ...input, followingNight: ctx.calendar.get(input.property.id, input.reservation.checkOutDate) };
  }
  if (input.product === "extra_nights") {
    const occupied = (input.nightDates || []).map((date) => ({ date, ...ctx.calendar.get(input.property.id, date) }));
    return { ...input, occupied };
  }
  return { ...input, prevNight: ctx.calendar.get(input.property.id, previousNightDate(input.reservation.checkInDate)) };
}

/**
 * @param {any} input decision inputs, including prevNight at quote time
 * @param {any} ctx
 */
export function quote(input, ctx) {
  const decision = decideFor(input);
  const id = ctx.ids.next("quo");
  const stored = cloneInput(input);
  if (decision.nightDates) stored.nightDates = decision.nightDates;
  const row = {
    id,
    at: toIso(input.now),
    input: stored,
    decision,
  };
  ctx.audit.write({
    action: "quote",
    entity: "quote",
    entityId: id,
    at: row.at,
    detail: { reasonCode: decision.reasonCode, available: decision.available },
  });
  return row;
}

/**
 * Re-reads the mock calendar. If the previous night became booked, no charge is made.
 * @param {ReturnType<typeof quote>} quoteRow
 * @param {any} ctx
 */
export function pay(quoteRow, ctx) {
  const input = withFreshCalendar(quoteRow.input, ctx);
  const night = previousNightDate(input.reservation.checkInDate);
  const decision = decideFor(input);
  const at = toIso(input.now);

  if (!decision.available) {
    ctx.audit.write({
      action: "payment",
      entity: "quote",
      entityId: quoteRow.id,
      at,
      detail: { result: "refused", reasonCode: decision.reasonCode },
    });
    return {
      ok: false,
      reasonCode: decision.reasonCode,
      decision,
      payment: null,
      order: null,
      notifications: [],
    };
  }

  if (ctx.decisions?.writeBackToBookingSystem) {
    ctx.audit.write({
      action: "live_write_refused",
      entity: "quote",
      entityId: quoteRow.id,
      at,
      detail: { result: "mock_only" },
    });
  }

  const orderId = ctx.ids.next("ord");
  let payment = null;
  let status;
  if (decision.paymentRoute.route === "OTA_RESOLUTION_CENTRE") {
    status = "pending_ota";
  } else {
    payment = ctx.payments.chargeStripe({
      account: {
        id: decision.paymentRoute.accountId,
        label: decision.paymentRoute.accountLabel,
        secret_ref: null,
      },
      amount: decision.price.amount,
      currency: decision.price.currency,
    });
    status = "paid";
  }

  ctx.audit.write({
    action: "payment",
    entity: "order",
    entityId: orderId,
    at,
    detail: {
      result: status,
      paymentId: payment?.id || null,
      route: decision.paymentRoute.route,
    },
  });

  const order = {
    order_id: orderId,
    created_at: at,
    property_id: input.property.id,
    property_name: input.property.name || input.property.id,
    listing_set: input.listingSetName || "",
    reservation_id: input.reservation.id,
    channel: input.reservation.channel,
    product: input.product || "early_checkin",
    extension_hours: decision.extensionHours ?? Math.round((decision.extensionMin / 60) * 100) / 100,
    tier: decision.tier.key,
    amount: decision.price.amount,
    currency: decision.price.currency,
    payment_route: decision.paymentRoute.route,
    payment_account: decision.paymentRoute.accountLabel || "",
    status,
    calendar_action: decision.calendarAction,
    quote_id: quoteRow.id,
  };

  ctx.audit.write({
    action: "order",
    entity: "order",
    entityId: orderId,
    at,
    detail: { status },
  });

  const blockNights = decision.calendarAction === "BLOCK_NIGHTS"
    ? (decision.nightDates || [])
    : decision.calendarAction === "BLOCK_FOLLOWING_NIGHT"
      ? [input.reservation.checkOutDate]
      : decision.calendarAction === "BLOCK_PREVIOUS_NIGHT"
        ? [night]
        : [];
  if ((status === "paid" || status === "pending_ota") && blockNights.length) {
    for (const blockedNight of blockNights) {
      ctx.calendar.block(input.property.id, blockedNight, `upsell:${orderId}`);
    }
    ctx.audit.write({
      action: "calendar",
      entity: "order",
      entityId: orderId,
      at,
      detail: { calendarAction: decision.calendarAction, nights: blockNights, reason: `upsell:${orderId}` },
    });
  } else {
    ctx.audit.write({
      action: "calendar",
      entity: "order",
      entityId: orderId,
      at,
      detail: { calendarAction: "NONE" },
    });
  }

  const notifications = notifyOps(order, decision, input, ctx, at);
  return { ok: true, reasonCode: "OK", decision, payment, order, notifications };
}

function notifyOps(order, decision, input, ctx, at) {
  const price = formatPrice(order.amount, order.currency);
  const route = decision.paymentRoute.route === "OTA_RESOLUTION_CENTRE" ? "Resolution Centre" : "card payment";
  const nightNote = decision.calendarAction && decision.calendarAction !== "NONE" ? "blocked" : "not blocked";
  const vars = {
    propertyName: order.property_name,
    date: input.product === "late_checkout" ? input.reservation.checkOutDate : (decision.nightDates?.[0] || input.reservation.checkInDate),
    time: input.requestedDeparture || input.requestedArrival || "",
    nights: input.nights || "",
    price,
    route,
    nightNote,
    stdTime: input.product === "late_checkout" ? (input.property.stdCheckOutTime || "10:00") : input.property.stdCheckInTime,
  };
  /** @type {any[]} */
  const sent = [];
  if (order.status === "paid") {
    sent.push(
      ctx.notify.push({
        audience: "office",
        tag: null,
        orderId: order.order_id,
        at,
        body: renderMessage(decision.opsMessageKey || "ops.office", vars),
      }),
    );
    sent.push(
      ctx.notify.push({
        audience: "housekeeper",
        tag: null,
        orderId: order.order_id,
        at,
        body: renderMessage(decision.housekeeperMessageKey || "ops.housekeeper", vars),
      }),
    );
  } else if (order.status === "pending_ota") {
    sent.push(
      ctx.notify.push({
        audience: "office",
        tag: "payment to confirm",
        orderId: order.order_id,
        at,
        body: renderMessage(decision.opsMessageKey || "ops.office", vars),
      }),
    );
  }
  ctx.audit.write({
    action: "notify",
    entity: "order",
    entityId: order.order_id,
    at,
    detail: { count: sent.length, tag: sent[0]?.tag || null },
  });
  return sent;
}

export function createIds(start = 0) {
  let n = start;
  return {
    next(prefix) {
      n += 1;
      return `${prefix}_mock_${n}`;
    },
  };
}

function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function cloneInput(input) {
  return structuredClone({
    now: toIso(input.now),
    reservation: input.reservation,
    property: input.property,
    product: input.product || "early_checkin",
    requestedArrival: input.requestedArrival,
    requestedDeparture: input.requestedDeparture,
    nextArrival: input.nextArrival || null,
    cleanerShift: input.cleanerShift || null,
    followingNight: input.followingNight || null,
    side: input.side,
    nights: input.nights,
    nightDates: input.nightDates,
    occupied: input.occupied,
    rule: input.rule,
    readiness: input.readiness,
    prevNight: input.prevNight,
    paymentAccounts: input.paymentAccounts,
    ruleSource: input.ruleSource || null,
    listingSetName: input.listingSetName || "",
  });
}
