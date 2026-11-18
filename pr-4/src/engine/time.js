// @ts-check

/**
 * @param {string} timeZone
 * @param {number} instantMs
 */
export function tzOffsetMs(timeZone, instantMs) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map = partsMap(dtf.formatToParts(new Date(instantMs)));
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instantMs;
}

/**
 * Wall-clock date and time in a time zone, as an absolute instant.
 * @param {string} date YYYY-MM-DD
 * @param {string} time HH:MM
 * @param {string} timeZone
 */
export function localToInstant(date, time, timeZone) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  let utc = Date.UTC(y, m - 1, d, hh, mm, 0);
  for (let i = 0; i < 4; i += 1) {
    const local = instantToLocal(utc, timeZone);
    const [ly, lm, ld] = local.date.split("-").map(Number);
    const [lh, lmin] = local.time.split(":").map(Number);
    const want = Date.UTC(y, m - 1, d, hh, mm, 0);
    const got = Date.UTC(ly, lm - 1, ld, lh, lmin, 0);
    const diff = want - got;
    if (diff === 0) return new Date(utc);
    utc += diff;
  }
  return new Date(utc);
}

/**
 * @param {Date | number | string} instant
 * @param {string} timeZone
 */
export function instantToLocal(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  const dtf = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  const map = partsMap(dtf.formatToParts(date));
  let hour = map.hour;
  if (hour === "24") hour = "00";
  const day = `${map.year}-${map.month}-${map.day}`;
  const clock = `${hour}:${map.minute}`;
  return {
    local: `${day} ${clock}`,
    date: day,
    time: clock,
    timeZoneName: map.timeZoneName || "",
    instant: date.toISOString(),
  };
}

/** @param {string} isoDate */
export function isFirstDayOfMonth(isoDate) {
  return Number(isoDate.slice(8, 10)) === 1;
}

/** @param {string} isoDate */
export function isLastDayOfMonth(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.getUTCDate() === 1;
}

/** Calendar date of the night before check-in. @param {string} isoDate */
export function previousNightDate(isoDate) {
  return shiftDate(isoDate, -1);
}

/** @param {string} isoDate @param {number} days */
export function shiftDate(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${next.getUTCFullYear()}-${mm}-${dd}`;
}

/** @param {string} value */
export function isValidTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** @param {Intl.DateTimeFormatPart[]} parts */
function partsMap(parts) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}
