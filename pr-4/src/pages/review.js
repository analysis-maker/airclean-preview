// @ts-check

import { loadSeed } from "../adapters/data.mock.js";
import { readJson } from "../io.js";
import { queueForReview, submitReview } from "../services/reviewQueue.js";
import { bootBrand, escapeHtml } from "../ui/brand.js";

const KEY = "access-reviews-v1";

export async function bootReview() {
  await bootBrand("Access reviews");
  const seed = await loadSeed();
  const rules = await readJson(new URL("../../config/risk.json", import.meta.url));
  const saved = JSON.parse(localStorage.getItem(KEY) || "{\"reviews\":[],\"audit\":[]}");
  const reviews = new Map(saved.reviews.map((row) => [row.id, row]));
  const paint = () => {
    const items = seed.ac_screening.map((item) => ({ ...item, review: reviews.get(item.id) || null }));
    const queue = queueForReview(items, rules);
    document.querySelector("#queue").innerHTML = queue.length
      ? queue.map((row) => `
        <article class="card" data-id="${escapeHtml(row.item.id)}">
          <h2>${escapeHtml(row.item.propertyName)}</h2>
          <p>${escapeHtml(row.item.checkInDate)} · adults ${escapeHtml(row.item.guestsAdults)} · ${escapeHtml(row.item.country)}</p>
          <p>Flags: ${escapeHtml(row.screening.reasons.join(", "))}</p>
          <label>Reason <input data-reason type="text" placeholder="Why this decision"></label>
          <div class="actions">
            <button class="btn btn-primary" type="button" data-decision="approved">Approve</button>
            <button class="btn btn-ghost" type="button" data-decision="denied">Deny</button>
          </div>
          <p data-result></p>
        </article>`).join("")
      : "<p>No stays are waiting.</p>";
    document.querySelector("#audit").innerHTML = saved.audit.map((row) =>
      `<li>${escapeHtml(row.at)} ${escapeHtml(row.by)} ${escapeHtml(row.action)} ${escapeHtml(row.entityId)}: ${escapeHtml(row.detail.reason)}</li>`).join("")
      || "<li>No decisions yet.</li>";
  };
  document.querySelector("#queue").addEventListener("click", (event) => {
    const button = event.target.closest("[data-decision]");
    if (!button) return;
    const card = button.closest("[data-id]");
    const reason = card.querySelector("[data-reason]").value.trim();
    const resultNode = card.querySelector("[data-result]");
    if (!reason) {
      resultNode.textContent = "Write a reason first.";
      return;
    }
    const item = seed.ac_screening.find((row) => row.id === card.getAttribute("data-id"));
    const outcome = submitReview(item, rules, {
      decision: button.getAttribute("data-decision"),
      by: "Demo Ops",
      reason,
      at: new Date().toISOString(),
    });
    reviews.set(item.id, { decision: button.getAttribute("data-decision"), reason });
    saved.reviews = [...reviews.entries()].map(([id, review]) => ({ id, ...review }));
    saved.audit.push(outcome.audit);
    localStorage.setItem(KEY, JSON.stringify(saved));
    paint();
    document.querySelector("#audit").insertAdjacentHTML("afterbegin",
      `<li>${outcome.result.released ? "Released a placeholder only." : "Still held. No access details were released."}</li>`);
  });
  paint();
}
