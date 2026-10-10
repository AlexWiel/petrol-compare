// Holt die aktuellen Diesel- und Super-95-Preise rund um Klagenfurt Nord
// vom offiziellen E-Control Spritpreisrechner und schreibt sie nach data/prices.json.
// Wird von der GitHub Action (.github/workflows/update-prices.yml) aufgerufen.
// Benötigt Node.js >= 18 (Action nutzt 24) (globales fetch), keine Abhängigkeiten.

import { writeFile, mkdir } from "node:fs/promises";

const LOCATION = { name: "Klagenfurt Nord", latitude: 46.6435, longitude: 14.2985 };
const FUELS = { DIE: "Diesel", SUP: "Super 95" };
const API = "https://api.e-control.at/sprit/1.0/search/gas-stations/by-address";
const OUT = new URL("../data/prices.json", import.meta.url);

async function fetchFuel(fuelType, attempt = 1) {
  const url = `${API}?latitude=${LOCATION.latitude}&longitude=${LOCATION.longitude}&fuelType=${fuelType}&includeClosed=true`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 4) throw err;
    const wait = 2 ** attempt * 1000;
    console.warn(`${fuelType}: ${err.message} – neuer Versuch in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    return fetchFuel(fuelType, attempt + 1);
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

const fuels = {};
for (const fuelType of Object.keys(FUELS)) {
  const stations = await fetchFuel(fuelType);
  fuels[fuelType] = stations.map((s) => normalize(s, fuelType));
  console.log(`${FUELS[fuelType]}: ${fuels[fuelType].length} Tankstellen`);
}

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ updatedAt: new Date().toISOString(), source: "E-Control Spritpreisrechner", location: LOCATION, fuels }, null, 2) + "\n",
);
console.log("data/prices.json geschrieben");
