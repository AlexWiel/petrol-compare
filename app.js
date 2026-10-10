"use strict";

const CONFIG = {
  location: { name: "Klagenfurt Nord", latitude: 46.6435, longitude: 14.2985 },
  dataUrl: "data/prices.json",
  liveApi: "https://api.e-control.at/sprit/1.0/search/gas-stations/by-address",
  // Muss zu den Cron-Zeiten in .github/workflows/update-prices.yml passen (UTC).
  scheduleUtc: [[7, 0], [11, 30], [15, 0]],
  fuels: {
    DIE: { label: "Diesel", accent: "amber", from: "from-amber-400", to: "to-orange-500", text: "text-amber-300" },
    SUP: { label: "Super 95", accent: "emerald", from: "from-emerald-400", to: "to-teal-500", text: "text-emerald-300" },
  },
  // Wenn die Datei älter ist, wird zusätzlich live bei der E-Control abgefragt.
  maxAgeHours: 8,
  pageRefreshMinutes: 15,
};

const state = {
  data: null,
  fuel: localGet("fuel") || "DIE",
  descending: localGet("sort") !== "asc", // Standard: absteigend
};

const $ = (sel) => document.querySelector(sel);
const fmtPrice = (n) => n.toLocaleString("de-AT", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtTime = (d) => d.toLocaleString("de-AT", { timeZone: "Europe/Vienna", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

/* ---------- Daten laden ---------- */

async function loadFromFile() {
  const res = await fetch(`${CONFIG.dataUrl}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function normalize(station, fuelType) {
  const price = (station.prices || []).find((p) => p.fuelType === fuelType);
  return {
    id: station.id,
    name: station.name,
    address: station.location?.address ?? "",
    postalCode: station.location?.postalCode ?? "",
    city: station.location?.city ?? "",
    latitude: station.location?.latitude ?? null,
    longitude: station.location?.longitude ?? null,
    distance: station.distance ?? null,
    open: station.open ?? null,
    price: price ? price.amount : null,
    openingHours: (station.openingHours || []).map((h) => ({ label: h.label, from: h.from, to: h.to, order: h.order })),
    telephone: station.contact?.telephone ?? null,
    website: station.contact?.website ?? null,
  };
}

async function loadLive() {
  const { latitude, longitude } = CONFIG.location;
  const fuels = {};
  for (const fuelType of Object.keys(CONFIG.fuels)) {
    const url = `${CONFIG.liveApi}?latitude=${latitude}&longitude=${longitude}&fuelType=${fuelType}&includeClosed=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fuels[fuelType] = (await res.json()).map((s) => normalize(s, fuelType));
  }
  return { updatedAt: new Date().toISOString(), source: "E-Control (live)", location: CONFIG.location, fuels, live: true };
}

function isStale(data) {
  if (!data?.updatedAt) return true;
  const hasStations = Object.values(data.fuels || {}).some((list) => list.length);
  return !hasStations || Date.now() - new Date(data.updatedAt).getTime() > CONFIG.maxAgeHours * 3600e3;
}

async function load() {
  let data = null;
  try { data = await loadFromFile(); } catch (e) { console.warn("prices.json nicht verfügbar:", e); }
  if (isStale(data)) {
    try { data = await loadLive(); } catch (e) { console.warn("Live-Abfrage fehlgeschlagen:", e); }
  }
  state.data = data;
  render();
}

/* ---------- Rendering ---------- */

function nextUpdate(now = new Date()) {
  const candidates = [];
  for (let day = 0; day < 2; day++) {
    for (const [h, m] of CONFIG.scheduleUtc) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, h, m));
      if (d > now) candidates.push(d);
    }
  }
  return candidates.sort((a, b) => a - b)[0];
}

function renderTabs() {
  document.querySelectorAll(".fuel-tab").forEach((btn) => {
    const active = btn.dataset.fuel === state.fuel;
    const f = CONFIG.fuels[btn.dataset.fuel];
    btn.className = `fuel-tab rounded-xl px-4 py-3 text-sm font-semibold transition ${
      active ? `bg-gradient-to-r ${f.from} ${f.to} text-ink-950 shadow-lg` : "text-slate-300 hover:bg-white/5"
    }`;
    btn.setAttribute("aria-selected", active);
  });
  $("#sort-label").textContent = state.descending ? "Absteigend (teuerste zuerst)" : "Aufsteigend (günstigste zuerst)";
  $("#sort-icon").style.transform = state.descending ? "" : "rotate(180deg)";
}

function statCard(label, value, cls = "") {
  return `<div class="glass animate-rise rounded-2xl p-3 sm:p-4">
    <p class="text-[11px] font-medium uppercase tracking-wider text-slate-400">${label}</p>
    <p class="mt-1 text-lg font-bold tabular-nums sm:text-2xl ${cls}">${value}</p></div>`;
}

function render() {
  renderTabs();
  const list = $("#list");
  const stats = $("#stats");
  const f = CONFIG.fuels[state.fuel];

  if (!state.data) {
    stats.innerHTML = "";
    $("#updated").textContent = "Keine Daten verfügbar";
    list.innerHTML = `<li class="glass rounded-2xl p-6 text-center text-sm text-slate-300">
      Die Preise konnten nicht geladen werden. Bitte später erneut versuchen oder die GitHub Action
      „Spritpreise aktualisieren" manuell starten.</li>`;
    return;
  }

  const updated = new Date(state.data.updatedAt);
  $("#updated").textContent = `Stand: ${fmtTime(updated)}${state.data.live ? " (live)" : ""}`;
  const nu = nextUpdate();
  $("#next-update").textContent = nu ? `Nächste Aktualisierung: ${fmtTime(nu)}` : "";

  const stations = state.data.fuels?.[state.fuel] || [];
  const priced = stations.filter((s) => typeof s.price === "number");
  const unpriced = stations.filter((s) => typeof s.price !== "number");
  priced.sort((a, b) => (state.descending ? b.price - a.price : a.price - b.price));

  if (priced.length) {
    const prices = priced.map((s) => s.price);
    const min = Math.min(...prices), max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    stats.innerHTML =
      statCard("Günstigster", `€ ${fmtPrice(min)}`, "text-emerald-300") +
      statCard("Durchschnitt", `€ ${fmtPrice(avg)}`) +
      statCard("Teuerster", `€ ${fmtPrice(max)}`, "text-rose-300");

    list.innerHTML = [...priced, ...unpriced].map((s, i) => {
      const has = typeof s.price === "number";
      const isMin = has && s.price === min, isMax = has && s.price === max && max !== min;
      const pct = has && max > min ? 15 + ((s.price - min) / (max - min)) * 85 : 100;
      const diff = has && s.price !== min ? `+${((s.price - min) * 100).toFixed(1).replace(".", ",")} ct` : "";
      return `<li style="animation-delay:${i * 45}ms" class="animate-rise">
        <button data-id="${esc(s.id)}" class="station glass group w-full rounded-2xl p-4 text-left transition hover:-translate-y-0.5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 ${isMin ? "ring-2 ring-emerald-400/60" : ""}">
          <div class="flex items-center gap-4">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-sm font-bold text-slate-300">${has ? i + 1 : "–"}</div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="truncate font-semibold">${esc(s.name)}</p>
                ${isMin ? '<span class="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">Günstigste</span>' : ""}
                ${isMax ? '<span class="rounded-full bg-rose-400/15 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-300">Teuerste</span>' : ""}
                ${s.open === false ? '<span class="rounded-full bg-slate-400/15 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-400">Geschlossen</span>' : ""}
              </div>
              <p class="truncate text-xs text-slate-400">${esc(s.address)}, ${esc(s.postalCode)} ${esc(s.city)}${s.distance != null ? ` · ${s.distance.toFixed(1).replace(".", ",")} km` : ""}</p>
              ${has ? `<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5"><div class="h-full rounded-full bg-gradient-to-r ${f.from} ${f.to} transition-all duration-700" style="width:${pct}%"></div></div>` : ""}
            </div>
            <div class="text-right">
              <p class="text-xl font-extrabold tabular-nums ${has ? f.text : "text-slate-500"}">${has ? `€ ${fmtPrice(s.price)}` : "k. A."}</p>
              <p class="text-[11px] text-slate-400">${diff}</p>
            </div>
          </div>
        </button></li>`;
    }).join("");
  } else {
    stats.innerHTML = "";
    list.innerHTML = `<li class="glass rounded-2xl p-6 text-center text-sm text-slate-300">Aktuell keine ${f.label}-Preise verfügbar.</li>`;
  }
}

function renderSkeleton() {
  $("#list").innerHTML = Array.from({ length: 5 }, () => '<li class="skeleton h-20 rounded-2xl"></li>').join("");
  $("#stats").innerHTML = Array.from({ length: 3 }, () => '<div class="skeleton h-20 rounded-2xl"></div>').join("");
}

/* ---------- Modals ---------- */

const modal = $("#modal"), panel = $("#modal-panel"), backdrop = $("#modal-backdrop");
let lastFocus = null;

function openModal(html) {
  lastFocus = document.activeElement;
  $("#modal-content").innerHTML = html;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  backdrop.className = "absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeIn";
  panel.classList.remove("animate-popOut");
  panel.classList.add("animate-popIn");
  document.body.classList.add("modal-open");
  $("#modal-close").focus();
}

function closeModal() {
  if (modal.classList.contains("hidden")) return;
  backdrop.className = "absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeOut";
  panel.classList.remove("animate-popIn");
  panel.classList.add("animate-popOut");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    document.body.classList.remove("modal-open");
    lastFocus?.focus();
  }, 200);
}

function stationModal(id) {
  const all = Object.entries(state.data.fuels);
  const s = (state.data.fuels[state.fuel] || []).find((x) => String(x.id) === id);
  if (!s) return;
  const pricesHtml = all.map(([fuel, list]) => {
    const match = list.find((x) => String(x.id) === id);
    const f = CONFIG.fuels[fuel];
    return `<div class="rounded-2xl bg-white/5 p-4">
      <p class="text-xs uppercase tracking-wider text-slate-400">${f.label}</p>
      <p class="mt-1 text-2xl font-extrabold tabular-nums ${f.text}">${typeof match?.price === "number" ? `€ ${fmtPrice(match.price)}` : "k. A."}</p></div>`;
  }).join("");
  const hours = [...(s.openingHours || [])].sort((a, b) => a.order - b.order)
    .map((h) => `<div class="flex justify-between py-1"><span class="text-slate-400">${esc(h.label)}</span><span class="tabular-nums">${esc(h.from)} – ${esc(h.to)}</span></div>`).join("");
  const maps = s.latitude != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${s.latitude},${s.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${s.address} ${s.city}`)}`;

  openModal(`
    <p class="text-xs font-semibold uppercase tracking-widest text-cyan-300/80">Tankstelle</p>
    <h2 class="mt-1 pr-10 text-2xl font-extrabold">${esc(s.name)}</h2>
    <p class="mt-1 text-sm text-slate-400">${esc(s.address)}, ${esc(s.postalCode)} ${esc(s.city)}</p>
    <div class="mt-5 grid grid-cols-2 gap-3">${pricesHtml}</div>
    <div class="mt-5 grid grid-cols-2 gap-3 text-sm">
      <div class="rounded-2xl bg-white/5 p-4"><p class="text-xs text-slate-400">Entfernung</p><p class="mt-1 font-semibold">${s.distance != null ? `${s.distance.toFixed(1).replace(".", ",")} km` : "–"}</p></div>
      <div class="rounded-2xl bg-white/5 p-4"><p class="text-xs text-slate-400">Status</p><p class="mt-1 font-semibold ${s.open ? "text-emerald-300" : "text-rose-300"}">${s.open == null ? "–" : s.open ? "Geöffnet" : "Geschlossen"}</p></div>
    </div>
    ${hours ? `<details class="mt-5 rounded-2xl bg-white/5 p-4 text-sm"><summary class="cursor-pointer font-semibold">Öffnungszeiten</summary><div class="mt-3">${hours}</div></details>` : ""}
    <div class="mt-6 flex flex-col gap-2 sm:flex-row">
      <a href="${maps}" target="_blank" rel="noopener" class="flex-1 rounded-xl bg-gradient-to-r from-cyan-400 to-indigo-500 px-4 py-3 text-center font-semibold text-ink-950 transition hover:brightness-110">🧭 Route starten</a>
      ${s.telephone ? `<a href="tel:${esc(s.telephone)}" class="flex-1 rounded-xl bg-white/10 px-4 py-3 text-center font-semibold transition hover:bg-white/15">📞 Anrufen</a>` : ""}
    </div>`);
}

function infoModal() {
  const times = CONFIG.scheduleUtc.map(([h, m]) => {
    const d = new Date(); d.setUTCHours(h, m, 0, 0);
    return d.toLocaleTimeString("de-AT", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit" });
  });
  openModal(`
    <p class="text-xs font-semibold uppercase tracking-widest text-cyan-300/80">Info</p>
    <h2 class="mt-1 text-2xl font-extrabold">Über diese Seite</h2>
    <div class="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
      <p>Verglichen werden <strong>Diesel</strong> und <strong>Super 95</strong> der öffentlichen Tankstellen im Umkreis von
      <strong>${esc(CONFIG.location.name)}</strong>. Die Daten stammen aus dem amtlichen
      <a class="underline" href="https://www.spritpreisrechner.at" target="_blank" rel="noopener">Spritpreisrechner der E-Control</a>.</p>
      <p>Die Preise werden automatisch dreimal täglich aktualisiert – heute um ca. <strong>${times.join(", ")} Uhr</strong>
      (Vormittag, Mittag, später Nachmittag). In Österreich dürfen Tankstellen ihre Preise nur einmal täglich um 12:00 Uhr erhöhen.</p>
      <p class="text-xs text-slate-500">Hinweis: Die E-Control veröffentlicht je Abfrage nur eine begrenzte Anzahl an Tankstellen.
      Alle Angaben ohne Gewähr.</p>
    </div>`);
}

/* ---------- Events ---------- */

document.querySelectorAll(".fuel-tab").forEach((btn) =>
  btn.addEventListener("click", () => { state.fuel = btn.dataset.fuel; localSet("fuel", state.fuel); render(); }));
$("#btn-sort").addEventListener("click", () => { state.descending = !state.descending; localSet("sort", state.descending ? "desc" : "asc"); render(); });
$("#btn-info").addEventListener("click", infoModal);
$("#list").addEventListener("click", (e) => { const b = e.target.closest(".station"); if (b) stationModal(b.dataset.id); });
$("#modal-close").addEventListener("click", closeModal);
backdrop.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

renderTabs();
renderSkeleton();
load();
setInterval(load, CONFIG.pageRefreshMinutes * 60e3);
