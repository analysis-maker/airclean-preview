// @ts-check

import { loadSeed } from "../adapters/data.mock.js";
import { getConfig } from "../config.js";
import { createLocalStorageDriver, createStore, saveRule, seedStateFrom } from "../adapters/store.mock.js";
import { priceForTier } from "../engine/pricing.js";
import { flattenSettings, resolveRule, sourceLabel } from "../rules/resolve.js";
import { validateSettings } from "../rules/schema.js";
import { bootBrand, escapeHtml } from "../ui/brand.js";
import { customPatch, formValuesToRule, thresholdEnabled, tierInputsEnabled, upsertSet } from "../ui/settingsState.js";

const ACTOR = "Demo Admin";
const TIER_IDS = { "1h": "1h", "2h": "2h", "3h": "3h", "4h+": "4p" };

const GROUPS = {
  enabled: ["enabled"],
  earliestArrivalTime: ["earliestArrivalTime"],
  window: ["window.opensHoursBefore", "window.closesHoursBefore"],
  "exceptions.firstDayOfMonth": ["exceptions.firstDayOfMonth"],
  "exceptions.lastDayOfMonth": ["exceptions.lastDayOfMonth"],
  "exceptions.onlyWhenReady": ["exceptions.onlyWhenReady"],
  blockPolicy: ["blockPolicy.mode", "blockPolicy.thresholdHours"],
  "pricing.mode": ["pricing.mode"],
  "pricing.tiers.1h": ["pricing.tiers.1h.enabled", "pricing.tiers.1h.amount", "pricing.tiers.1h.type"],
  "pricing.tiers.2h": ["pricing.tiers.2h.enabled", "pricing.tiers.2h.amount", "pricing.tiers.2h.type"],
  "pricing.tiers.3h": ["pricing.tiers.3h.enabled", "pricing.tiers.3h.amount", "pricing.tiers.3h.type"],
  "pricing.tiers.4h+": ["pricing.tiers.4h+.enabled", "pricing.tiers.4h+.amount", "pricing.tiers.4h+.type"],
  proactive: ["proactive.enabled", "proactive.value", "proactive.unit"],
};

export async function bootSettings() {
  const config = await bootBrand("Settings");
  const seed = await loadSeed();
  const store = createStore(createLocalStorageDriver(localStorage), seedStateFrom(seed));
  let state = store.load();
  const properties = seed.ac_properties;
  const form = document.querySelector("#upsell-form");
  const scopeSelect = document.querySelector("#scope");
  fillScope(scopeSelect, state, properties);
  fillPropertySelect(document.querySelector("#set-properties"), properties);
  if (!config.decisions.chargeForEarlyCheckin) {
    document.querySelector("#decision-banner").hidden = false;
  }
  document.querySelectorAll("[data-currency-label]").forEach((node) => {
    node.textContent = `Fixed amount (${config.product.currency})`;
  });

  const api = {
    get state() { return state; },
    set state(next) { state = next; store.save(next); },
    properties,
    form,
    scopeSelect,
  };

  scopeSelect.addEventListener("change", () => paint(api));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save(api);
  });
  form.addEventListener("input", () => {
    syncLocks(api);
    showExample();
    document.querySelector("#save-status").textContent = "";
  });
  document.querySelector("#discard").addEventListener("click", () => {
    state = store.load();
    paint(api);
  });
  document.querySelector("#history-toggle").addEventListener("click", () => showHistory(api));
  document.querySelector("#ready-help").addEventListener("click", () => {
    const panel = document.querySelector("#ready-panel");
    panel.hidden = !panel.hidden;
  });
  document.querySelector("#block-dec").addEventListener("click", () => stepThreshold(-1));
  document.querySelector("#block-inc").addEventListener("click", () => stepThreshold(1));
  document.querySelectorAll("[data-custom]").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      if (!toggle.checked) restoreInherited(api, toggle.getAttribute("data-custom"));
      syncLocks(api);
    });
  });
  document.querySelector("#set-create").addEventListener("click", () => createSet(api));
  document.querySelector("#sets").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='save-set']");
    if (!button) return;
    saveSet(api, button.closest("[data-set]"));
  });
  paint(api);
}

function fillScope(select, state, properties) {
  const options = [`<option value="global">Default for all properties</option>`];
  for (const set of state.listingSets) {
    options.push(`<option value="listingSet:${escapeHtml(set.id)}">Set: ${escapeHtml(set.name)}</option>`);
  }
  for (const property of properties) {
    options.push(`<option value="property:${escapeHtml(property.id)}">Property: ${escapeHtml(property.name)}</option>`);
  }
  select.innerHTML = options.join("");
}

function fillPropertySelect(select, properties) {
  select.innerHTML = properties.map((property) =>
    `<option value="${escapeHtml(property.id)}">${escapeHtml(property.name)}</option>`).join("");
}

function currentScope(select) {
  const [scope, id] = select.value.split(":");
  return { scope, id: id || "global" };
}

function membership(state, propertyId) {
  return state.listingSets.filter((set) => set.propertyIds.includes(propertyId)).map((set) => set.id);
}

function setRules(state) {
  return Object.entries(state.rules.listingSets || {}).map(([id, rule]) => ({ id, ...rule }));
}

function resolved(state, properties, scope, id, includeSelf) {
  if (scope === "global") {
    return resolveRule({
      globalRule: state.rules.global,
      setRules: [],
      propertyRule: null,
      property: { id: "global", listingSetIds: [] },
      listingSets: state.listingSets,
    });
  }
  if (scope === "listingSet") {
    return resolveRule({
      globalRule: state.rules.global,
      setRules: includeSelf ? setRules(state).filter((rule) => rule.id === id) : [],
      propertyRule: null,
      property: { id, listingSetIds: [id] },
      listingSets: state.listingSets,
    });
  }
  const property = properties.find((item) => item.id === id);
  const propertyRule = includeSelf && state.rules.properties?.[id]
    ? { id, ...state.rules.properties[id] }
    : null;
  return resolveRule({
    globalRule: state.rules.global,
    setRules: setRules(state),
    propertyRule,
    property: { ...property, listingSetIds: membership(state, id) },
    listingSets: state.listingSets,
  });
}

function patchLeaves(state, scope, id) {
  if (scope === "global") return null;
  const patch = scope === "listingSet"
    ? state.rules.listingSets?.[id]?.settings
    : state.rules.properties?.[id]?.settings;
  return flattenSettings(patch || {});
}

function paint(api) {
  const { scope, id } = currentScope(api.scopeSelect);
  api.form.dataset.scope = scope;
  const view = resolved(api.state, api.properties, scope, id, true);
  const leaves = patchLeaves(api.state, scope, id) || {};
  writeRule(view.rule);
  for (const toggle of api.form.querySelectorAll("[data-custom]")) {
    const key = toggle.getAttribute("data-custom");
    const custom = scope !== "global" && GROUPS[key].some((path) => path in leaves);
    toggle.checked = custom;
    const source = view.sources[GROUPS[key][0]];
    const label = api.form.querySelector(`[data-inherit="${key}"]`);
    if (label) {
      label.textContent = custom ? "Custom value" : `Inherited from ${sourceLabel(source, api.state.listingSets)}`;
    }
  }
  syncLocks(api);
  showExample();
  clearErrors();
  renderSets(api);
}

function writeRule(rule) {
  document.querySelector("#offer-enabled").checked = Boolean(rule.enabled);
  document.querySelector("#earliest").value = rule.earliestArrivalTime;
  const open = rule.window.opensHoursBefore;
  const close = rule.window.closesHoursBefore;
  document.querySelector("#open-nolimit").checked = open == null;
  document.querySelector("#close-nolimit").checked = close == null;
  document.querySelector("#open-hours").value = open == null ? "" : String(open);
  document.querySelector("#close-hours").value = close == null ? "" : String(close);
  document.querySelector("#ex-first").checked = Boolean(rule.exceptions.firstDayOfMonth);
  document.querySelector("#ex-last").checked = Boolean(rule.exceptions.lastDayOfMonth);
  document.querySelector("#ex-ready").checked = Boolean(rule.exceptions.onlyWhenReady);
  document.querySelector("#block-always").checked = rule.blockPolicy.mode === "always";
  document.querySelector("#block-over").checked = rule.blockPolicy.mode === "if_extension_over";
  document.querySelector("#block-never").checked = rule.blockPolicy.mode === "never";
  document.querySelector("#block-threshold").value = String(rule.blockPolicy.thresholdHours);
  document.querySelector("#price-custom").checked = rule.pricing.mode !== "smart";
  for (const tier of rule.pricing.tiers) {
    const slug = TIER_IDS[tier.key];
    document.querySelector(`#tier-${slug}-on`).checked = Boolean(tier.enabled);
    document.querySelector(`#tier-${slug}-amount`).value = String(tier.amount);
    document.querySelector(`#tier-${slug}-type`).value = tier.type;
  }
  document.querySelector("#proactive-on").checked = Boolean(rule.proactive.enabled);
  document.querySelector("#proactive-value").value = String(rule.proactive.value);
  document.querySelector("#proactive-unit").value = rule.proactive.unit;
}

function readValues() {
  const block = document.querySelector("input[name='block']:checked");
  return {
    enabled: document.querySelector("#offer-enabled").checked,
    earliestArrivalTime: document.querySelector("#earliest").value,
    openNoLimit: document.querySelector("#open-nolimit").checked,
    opensHoursBefore: document.querySelector("#open-hours").value,
    closeNoLimit: document.querySelector("#close-nolimit").checked,
    closesHoursBefore: document.querySelector("#close-hours").value,
    firstDayOfMonth: document.querySelector("#ex-first").checked,
    lastDayOfMonth: document.querySelector("#ex-last").checked,
    onlyWhenReady: document.querySelector("#ex-ready").checked,
    blockMode: block ? block.value : "",
    thresholdHours: document.querySelector("#block-threshold").value,
    proactiveEnabled: document.querySelector("#proactive-on").checked,
    proactiveValue: document.querySelector("#proactive-value").value,
    proactiveUnit: document.querySelector("#proactive-unit").value,
    "1h-enabled": document.querySelector("#tier-1h-on").checked,
    "1h-amount": document.querySelector("#tier-1h-amount").value,
    "1h-type": document.querySelector("#tier-1h-type").value,
    "2h-enabled": document.querySelector("#tier-2h-on").checked,
    "2h-amount": document.querySelector("#tier-2h-amount").value,
    "2h-type": document.querySelector("#tier-2h-type").value,
    "3h-enabled": document.querySelector("#tier-3h-on").checked,
    "3h-amount": document.querySelector("#tier-3h-amount").value,
    "3h-type": document.querySelector("#tier-3h-type").value,
    "4h+-enabled": document.querySelector("#tier-4p-on").checked,
    "4h+-amount": document.querySelector("#tier-4p-amount").value,
    "4h+-type": document.querySelector("#tier-4p-type").value,
  };
}

function numbers(values) {
  return {
    ...values,
    opensHoursBefore: values.opensHoursBefore === "" ? null : Number(values.opensHoursBefore),
    closesHoursBefore: values.closesHoursBefore === "" ? null : Number(values.closesHoursBefore),
    thresholdHours: Number(values.thresholdHours),
    proactiveValue: Number(values.proactiveValue),
    "1h-amount": Number(values["1h-amount"]),
    "2h-amount": Number(values["2h-amount"]),
    "3h-amount": Number(values["3h-amount"]),
    "4h+-amount": Number(values["4h+-amount"]),
  };
}

function locked(form, key) {
  if (form.dataset.scope === "global") return false;
  const toggle = form.querySelector(`[data-custom="${key}"]`);
  return toggle ? !toggle.checked : false;
}

function syncLocks(api) {
  const values = readValues();
  const blockOn = thresholdEnabled(values.blockMode) && !locked(api.form, "blockPolicy");
  document.querySelector("#block-threshold").disabled = !blockOn;
  document.querySelector("#block-dec").disabled = !blockOn;
  document.querySelector("#block-inc").disabled = !blockOn;
  document.querySelector("#open-hours").disabled = values.openNoLimit || locked(api.form, "window");
  document.querySelector("#close-hours").disabled = values.closeNoLimit || locked(api.form, "window");
  const simple = [
    ["#offer-enabled", "enabled"],
    ["#earliest", "earliestArrivalTime"],
    ["#open-nolimit", "window"],
    ["#close-nolimit", "window"],
    ["#ex-first", "exceptions.firstDayOfMonth"],
    ["#ex-last", "exceptions.lastDayOfMonth"],
    ["#ex-ready", "exceptions.onlyWhenReady"],
    ["#block-always", "blockPolicy"],
    ["#block-over", "blockPolicy"],
    ["#block-never", "blockPolicy"],
    ["#proactive-on", "proactive"],
    ["#proactive-value", "proactive"],
    ["#proactive-unit", "proactive"],
  ];
  for (const [selector, key] of simple) {
    document.querySelector(selector).disabled = locked(api.form, key);
  }
  for (const [key, slug] of Object.entries(TIER_IDS)) {
    const row = document.querySelector(`#tier-${slug}`);
    const on = document.querySelector(`#tier-${slug}-on`);
    const group = `pricing.tiers.${key}`;
    const groupLocked = locked(api.form, group);
    on.disabled = groupLocked;
    const editable = tierInputsEnabled(on.checked) && !groupLocked;
    document.querySelector(`#tier-${slug}-amount`).disabled = !editable;
    document.querySelector(`#tier-${slug}-type`).disabled = !editable;
    row.classList.toggle("tier-off", !on.checked);
  }
}

function restoreInherited(api, key) {
  const { scope, id } = currentScope(api.scopeSelect);
  const base = resolved(api.state, api.properties, scope, id, false).rule;
  const current = formValuesToRule(numbers(readValues()));
  if (key === "enabled") current.enabled = base.enabled;
  if (key === "earliestArrivalTime") current.earliestArrivalTime = base.earliestArrivalTime;
  if (key === "window") current.window = base.window;
  if (key === "exceptions.firstDayOfMonth") current.exceptions.firstDayOfMonth = base.exceptions.firstDayOfMonth;
  if (key === "exceptions.lastDayOfMonth") current.exceptions.lastDayOfMonth = base.exceptions.lastDayOfMonth;
  if (key === "exceptions.onlyWhenReady") current.exceptions.onlyWhenReady = base.exceptions.onlyWhenReady;
  if (key === "blockPolicy") current.blockPolicy = base.blockPolicy;
  if (key === "proactive") current.proactive = base.proactive;
  if (key.startsWith("pricing.tiers.")) {
    const tierKey = key.split(".")[2];
    const from = base.pricing.tiers.find((tier) => tier.key === tierKey);
    const index = current.pricing.tiers.findIndex((tier) => tier.key === tierKey);
    if (from && index >= 0) current.pricing.tiers[index] = { ...from };
  }
  writeRule(current);
}

function stepThreshold(delta) {
  const input = document.querySelector("#block-threshold");
  if (input.disabled) return;
  const next = Math.min(12, Math.max(1, Number(input.value || 1) + delta));
  input.value = String(next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function showExample() {
  const rule = formValuesToRule(numbers(readValues()));
  const tier = rule.pricing.tiers.find((item) => item.key === "1h");
  const box = document.querySelector("#example");
  if (!tier?.enabled) {
    box.textContent = "The 1 hour price is off, so this example stays blank.";
    return;
  }
  const currency = getConfig().product.currency;
  const amount = priceForTier(tier, 400);
  box.textContent = `Example: a nightly rate of ${currency} 400, arriving 1 hour early, would be ${currency} ${amount}.`;
}

function clearErrors() {
  document.querySelectorAll("[data-error-for]").forEach((node) => { node.textContent = ""; });
}

function save(api) {
  clearErrors();
  const { scope, id } = currentScope(api.scopeSelect);
  const values = numbers(readValues());
  let settings;
  if (scope === "global") settings = formValuesToRule(values);
  else {
    const paths = [...api.form.querySelectorAll("[data-custom]")]
      .filter((toggle) => toggle.checked)
      .map((toggle) => toggle.getAttribute("data-custom"));
    settings = customPatch(values, paths);
  }
  const preview = resolvedPreview(api, scope, id, settings);
  const errors = validateSettings(preview.rule);
  if (errors.length) {
    for (const error of errors) {
      const node = api.form.querySelector(`[data-error-for="${error.path}"]`)
        || api.form.querySelector(`[data-error-for="${error.path.split(".").slice(0, 2).join(".")}"]`)
        || document.querySelector("#form-errors");
      if (node) node.textContent = error.message;
    }
    document.querySelector("#save-status").textContent = "Fix the highlighted fields before saving.";
    return;
  }
  api.state = saveRule(api.state, {
    scope,
    id,
    settings,
    actor: ACTOR,
    now: new Date().toISOString(),
  });
  document.querySelector("#save-status").textContent = "Saved.";
  paint(api);
  document.querySelector("#save-status").textContent = "Saved.";
}

function resolvedPreview(api, scope, id, settings) {
  const draft = structuredClone(api.state);
  if (scope === "global") draft.rules.global = { ...draft.rules.global, settings };
  else if (scope === "listingSet") draft.rules.listingSets[id] = { ...(draft.rules.listingSets[id] || { version: 0 }), settings };
  else draft.rules.properties[id] = { ...(draft.rules.properties[id] || { version: 0 }), settings };
  return resolved(draft, api.properties, scope, id, true);
}

function showHistory(api) {
  const panel = document.querySelector("#history-panel");
  const { scope, id } = currentScope(api.scopeSelect);
  const rows = (api.state.history || []).filter((row) => row.scope === scope && row.scopeId === (scope === "global" ? "global" : id));
  const current = scope === "global"
    ? api.state.rules.global
    : scope === "listingSet"
      ? api.state.rules.listingSets[id]
      : api.state.rules.properties[id];
  const list = rows.length ? rows : current ? [{
    version: current.version,
    updated_by: current.updated_by,
    updated_at: current.updated_at,
    scope,
    scopeId: scope === "global" ? "global" : id,
  }] : [];
  panel.hidden = false;
  panel.innerHTML = list.length
    ? `<h3>History</h3><ul>${list.map((row) =>
      `<li>Version ${escapeHtml(row.version)} by ${escapeHtml(row.updated_by)} at ${escapeHtml(row.updated_at)}</li>`).join("")}</ul>`
    : "<p>No saved versions yet.</p>";
}

function renderSets(api) {
  const box = document.querySelector("#sets");
  box.innerHTML = api.state.listingSets.map((set) => `
    <div class="set-row" data-set="${escapeHtml(set.id)}">
      <input data-field="name" aria-label="Set name" value="${escapeHtml(set.name)}">
      <input data-field="priority" aria-label="Priority" type="number" value="${escapeHtml(set.priority)}">
      <select data-field="members" aria-label="Properties in this set" multiple size="4">
        ${api.properties.map((property) => `<option value="${escapeHtml(property.id)}"${set.propertyIds.includes(property.id) ? " selected" : ""}>${escapeHtml(property.name)}</option>`).join("")}
      </select>
      <button class="btn btn-ghost" type="button" data-action="save-set">Save set</button>
    </div>`).join("");
}

function createSet(api) {
  const name = document.querySelector("#set-name").value.trim();
  const priority = Number(document.querySelector("#set-priority").value);
  const propertyIds = [...document.querySelector("#set-properties").selectedOptions].map((option) => option.value);
  const error = document.querySelector("#set-error");
  if (!name || !Number.isInteger(priority)) {
    error.textContent = "Enter a name and a whole-number priority.";
    return;
  }
  error.textContent = "";
  const listingSets = upsertSet(api.state.listingSets, { name, priority, propertyIds });
  const selected = api.scopeSelect.value;
  api.state = { ...api.state, listingSets };
  document.querySelector("#set-name").value = "";
  fillScope(api.scopeSelect, api.state, api.properties);
  api.scopeSelect.value = selected;
  paint(api);
}

function saveSet(api, row) {
  const id = row.getAttribute("data-set");
  const name = row.querySelector("[data-field='name']").value.trim();
  const priority = Number(row.querySelector("[data-field='priority']").value);
  const propertyIds = [...row.querySelector("[data-field='members']").selectedOptions].map((option) => option.value);
  if (!name || !Number.isInteger(priority)) return;
  const listingSets = upsertSet(api.state.listingSets, { id, name, priority, propertyIds });
  const selected = api.scopeSelect.value;
  api.state = { ...api.state, listingSets };
  fillScope(api.scopeSelect, api.state, api.properties);
  api.scopeSelect.value = selected;
  paint(api);
}
