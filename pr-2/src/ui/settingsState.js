// @ts-check

/** The hour stepper is active only for the "more than N hours" block rule. */
export function thresholdEnabled(mode) {
  return mode === "if_extension_over";
}

/** Turned-off tiers keep their values but cannot be edited. */
export function tierInputsEnabled(enabled) {
  return Boolean(enabled);
}

/**
 * @param {Record<string, unknown>} values
 */
export function formValuesToRule(values) {
  const tiers = [
    ["1h", 1],
    ["2h", 2],
    ["3h", 3],
    ["4h+", 4],
  ].map(([key, hours]) => ({
    key,
    hours,
    enabled: Boolean(values[`${key}-enabled`]),
    amount: Number(values[`${key}-amount`]),
    type: values[`${key}-type`],
  }));
  return {
    enabled: Boolean(values.enabled),
    earliestArrivalTime: String(values.earliestArrivalTime || ""),
    window: {
      opensHoursBefore: values.openNoLimit ? null : Number(values.opensHoursBefore),
      closesHoursBefore: values.closeNoLimit ? null : Number(values.closesHoursBefore),
    },
    exceptions: {
      firstDayOfMonth: Boolean(values.firstDayOfMonth),
      lastDayOfMonth: Boolean(values.lastDayOfMonth),
      onlyWhenReady: Boolean(values.onlyWhenReady),
    },
    blockPolicy: {
      mode: values.blockMode,
      thresholdHours: Number(values.thresholdHours),
    },
    pricing: { mode: "custom", tiers },
    proactive: {
      enabled: Boolean(values.proactiveEnabled),
      value: Number(values.proactiveValue),
      unit: values.proactiveUnit,
    },
  };
}

/**
 * Build a partial patch from the fields marked custom.
 * @param {Record<string, unknown>} values
 * @param {string[]} customPaths
 */
export function customPatch(values, customPaths) {
  const full = formValuesToRule(values);
  /** @type {Record<string, unknown>} */
  const patch = {};
  const want = new Set(customPaths);
  if (want.has("enabled")) patch.enabled = full.enabled;
  if (want.has("earliestArrivalTime")) patch.earliestArrivalTime = full.earliestArrivalTime;
  if (want.has("window")) patch.window = full.window;
  if (want.has("exceptions.firstDayOfMonth") || want.has("exceptions.lastDayOfMonth") || want.has("exceptions.onlyWhenReady")) {
    patch.exceptions = {};
    if (want.has("exceptions.firstDayOfMonth")) patch.exceptions.firstDayOfMonth = full.exceptions.firstDayOfMonth;
    if (want.has("exceptions.lastDayOfMonth")) patch.exceptions.lastDayOfMonth = full.exceptions.lastDayOfMonth;
    if (want.has("exceptions.onlyWhenReady")) patch.exceptions.onlyWhenReady = full.exceptions.onlyWhenReady;
  }
  if (want.has("blockPolicy")) patch.blockPolicy = full.blockPolicy;
  if (want.has("pricing.mode")) patch.pricing = { mode: "custom" };
  const tierKeys = ["1h", "2h", "3h", "4h+"].filter((key) => want.has(`pricing.tiers.${key}`));
  if (tierKeys.length) {
    patch.pricing = patch.pricing || {};
    patch.pricing.tiers = full.pricing.tiers.filter((tier) => tierKeys.includes(tier.key));
  }
  if (want.has("proactive")) patch.proactive = full.proactive;
  return patch;
}

/**
 * @param {any[]} sets
 * @param {{ id?: string, name: string, priority: number, propertyIds: string[] }} draft
 */
export function upsertSet(sets, draft) {
  const next = sets.map((set) => ({ ...set, propertyIds: [...set.propertyIds] }));
  const id = draft.id || `set_${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    id,
    name: draft.name.trim(),
    priority: Number(draft.priority),
    propertyIds: [...draft.propertyIds],
  };
  const index = next.findIndex((set) => set.id === id);
  if (index >= 0) next[index] = row;
  else next.push(row);
  return next;
}
