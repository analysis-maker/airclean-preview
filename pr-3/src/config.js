// @ts-check

import { readJson } from "./io.js";

/** @type {{ product: Record<string, string>, decisions: Record<string, unknown> } | null} */
let cache = null;

export async function loadConfig() {
  if (cache) return cache;
  const product = await readJson(new URL("../config/product.json", import.meta.url));
  const decisions = await readJson(new URL("../config/decisions.json", import.meta.url));
  cache = { product, decisions };
  return cache;
}

export function getConfig() {
  if (!cache) throw new Error("Config is not loaded");
  return cache;
}

/** Test helper. */
export function setConfigForTests(next) {
  cache = next;
}

/**
 * Interpolate {placeholders}. Config values fill anything the caller does not pass.
 * @param {string} str
 * @param {Record<string, unknown>} [vars]
 */
export function t(str, vars = {}) {
  const product = cache?.product || {};
  const bag = { ...product, ...vars };
  return String(str).replace(/\{(\w+)\}/g, (_, key) => {
    const value = bag[key];
    return value == null ? `{${key}}` : String(value);
  });
}
