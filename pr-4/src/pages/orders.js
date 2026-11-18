// @ts-check

import { loadSeed } from "../adapters/data.mock.js";
import { createLocalStorageDriver, createStore, seedStateFrom } from "../adapters/store.mock.js";
import { ordersToCsv, parseCsv } from "../services/exportRoi.js";
import { bootBrand, escapeHtml } from "../ui/brand.js";

export async function bootOrders() {
  const config = await bootBrand("Orders");
  const seed = await loadSeed();
  const store = createStore(createLocalStorageDriver(localStorage), seedStateFrom(seed));
  const month = document.querySelector("#month");
  month.value = "2026-11";
  const draw = () => {
    const state = store.load();
    const csv = ordersToCsv(state.orders, { month: month.value, properties: seed.ac_properties });
    const rows = parseCsv(csv);
    const body = rows.slice(1);
    const amountIndex = rows[0].indexOf("amount");
    const total = body.reduce((sum, row) => sum + Number(row[amountIndex] || 0), 0);
    document.querySelector("#orders-body").innerHTML = body.map((row) =>
      `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
    document.querySelector("#orders-total").textContent = `${config.product.currency} ${total}`;
    document.querySelector("#orders-count").textContent = String(body.length);
    return csv;
  };
  month.addEventListener("change", draw);
  document.querySelector("#export-csv").addEventListener("click", () => {
    const csv = draw();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `upsells-${month.value}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
  draw();
}
