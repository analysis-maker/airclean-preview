// @ts-check

import { cleansForDate, isCountedClean, loadSeed, paidEarlyArrival, readinessBundle } from "../adapters/data.mock.js";
import { getReadiness } from "../engine/readiness.js";
import { instantToLocal, localToInstant } from "../engine/time.js";
import { renderMessage } from "../messages.js";
import { bootBrand, escapeHtml } from "../ui/brand.js";

const SESSION = "staff-session";

async function session(seed) {
  const existing = sessionStorage.getItem(SESSION);
  if (existing) return JSON.parse(existing);
  return null;
}

function bindSignIn(seed, onReady) {
  const form = document.querySelector("#sign-in");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = document.querySelector("#code").value.trim();
    const user = seed.ac_codes.find((row) => row.code === code);
    const error = document.querySelector("#sign-error");
    if (!user) {
      error.textContent = "That sample code is not recognised.";
      return;
    }
    error.textContent = "";
    sessionStorage.setItem(SESSION, JSON.stringify(user));
    form.hidden = true;
    onReady(user);
  });
}

export async function bootToday() {
  const config = await bootBrand("Today");
  const seed = await loadSeed();
  const draw = () => {
    const date = config.product.demoDate;
    const cleans = cleansForDate(seed.qa_cleans, date);
    const list = document.querySelector("#cleans");
    list.innerHTML = cleans.map((clean) => {
      const order = paidEarlyArrival(seed.ac_orders, seed.ac_reservations, clean.property_id, date);
      const property = seed.ac_properties.find((item) => item.id === clean.property_id);
      const note = order
        ? `<p class="guest-preview note">${escapeHtml(renderMessage("ops.housekeeper", {
          propertyName: clean.property_name,
          time: earlyTime(property.stdCheckInTime, order.extension_hours),
          date,
        }))}</p>`
        : "";
      return `<article class="card"><h2>${escapeHtml(clean.property_name)}</h2><p>${escapeHtml(clean.clean_date)} · ${escapeHtml(clean.cleaner_name)}</p>${note}</article>`;
    }).join("") || "<p>No cleans for this demo day.</p>";
    document.querySelector("#today-count").textContent = String(cleans.length);
  };
  const user = await session(seed);
  if (user) {
    document.querySelector("#sign-in").hidden = true;
    document.querySelector("#signed-in").hidden = false;
    document.querySelector("#who").textContent = user.name;
    draw();
  }
  bindSignIn(seed, (next) => {
    document.querySelector("#signed-in").hidden = false;
    document.querySelector("#who").textContent = next.name;
    draw();
  });
}

function earlyTime(std, hours) {
  const [h, m] = std.split(":").map(Number);
  const total = h * 60 + m - Math.round(Number(hours) * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export async function bootOffice() {
  const config = await bootBrand("Office");
  const seed = await loadSeed();
  const input = document.querySelector("#office-date");
  input.value = config.product.demoDate;
  const draw = () => {
    const date = input.value;
    const rows = seed.qa_cleans.filter((clean) => clean.clean_date === date && isCountedClean(clean.hh_status));
    const hidden = seed.qa_cleans.filter((clean) => clean.clean_date === date && !isCountedClean(clean.hh_status)).length;
    document.querySelector("#office-body").innerHTML = rows.map((clean) => {
      const property = seed.ac_properties.find((item) => item.id === clean.property_id);
      const arrival = clean.next_arrival_at ? instantToLocal(clean.next_arrival_at, property.tz) : null;
      const now = localToInstant(date, "08:00", property.tz);
      const readiness = arrival
        ? getReadiness(clean.property_id, arrival.date, now, readinessBundle(seed))
        : { status: "UNKNOWN", reasons: ["NO_CLEAN_RECORD"] };
      return `<tr class="${clean.back_to_back ? "row-b2b" : ""}">
        <td>${escapeHtml(clean.property_name)}</td>
        <td>${escapeHtml(clean.hh_status)}</td>
        <td>${clean.back_to_back ? "<span class=\"badge\">Back to back</span>" : ""}</td>
        <td>${arrival ? escapeHtml(arrival.local) : "None"}</td>
        <td><span class="badge ${badge(readiness.status)}">${escapeHtml(label(readiness.status))}</span></td>
      </tr>`;
    }).join("");
    document.querySelector("#office-count").textContent = `${rows.length} shown, ${hidden} cancelled or quote not counted`;
  };
  input.addEventListener("change", draw);
  draw();
}

function badge(status) {
  if (status === "READY") return "ready";
  if (status === "NOT_READY") return "wait";
  return "unknown";
}

function label(status) {
  if (status === "READY") return "Ready";
  if (status === "NOT_READY") return "Not ready";
  return "Unknown";
}

export async function bootMaintenance() {
  await bootBrand("Maintenance");
  const seed = await loadSeed();
  document.querySelector("#jobs").innerHTML = seed.qa_maint_jobs.map((job) => `
    <tr>
      <td>${escapeHtml(job.area_name)}</td>
      <td>${escapeHtml(job.message)}</td>
      <td>${escapeHtml(job.status)}</td>
      <td>${escapeHtml(job.priority)}</td>
    </tr>`).join("");
}

export async function bootAdmin() {
  await bootBrand("Users");
  const seed = await loadSeed();
  document.querySelector("#users").innerHTML = seed.ac_codes.map((user) => `
    <tr>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${escapeHtml(user.code)}</td>
      <td>${user.twoFactorRequired ? "2FA required" : "Not required"}</td>
      <td>${user.twoFactorRequired ? "Not set up yet" : ""}</td>
    </tr>`).join("");
}

export async function bootManager() {
  await bootBrand("Manager");
}
