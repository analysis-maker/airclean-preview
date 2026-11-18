// @ts-check

import { defaultSettings } from "./schema.js";

/**
 * Field-level merge. Lowest listing-set priority number wins among sets.
 * Property overrides win over sets. Global is the base.
 *
 * @param {{
 *   globalRule: { id?: string, version: number, settings: object },
 *   setRules: { id: string, version: number, settings: object }[],
 *   propertyRule: { id: string, version: number, settings: object } | null,
 *   property: { id: string, listingSetIds?: string[] },
 *   listingSets: { id: string, priority: number, name?: string }[],
 * }} input
 */
export function resolveRule(input) {
  const makeDefaults = input.defaults || defaultSettings;
  const values = makeDefaults();
  /** @type {Record<string, { scope: string, id: string, version: number }>} */
  const sources = {};

  const baseSource = {
    scope: "global",
    id: input.globalRule.id || "global",
    version: input.globalRule.version,
  };
  applyLayer(values, sources, makeDefaults(), baseSource);
  applyLayer(values, sources, input.globalRule.settings, baseSource);

  const memberIds = new Set(input.property.listingSetIds || []);
  const applicable = input.listingSets
    .filter((set) => memberIds.has(set.id))
    .sort((a, b) => b.priority - a.priority);

  const setRuleById = new Map(input.setRules.map((rule) => [rule.id, rule]));
  for (const set of applicable) {
    const rule = setRuleById.get(set.id);
    if (!rule) continue;
    applyLayer(values, sources, rule.settings, {
      scope: "listingSet",
      id: set.id,
      version: rule.version,
    });
  }

  if (input.propertyRule) {
    applyLayer(values, sources, input.propertyRule.settings, {
      scope: "property",
      id: input.propertyRule.id || input.property.id,
      version: input.propertyRule.version,
    });
  }

  return { rule: values, sources };
}

/**
 * @param {object} target
 * @param {Record<string, { scope: string, id: string, version: number }>} sources
 * @param {object} patch
 * @param {{ scope: string, id: string, version: number }} source
 */
function applyLayer(target, sources, patch, source) {
  for (const [path, value] of Object.entries(flattenSettings(patch))) {
    setPath(target, path, value);
    sources[path] = { ...source };
  }
}

/** @param {object} settings */
export function flattenSettings(settings) {
  /** @type {Record<string, unknown>} */
  const out = {};
  walk(settings, "", out);
  return out;
}

/**
 * @param {unknown} node
 * @param {string} prefix
 * @param {Record<string, unknown>} out
 */
function walk(node, prefix, out) {
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === "tiers" && Array.isArray(value)) {
      for (const tier of value) {
        if (!tier || typeof tier !== "object" || !tier.key) continue;
        for (const field of ["enabled", "amount", "type", "hours"]) {
          if (field in tier) out[`${prefix ? prefix + "." : ""}tiers.${tier.key}.${field}`] = tier[field];
        }
      }
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      walk(value, path, out);
      continue;
    }
    out[path] = value;
  }
}

/** @param {object} rule @param {string} path @param {unknown} value */
function setPath(rule, path, value) {
  const parts = path.split(".");
  if (parts[0] === "pricing" && parts[1] === "tiers") {
    const tier = rule.pricing.tiers.find((item) => item.key === parts[2]);
    if (tier && parts[3]) tier[parts[3]] = value;
    return;
  }
  if (parts[0] === "tiers") {
    const tier = rule.pricing.tiers.find((item) => item.key === parts[1]);
    if (tier && parts[2]) tier[parts[2]] = value;
    return;
  }
  let cursor = rule;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
}

/**
 * @param {{ scope: string, id: string }} source
 * @param {{ id: string, name: string }[]} listingSets
 */
export function sourceLabel(source, listingSets) {
  if (!source || source.scope === "global") return "Default for all properties";
  if (source.scope === "listingSet") {
    const set = listingSets.find((item) => item.id === source.id);
    return `Set: ${set ? set.name : source.id}`;
  }
  if (source.scope === "property") return "This property";
  return source.scope;
}
