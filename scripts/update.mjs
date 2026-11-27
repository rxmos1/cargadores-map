// Descarga todos los cargadores de España de OpenStreetMap (Overpass) y los guarda en data/chargers.json
import { writeFileSync, mkdirSync } from "node:fs";

const SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
// Península + Baleares, y Canarias, en cuadrículas de 2x2 grados
const REGIONS = [[35.8, -9.6, 43.9, 4.5], [38.5, 1.0, 40.2, 4.5], [27.5, -18.5, 29.5, -13.3]];
const STEP = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function query(bbox) {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:120];(node["amenity"="charging_station"](${s},${w},${n},${e});way["amenity"="charging_station"](${s},${w},${n},${e}););out center tags;`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = SERVERS[attempt % SERVERS.length];
    try {
      const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(150000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (j.remark && /error|timeout/i.test(j.remark)) throw new Error(j.remark);
      return j.elements || [];
    } catch (err) {
      console.log(`  intento ${attempt + 1} falló en ${new URL(url).host}: ${err.message}`);
      await sleep(5000 * (attempt + 1));
    }
  }
  throw new Error("No se pudo descargar la cuadrícula " + bbox);
}

function kwOf(v) {
  const m = /([\d.,]+)\s*(kw|w)?/i.exec(v || ""); if (!m) return 0;
  let n = parseFloat(m[1].replace(",", ".")); if (!isFinite(n)) return 0;
  const u = (m[2] || "").toLowerCase();
  if (u === "w" || (!u && n > 1000)) n /= 1000;
  return n;
}
function parse(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  let kw = 0, dc = 0;
  for (const k in t) {
    if (/^socket:(ccs|chademo|tesla_supercharger|type1_combo)(:|$)/.test(k) && t[k] !== "0") dc = 1;
    if (/^socket:.*:output$/.test(k)) kw = Math.max(kw, kwOf(t[k]));
  }
  if (!dc && kw >= 40) dc = 1;
  const op = t.operator || t.brand || t.network || "";
  const name = t.name || "";
  const fee = t.fee === "no" ? 0 : t.fee === "yes" ? 1 : -1;
  return [+lat.toFixed(5), +lon.toFixed(5), Math.round(kw * 10) / 10, dc, op, name, fee, t.capacity ? +t.capacity || 0 : 0];
}

const seen = new Map();
for (const [s, w, n, e] of REGIONS) {
  for (let la = s; la < n; la += STEP) for (let lo = w; lo < e; lo += STEP) {
    const bbox = [la, lo, Math.min(la + STEP, n), Math.min(lo + STEP, e)];
    console.log("Cuadrícula", bbox.join(","));
    const els = await query(bbox);
    for (const el of els) { const p = parse(el); if (p) seen.set(el.type + el.id, p); }
    console.log("  total acumulado:", seen.size);
    await sleep(2000);
  }
}
if (seen.size < 5000) { console.error("Demasiado pocos resultados (" + seen.size + "), no se guarda"); process.exit(1); }
mkdirSync("data", { recursive: true });
writeFileSync("data/chargers.json", JSON.stringify({ updated: new Date().toISOString(), n: seen.size, fields: ["lat", "lon", "kw", "dc", "operator", "name", "fee", "capacity"], d: [...seen.values()] }));
console.log("Guardado data/chargers.json con", seen.size, "cargadores");
