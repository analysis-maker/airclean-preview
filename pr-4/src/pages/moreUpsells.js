// @ts-check

import { loadSeed } from "../adapters/data.mock.js";
import { createLocalStorageDriver, createStore, saveRule, seedStateFrom } from "../adapters/store.mock.js";
import { getConfig } from "../config.js";
import { resolveRule, sourceLabel } from "../rules/resolve.js";
import { defaultExtraNights, defaultLateCheckout, validateExtraNights, validateLateCheckout } from "../rules/products.js";

const ACTOR = "Demo Admin";

export async function bootMoreUpsells() {
  const seed = await loadSeed();
  const store = createStore(createLocalStorageDriver(localStorage), seedStateFrom(seed));
  const properties = seed.ac_properties;
  const scopeSelect = document.querySelector("#scope");
  const decisions = getConfig().decisions;
  if (!decisions.chargeForLateCheckout) document.querySelector("#lc-banner").hidden = false;
  if (!decisions.chargeForExtraNights) document.querySelector("#xn-banner").hidden = false;

  const paint = () => {
    const state = store.load();
    const { scope, id } = current(scopeSelect);
    paintLate(state, properties, scope, id);
    paintExtra(state, properties, scope, id);
  };
  scopeSelect.addEventListener("change", paint);
  document.querySelector("#late-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveProduct(store, scopeSelect, "lateCheckout", readLate(), validateLateCheckout, "#lc-error");
    paint();
  });
  document.querySelector("#extra-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveProduct(store, scopeSelect, "extraNights", readExtra(), validateExtraNights, "#xn-error");
    paint();
  });
  document.querySelector("#lc-3h-on").addEventListener("change", syncLateTiers);
  paint();
  syncLateTiers();
}

function current(select) {
  const [scope, id] = select.value.split(":");
  return { scope, id: id || "global" };
}

function membership(state, propertyId) {
  return state.listingSets.filter((set) => set.propertyIds.includes(propertyId)).map((set) => set.id);
}

function resolved(state, properties, scope, id, tree, defaults) {
  const bucket = state.rules[tree] || { global: { version: 1, settings: defaults() }, listingSets: {}, properties: {} };
  const setRules = Object.entries(bucket.listingSets || {}).map(([setId, rule]) => ({ id: setId, ...rule }));
  if (scope === "global") {
    return resolveRule({
      defaults, globalRule: bucket.global, setRules: [], propertyRule: null,
      property: { id: "global", listingSetIds: [] }, listingSets: state.listingSets,
    });
  }
  if (scope === "listingSet") {
    return resolveRule({
      defaults, globalRule: bucket.global, setRules: setRules.filter((rule) => rule.id === id), propertyRule: null,
      property: { id, listingSetIds: [id] }, listingSets: state.listingSets,
    });
  }
  const property = properties.find((item) => item.id === id);
  return resolveRule({
    defaults,
    globalRule: bucket.global,
    setRules,
    propertyRule: bucket.properties?.[id] ? { id, ...bucket.properties[id] } : null,
    property: { ...property, listingSetIds: membership(state, id) },
    listingSets: state.listingSets,
  });
}

function paintLate(state, properties, scope, id) {
  const view = resolved(state, properties, scope, id, "lateCheckout", defaultLateCheckout);
  const rule = view.rule;
  document.querySelector("#lc-enabled").checked = Boolean(rule.enabled);
  document.querySelector("#lc-latest").value = rule.latestDepartureTime;
  document.querySelector("#lc-open").value = rule.window.opensHoursBefore ?? "";
  document.querySelector("#lc-close").value = rule.window.closesHoursBefore ?? "";
  document.querySelector("#lc-first").checked = Boolean(rule.exceptions.firstDayOfMonth);
  document.querySelector("#lc-last").checked = Boolean(rule.exceptions.lastDayOfMonth);
  document.querySelector("#lc-turnover").checked = Boolean(rule.exceptions.onlyWhenTurnoverFits);
  document.querySelector("#lc-clean").value = String(rule.turnover.minimumCleanMinutes);
  document.querySelector("#lc-always").checked = rule.blockPolicy.mode === "always";
  document.querySelector("#lc-over").checked = rule.blockPolicy.mode === "if_extension_over";
  document.querySelector("#lc-never").checked = rule.blockPolicy.mode === "never";
  document.querySelector("#lc-threshold").value = String(rule.blockPolicy.thresholdHours);
  document.querySelector("#lc-threshold").disabled = rule.blockPolicy.mode !== "if_extension_over";
  for (const tier of rule.pricing.tiers) {
    const slug = tier.key === "4h+" ? "4p" : tier.key;
    document.querySelector(`#lc-${slug}-on`).checked = Boolean(tier.enabled);
    document.querySelector(`#lc-${slug}-amount`).value = String(tier.amount);
    document.querySelector(`#lc-${slug}-type`).value = tier.type;
    const off = !tier.enabled;
    document.querySelector(`#lc-${slug}-amount`).disabled = off;
    document.querySelector(`#lc-${slug}-type`).disabled = off;
    document.querySelector(`#lc-tier-${slug}`).classList.toggle("tier-off", off);
  }
  document.querySelector("#lc-proactive").checked = Boolean(rule.proactive.enabled);
  document.querySelector("#lc-proactive-value").value = String(rule.proactive.value);
  document.querySelector("#lc-proactive-unit").value = rule.proactive.unit;
  const source = view.sources["turnover.minimumCleanMinutes"];
  document.querySelector("#lc-inherit").textContent = scope === "global"
    ? ""
    : `Clean time inherited from ${sourceLabel(source, state.listingSets)}`;
}

function paintExtra(state, properties, scope, id) {
  const view = resolved(state, properties, scope, id, "extraNights", defaultExtraNights);
  const rule = view.rule;
  document.querySelector("#xn-enabled").checked = Boolean(rule.enabled);
  document.querySelector("#xn-before").checked = Boolean(rule.sides.before);
  document.querySelector("#xn-after").checked = Boolean(rule.sides.after);
  document.querySelector("#xn-max").value = String(rule.maxNights);
  document.querySelector("#xn-nightly").checked = rule.pricing.mode !== "discount";
  document.querySelector("#xn-discount").checked = rule.pricing.mode === "discount";
  document.querySelector("#xn-discount-pct").value = String(rule.pricing.discountPct);
  document.querySelector("#xn-close").value = rule.window.closesHoursBefore ?? "";
  document.querySelector("#xn-proactive").checked = Boolean(rule.proactive.enabled);
  document.querySelector("#xn-proactive-value").value = String(rule.proactive.value);
  const source = view.sources["pricing.discountPct"];
  document.querySelector("#xn-inherit").textContent = scope === "global"
    ? ""
    : `Discount inherited from ${sourceLabel(source, state.listingSets)}`;
}

function readLate() {
  const block = document.querySelector("input[name='lc-block']:checked");
  const tier = (key, slug) => ({
    key, hours: key === "4h+" ? 4 : Number(key[0]),
    enabled: document.querySelector(`#lc-${slug}-on`).checked,
    amount: Number(document.querySelector(`#lc-${slug}-amount`).value),
    type: document.querySelector(`#lc-${slug}-type`).value,
  });
  return {
    enabled: document.querySelector("#lc-enabled").checked,
    latestDepartureTime: document.querySelector("#lc-latest").value,
    window: {
      opensHoursBefore: Number(document.querySelector("#lc-open").value),
      closesHoursBefore: Number(document.querySelector("#lc-close").value),
    },
    exceptions: {
      firstDayOfMonth: document.querySelector("#lc-first").checked,
      lastDayOfMonth: document.querySelector("#lc-last").checked,
      onlyWhenTurnoverFits: document.querySelector("#lc-turnover").checked,
    },
    turnover: { minimumCleanMinutes: Number(document.querySelector("#lc-clean").value) },
    blockPolicy: { mode: block ? block.value : "never", thresholdHours: Number(document.querySelector("#lc-threshold").value) },
    pricing: { mode: "custom", tiers: [tier("1h", "1h"), tier("2h", "2h"), tier("3h", "3h"), tier("4h+", "4p")] },
    proactive: {
      enabled: document.querySelector("#lc-proactive").checked,
      value: Number(document.querySelector("#lc-proactive-value").value),
      unit: document.querySelector("#lc-proactive-unit").value,
    },
  };
}

function readExtra() {
  return {
    enabled: document.querySelector("#xn-enabled").checked,
    maxNights: Number(document.querySelector("#xn-max").value),
    sides: { before: document.querySelector("#xn-before").checked, after: document.querySelector("#xn-after").checked },
    pricing: {
      mode: document.querySelector("#xn-discount").checked ? "discount" : "nightly",
      discountPct: Number(document.querySelector("#xn-discount-pct").value),
    },
    window: { closesHoursBefore: Number(document.querySelector("#xn-close").value) },
    proactive: { enabled: document.querySelector("#xn-proactive").checked, value: Number(document.querySelector("#xn-proactive-value").value), unit: "days" },
  };
}

function syncLateTiers() {
  for (const slug of ["1h", "2h", "3h", "4p"]) {
    const on = document.querySelector(`#lc-${slug}-on`).checked;
    document.querySelector(`#lc-${slug}-amount`).disabled = !on;
    document.querySelector(`#lc-${slug}-type`).disabled = !on;
    document.querySelector(`#lc-tier-${slug}`).classList.toggle("tier-off", !on);
  }
}

function saveProduct(store, scopeSelect, tree, settings, validate, errorSel) {
  const errors = validate(settings);
  const node = document.querySelector(errorSel);
  if (errors.length) {
    node.textContent = errors[0].message;
    return;
  }
  node.textContent = "Saved.";
  const { scope, id } = current(scopeSelect);
  let state = store.load();
  state = saveRule(state, { tree, scope, id, settings, actor: ACTOR, now: new Date().toISOString() });
  store.save(state);
}
