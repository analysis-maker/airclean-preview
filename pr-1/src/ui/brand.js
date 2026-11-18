// @ts-check

import { getConfig, loadConfig, t } from "../config.js";

/** @param {{ previewBanner?: string }} product */
export function previewBannerText(product) {
  return String(product?.previewBanner || "").trim();
}

/**
 * Shows the config banner. An empty config value removes it.
 * @param {string} text
 */
export function showPreviewBanner(text) {
  if (typeof document === "undefined") return;
  const existing = document.getElementById("preview-banner");
  if (!text) {
    if (existing) existing.remove();
    return;
  }
  const node = existing || document.createElement("p");
  node.id = "preview-banner";
  node.setAttribute("role", "status");
  node.textContent = text;
  if (!existing) document.body.prepend(node);
}

/** @param {string} heading */
export async function bootBrand(heading) {
  const { product } = await loadConfig();
  document.title = heading ? `${product.productName} · ${heading}` : product.productName;
  showPreviewBanner(previewBannerText(product));
  document.querySelectorAll("[data-brand]").forEach((node) => {
    node.textContent = t(node.getAttribute("data-brand") || "");
  });
  if ("serviceWorker" in navigator) {
    const root = new URL("../../", import.meta.url);
    navigator.serviceWorker.register(new URL("sw.js", root)).catch(() => {});
  }
  return getConfig();
}

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
