"use strict";

// Verzeichnis von app.js – Basis für locations.json und die Daten, auch aus Unterseiten wie tamsweg/.
const BASE = new URL(".", document.currentScript.src);
// Standort der Seite: <body data-location="…">, ohne Angabe Klagenfurt Nord.
const LOCATION_ID = document.body.dataset.location || "klagenfurt-nord";

const CONFIG = {
  // location, dataUrl und historyUrl werden in initLocation() aus locations.json gesetzt.
  location: null,
  dataUrl: null,
  historyUrl: null,
  liveApi: "https://api.e-control.at/sprit/1.0/search/gas-stations/by-address",
  // Abrufzeitfenster (Wiener Zeit) – müssen zu WINDOWS in scripts/fetch-prices.mjs passen.
  windows: [{ from: 8, to: 12 }, { from: 12, to: 16 }, { from: 16, to: 20 }],
  fuels: {
    DIE: { label: "Diesel", accent: "amber", from: "from-amber-400", to: "to-orange-500", text: "text-amber-300" },
    SUP: { label: "Super 95", accent: "emerald", from: "from-emerald-400", to: "to-teal-500", text: "text-emerald-300" },
  },
  // Wenn die Datei älter ist, wird zusätzlich live bei der E-Control abgefragt (Nachtpause 20–8 Uhr beachten).
  maxAgeHours: 14,
  pageRefreshMinutes: 15,
};

const state = {
  data: null,
  fuel: localGet("fuel") || "DIE",
  descending: localGet("sortOrder") === "desc", // Standard: aufsteigend (günstigste zuerst)
  history: null,
  days: Number(localGet("days") ?? 30),
};

const $ = (sel) => document.querySelector(sel);
const fmtPrice = (n) => n.toLocaleString("de-AT", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtTime = (d) => d.toLocaleString("de-AT", { timeZone: "Europe/Vienna", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

/* ---------- Standort ---------- */

async function initLocation() {
  const res = await fetch(new URL("locations.json", BASE));
  if (!res.ok) throw new Error(`locations.json: HTTP ${res.status}`);
  const locations = await res.json();
  const loc = locations.find((l) => l.id === LOCATION_ID);
  if (!loc) throw new Error(`Unbekannter Standort: ${LOCATION_ID}`);

  CONFIG.location = { name: loc.name, latitude: loc.latitude, longitude: loc.longitude };
  CONFIG.dataUrl = new URL(`${loc.dataDir}/prices.json`, BASE).href;
  CONFIG.historyUrl = new URL(`${loc.dataDir}/history.json`, BASE).href;

  // Letztes Wort der Überschrift im Farbverlauf, z. B. „Klagenfurt <Nord>“ bzw. „<Tamsweg>“.
  const words = loc.name.split(" ");
  const last = words.pop();
  $("#loc-title").innerHTML = `${words.length ? `${esc(words.join(" "))} ` : ""}<span class="bg-gradient-to-r from-amber-300 via-orange-400 to-emerald-300 bg-clip-text text-transparent">${esc(last)}</span>`;
  document.title = `Spritpreise ${loc.name}`;
  $("#history-loc").textContent = loc.name;
  $("#loc-switch").innerHTML = locations.map((l) => l.id === loc.id
    ? `<span aria-current="page" class="rounded-full bg-white/15 px-3 py-1.5 text-white">📍 ${esc(l.name)}</span>`
    : `<a href="${new URL(l.path || "./", BASE).href}" class="glass rounded-full px-3 py-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white">${esc(l.name)}</a>`).join("");
}

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
  try {
    const res = await fetch(`${CONFIG.historyUrl}?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) state.history = await res.json();
  } catch (e) { console.warn("history.json nicht verfügbar:", e); }
  render();
}

/* ---------- Rendering ---------- */

const fmtHour = (h) => `${String(h).padStart(2, "0")}:00`;

// Beginn des nächsten Abrufzeitfensters in Wiener Zeit, z. B. „heute ab 12:00 Uhr“.
function nextUpdateText(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", hour: "2-digit", hourCycle: "h23" }).format(now));
  const next = CONFIG.windows.find((w) => w.from > hour);
  return next ? `heute ab ${fmtHour(next.from)} Uhr` : `morgen ab ${fmtHour(CONFIG.windows[0].from)} Uhr`;
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
  renderList();
  renderHistory();
}

function renderList() {
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
  $("#next-update").textContent = `Nächste Aktualisierung: ${nextUpdateText()}`;

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

/* ---------- Preisverlauf ---------- */

const SERIES = [
  { key: "min", label: "Günstigster", color: "#0891b2", dash: "" },
  { key: "avg", label: "Durchschnitt", color: "#ec4899", dash: "6 4" },
];
const fmtDay = (d) => d.toLocaleDateString("de-AT", { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit" });

function historyPoints() {
  const entries = (state.history?.entries || []).filter((e) => e[state.fuel]);
  const from = state.days ? Date.now() - state.days * 86400e3 : 0;
  return entries.map((e) => ({ t: new Date(e.t), ...e[state.fuel] })).filter((p) => p.t.getTime() >= from);
}

function renderHistory() {
  const f = CONFIG.fuels[state.fuel];
  $("#history-fuel").textContent = `· ${f.label}`;
  document.querySelectorAll("#history-range button").forEach((b) => {
    b.className = `rounded-full px-3 py-1.5 transition ${Number(b.dataset.days) === state.days ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"}`;
  });
  $("#history-legend").innerHTML = SERIES.map((s) => `<span class="flex items-center gap-2">
    <svg width="22" height="8"><line x1="1" y1="4" x2="21" y2="4" stroke="${s.color}" stroke-width="2" stroke-dasharray="${s.dash}" stroke-linecap="round"/></svg>${s.label}</span>`).join("");

  const box = $("#history-chart");
  const pts = historyPoints();
  if (!pts.length) {
    box.innerHTML = '<p class="py-10 text-center text-sm text-slate-400">Noch keine Verlaufsdaten vorhanden.</p>';
    $("#history-table").innerHTML = "";
    return;
  }

  const W = Math.max(box.clientWidth, 280), H = 220, pad = { l: 50, r: 52, t: 14, b: 26 };
  const t0 = pts[0].t.getTime(), t1 = pts.at(-1).t.getTime();
  const x = (t) => (t1 === t0 ? (pad.l + W - pad.r) / 2 : pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r));
  const vals = pts.flatMap((p) => SERIES.map((s) => p[s.key]));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(hi - lo, 0.02);
  lo -= span * 0.15; hi += span * 0.15;
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);

  const grid = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 4).map((v) =>
    `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.07)"/>
     <text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#94a3b8">${fmtPrice(v)}</text>`).join("");
  const nTicks = Math.min(5, new Set(pts.map((p) => fmtDay(p.t))).size);
  const ticks = Array.from({ length: nTicks }, (_, i) => (nTicks === 1 ? t0 : t0 + ((t1 - t0) * i) / (nTicks - 1))).map((t) =>
    `<text x="${x(t)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#94a3b8">${fmtDay(new Date(t))}</text>`).join("");
  const markers = pts.length <= 20;
  // Endwerte direkt beschriften; liegen sie zu nah beieinander, auseinanderschieben (Durchschnitt ≥ Günstigster → oben).
  const lastPt = pts.at(-1);
  const labelY = Object.fromEntries(SERIES.map((s) => [s.key, y(lastPt[s.key])]));
  const gap = 12 - (labelY.min - labelY.avg);
  if (gap > 0) { labelY.min += gap / 2; labelY.avg -= gap / 2; }
  const lines = SERIES.map((s) => {
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t.getTime()).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join("");
    const last = pts.at(-1);
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-dasharray="${s.dash}" stroke-linejoin="round" stroke-linecap="round"/>
      ${markers ? pts.map((p) => `<circle cx="${x(p.t.getTime())}" cy="${y(p[s.key])}" r="4" fill="${s.color}" stroke="#141b38" stroke-width="2"/>`).join("") : ""}
      <text x="${x(last.t.getTime()) + 8}" y="${labelY[s.key] + 4}" font-size="11" font-weight="600" fill="#e2e8f0">${fmtPrice(last[s.key])}</text>`;
  }).join("");

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Preisverlauf ${f.label}">
      ${grid}${ticks}${lines}
      <g id="hv" visibility="hidden"><line id="hv-line" y1="${pad.t}" y2="${H - pad.b}" stroke="rgba(255,255,255,.35)"/>
        ${SERIES.map((s) => `<circle id="hv-${s.key}" r="5" fill="${s.color}" stroke="#fff" stroke-width="2"/>`).join("")}</g>
      <rect id="hv-hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/></svg>
    <div id="hv-tip" class="pointer-events-none absolute top-2 hidden min-w-[150px] rounded-xl border border-white/10 bg-ink-950/95 px-3 py-2 text-xs shadow-xl"></div>
    ${pts.length < 3 ? `<p class="mt-1 text-center text-xs text-slate-500">Der Verlauf wird seit ${fmtDay(new Date(state.history.entries[0].t))} aufgebaut – bisher ${pts.length} Messung${pts.length === 1 ? "" : "en"}.</p>` : ""}`;

  const svg = box.querySelector("svg"), tip = $("#hv-tip"), hv = svg.querySelector("#hv");
  const names = state.history.stations || {};
  const show = (ev) => {
    const rect = svg.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * W;
    const p = pts.reduce((a, b) => (Math.abs(x(b.t.getTime()) - mx) < Math.abs(x(a.t.getTime()) - mx) ? b : a));
    const px = x(p.t.getTime());
    hv.setAttribute("visibility", "visible");
    svg.querySelector("#hv-line").setAttribute("x1", px); svg.querySelector("#hv-line").setAttribute("x2", px);
    SERIES.forEach((s) => { const c = svg.querySelector(`#hv-${s.key}`); c.setAttribute("cx", px); c.setAttribute("cy", y(p[s.key])); });
    tip.innerHTML = `<p class="mb-1 font-semibold text-white">${fmtTime(p.t)}</p>
      ${SERIES.map((s) => `<p class="flex justify-between gap-4 text-slate-300"><span><span style="color:${s.color}">●</span> ${s.label}</span><span class="tabular-nums text-white">€ ${fmtPrice(p[s.key])}</span></p>`).join("")}
      <p class="flex justify-between gap-4 text-slate-300"><span>Teuerster</span><span class="tabular-nums text-white">€ ${fmtPrice(p.max)}</span></p>
      ${names[p.cheapest] ? `<p class="mt-1 text-slate-400">Günstigste: ${esc(names[p.cheapest])}</p>` : ""}`;
    tip.classList.remove("hidden");
    // Tooltip neben die Linie, bei Platzmangel auf die andere Seite
    const left = (px / W) * rect.width;
    const right = left + 12 + tip.offsetWidth <= rect.width;
    tip.style.left = `${Math.max(right ? left + 12 : left - 12 - tip.offsetWidth, 0)}px`;
  };
  const hide = () => { hv.setAttribute("visibility", "hidden"); tip.classList.add("hidden"); };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", hide);

  $("#history-table").innerHTML = `<table class="w-full text-left tabular-nums">
    <thead class="sticky top-0 bg-ink-900 text-slate-300"><tr><th class="py-1 pr-2">Zeitpunkt</th><th class="pr-2">Günstigster</th><th class="pr-2">Ø</th><th>Teuerster</th></tr></thead>
    <tbody>${[...pts].reverse().map((p) => `<tr class="border-t border-white/5"><td class="py-1 pr-2">${fmtTime(p.t)}</td><td class="pr-2">${fmtPrice(p.min)}</td><td class="pr-2">${fmtPrice(p.avg)}</td><td>${fmtPrice(p.max)}</td></tr>`).join("")}</tbody></table>`;
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
  const times = CONFIG.windows.map((w) => `${fmtHour(w.from)}–${fmtHour(w.to)}`);
  openModal(`
    <p class="text-xs font-semibold uppercase tracking-widest text-cyan-300/80">Info</p>
    <h2 class="mt-1 text-2xl font-extrabold">Über diese Seite</h2>
    <div class="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
      <p>Verglichen werden <strong>Diesel</strong> und <strong>Super 95</strong> der öffentlichen Tankstellen im Umkreis von
      <strong>${esc(CONFIG.location?.name ?? "–")}</strong>. Die Daten stammen aus dem amtlichen
      <a class="underline" href="https://www.spritpreisrechner.at" target="_blank" rel="noopener">Spritpreisrechner der E-Control</a>.</p>
      <p>Die Preise werden automatisch dreimal täglich aktualisiert – je einmal in den Zeitfenstern
      <strong>${times.join(", ")} Uhr</strong> (Vormittag, Mittag, später Nachmittag). In Österreich dürfen Tankstellen ihre Preise nur einmal täglich um 12:00 Uhr erhöhen.</p>
      <p class="text-xs text-slate-500">Hinweis: Die E-Control veröffentlicht je Abfrage nur eine begrenzte Anzahl an Tankstellen.
      Alle Angaben ohne Gewähr.</p>
    </div>`);
}

/* ---------- Events ---------- */

document.querySelectorAll(".fuel-tab").forEach((btn) =>
  btn.addEventListener("click", () => { state.fuel = btn.dataset.fuel; localSet("fuel", state.fuel); render(); }));
$("#btn-sort").addEventListener("click", () => { state.descending = !state.descending; localSet("sortOrder", state.descending ? "desc" : "asc"); render(); });
$("#btn-info").addEventListener("click", infoModal);
$("#list").addEventListener("click", (e) => { const b = e.target.closest(".station"); if (b) stationModal(b.dataset.id); });
$("#history-range").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.days = Number(b.dataset.days); localSet("days", state.days); renderHistory();
});
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderHistory, 150); });
$("#modal-close").addEventListener("click", closeModal);
backdrop.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

renderTabs();
renderSkeleton();
initLocation()
  .then(() => {
    load();
    setInterval(load, CONFIG.pageRefreshMinutes * 60e3);
  })
  .catch((e) => {
    console.error(e);
    render(); // zeigt „Keine Daten verfügbar“
  });
