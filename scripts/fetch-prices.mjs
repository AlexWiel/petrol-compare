// Holt für jeden Standort aus locations.json die aktuellen Diesel- und Super-95-Preise
// vom offiziellen E-Control Spritpreisrechner und schreibt sie nach <dataDir>/prices.json
// sowie den Preisverlauf nach <dataDir>/history.json.
// Wird von der GitHub Action (.github/workflows/update-prices.yml) aufgerufen.
// Benötigt Node.js >= 18 (Action nutzt 24) (globales fetch), keine Abhängigkeiten.

import { readFile, writeFile, mkdir } from "node:fs/promises";

const FUELS = { DIE: "Diesel", SUP: "Super 95" };
const API = "https://api.e-control.at/sprit/1.0/search/gas-stations/by-address";
const ROOT = new URL("../", import.meta.url);

// Abrufzeitfenster in österreichischer Zeit – pro Fenster und Standort höchstens ein Abruf am Tag.
// GitHub startet geplante Läufe oft Stunden zu spät; deshalb läuft die Action stündlich und das
// Skript entscheidet hier selbst, ob im aktuellen Fenster noch abgerufen werden muss.
// Gleiche Fenster stehen in app.js (CONFIG.windows) für die Anzeige.
const WINDOWS = [
  { label: "Vormittag", from: 8, to: 12 },
  { label: "Mittag", from: 12, to: 16 }, // Preiserhöhungen sind in Österreich nur um 12:00 erlaubt
  { label: "Später Nachmittag", from: 16, to: 20 },
];
const FORCE = process.argv.includes("--force"); // manueller Start: immer abrufen
const LOCATIONS = JSON.parse(await readFile(new URL("locations.json", ROOT), "utf8"));

async function fetchFuel(loc, fuelType, attempt = 1) {
  const url = `${API}?latitude=${loc.latitude}&longitude=${loc.longitude}&fuelType=${fuelType}&includeClosed=true`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 4) throw err;
    const wait = 2 ** attempt * 1000;
    console.warn(`${fuelType}: ${err.message} – neuer Versuch in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    return fetchFuel(loc, fuelType, attempt + 1);
  }
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
    openingHours: (station.openingHours || []).map((h) => ({
      label: h.label, from: h.from, to: h.to, order: h.order,
    })),
    telephone: station.contact?.telephone ?? null,
    website: station.contact?.website ?? null,
  };
}

// Optional nur Tankstellen mit bestimmten Postleitzahlen (locations.json → postalCodes), z. B. nur 5580 Tamsweg.
const inArea = (loc, station) => !loc.postalCodes || loc.postalCodes.includes(String(station.postalCode).trim());

async function updateLocation(loc) {
  const fuels = {};
  const postalById = {}; // alle gelieferten Tankstellen, auch gefilterte – für die Bereinigung des Verlaufs
  for (const fuelType of Object.keys(FUELS)) {
    const stations = (await fetchFuel(loc, fuelType)).map((s) => normalize(s, fuelType));
    for (const s of stations) postalById[s.id] = String(s.postalCode).trim();
    fuels[fuelType] = stations.filter((s) => inArea(loc, s));
    console.log(`${loc.name} – ${FUELS[fuelType]}: ${fuels[fuelType].length} von ${stations.length} Tankstellen`);
  }

  const dir = new URL(`${loc.dataDir}/`, ROOT);
  const location = { name: loc.name, latitude: loc.latitude, longitude: loc.longitude, postalCodes: loc.postalCodes ?? null };
  const updatedAt = new Date().toISOString();
  await mkdir(dir, { recursive: true });
  await writeFile(
    new URL("prices.json", dir),
    JSON.stringify({ updatedAt, source: "E-Control Spritpreisrechner", location, fuels }, null, 2) + "\n",
  );
  console.log(`${loc.dataDir}/prices.json geschrieben`);

  // Preisverlauf: pro Abruf ein Eintrag mit Min/Ø/Max und den Einzelpreisen je Tankstelle.
  const historyFile = new URL("history.json", dir);
  let history = { location: loc.name, stations: {}, entries: [] };
  try {
    history = JSON.parse(await readFile(historyFile, "utf8"));
  } catch {
    console.log(`${loc.dataDir}/history.json existiert noch nicht – wird angelegt`);
  }
  refilterHistory(history, loc, postalById);
  await writeFile(historyFile, JSON.stringify(appendHistory(history, updatedAt, fuels)) + "\n");
  console.log(`${loc.dataDir}/history.json: ${history.entries.length} Einträge`);
}

// Wurde der PLZ-Filter eines Standorts geändert, ältere Verlaufseinträge einmalig neu berechnen:
// nur Preise von Tankstellen behalten, deren PLZ bekannt ist und passt.
function refilterHistory(history, loc, postalById) {
  const key = loc.postalCodes ? loc.postalCodes.join(",") : null;
  if ((history.postalCodes ?? null) === key) return;
  history.postalCodes = key;
  if (!key) return;
  for (const entry of history.entries) {
    for (const fuelType of Object.keys(FUELS)) {
      const old = entry[fuelType];
      if (!old) continue;
      const prices = Object.entries(old.prices).filter(([id]) => loc.postalCodes.includes(postalById[id]));
      if (!prices.length) { delete entry[fuelType]; continue; }
      const values = prices.map(([, p]) => p);
      const min = Math.min(...values);
      entry[fuelType] = {
        min,
        avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000,
        max: Math.max(...values),
        cheapest: Number(prices.find(([, p]) => p === min)[0]),
        prices: Object.fromEntries(prices),
      };
    }
  }
  console.log(`${loc.name}: Verlauf auf PLZ ${key} neu berechnet`);
}

// Liefert z. B. "2026-10-17#1" für das Mittagsfenster am 17.10. (Wiener Zeit), außerhalb aller Fenster null.
function slotOf(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  const i = WINDOWS.findIndex((w) => hour >= w.from && hour < w.to);
  return i < 0 ? null : `${parts.year}-${parts.month}-${parts.day}#${i}`;
}

async function lastFetch(loc) {
  try {
    const history = JSON.parse(await readFile(new URL(`${loc.dataDir}/history.json`, ROOT), "utf8"));
    const last = history.entries.at(-1);
    return last ? new Date(last.t) : null;
  } catch {
    return null;
  }
}

const now = new Date();
const slot = slotOf(now);
if (!FORCE && !slot) console.log("Außerhalb der Abrufzeitfenster – nichts zu tun.");

// Ein fehlgeschlagener Standort hält die anderen nicht auf; die Action wird trotzdem rot.
let failed = 0;
for (const loc of LOCATIONS) {
  if (!FORCE) {
    if (!slot) break;
    const last = await lastFetch(loc);
    if (last && slotOf(last) === slot) {
      console.log(`${loc.name}: im Fenster „${WINDOWS[slot.split("#")[1]].label}“ schon abgerufen – übersprungen.`);
      continue;
    }
  }
  try {
    await updateLocation(loc);
  } catch (err) {
    failed++;
    console.error(`${loc.name}: Abruf fehlgeschlagen – ${err.message}`);
  }
}
if (failed) process.exitCode = 1;

export function appendHistory(history, t, fuels) {
  const entry = { t };
  for (const [fuelType, stations] of Object.entries(fuels)) {
    const priced = stations.filter((s) => typeof s.price === "number");
    if (!priced.length) continue;
    const values = priced.map((s) => s.price);
    const cheapest = priced.reduce((a, b) => (b.price < a.price ? b : a));
    entry[fuelType] = {
      min: Math.min(...values),
      avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000,
      max: Math.max(...values),
      cheapest: cheapest.id,
      prices: Object.fromEntries(priced.map((s) => [s.id, s.price])),
    };
    for (const s of stations) history.stations[s.id] = s.name;
  }
  // Mehrere Abrufe innerhalb von 30 Minuten (z. B. manueller Start) ersetzen den letzten Eintrag.
  const last = history.entries.at(-1);
  if (last && new Date(t) - new Date(last.t) < 30 * 60e3) history.entries.pop();
  history.entries.push(entry);
  return history;
}
