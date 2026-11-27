// Descarga el listado oficial de puntos de recarga (MITECO/DGT, Punto de Acceso Nacional, DATEX II, CC-BY)
// y lo convierte a data/chargers.json (compacto) para la web.
import { writeFileSync, mkdirSync } from "node:fs";

const URL = "https://nap.dgt.es/datex2/v3/miterd/EnergyInfrastructureTablePublication/electrolineras.xml";
const UA = "cargadores-map/1.0 (https://github.com/rxmos1/cargadores-map)";

let xml;
for (let i = 1; i <= 5; i++) {
  try {
    const r = await fetch(URL, { headers: { "User-Agent": UA, Accept: "application/xml" }, signal: AbortSignal.timeout(300000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    xml = await r.text();
    break;
  } catch (e) {
    console.log(`intento ${i} falló: ${e.message}`);
    await new Promise((r) => setTimeout(r, 10000 * i));
  }
}
if (!xml) { console.error("No se pudo descargar el XML del NAP"); process.exit(1); }
console.log("XML descargado:", (xml.length / 1e6).toFixed(1), "MB");

const first = (s, re) => { const m = re.exec(s); return m ? m[1].trim() : ""; };
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

const parts = xml.split("<egi:energyInfrastructureSite ").slice(1);
const out = [], ALL = {};
for (const s of parts) {
  const lat = parseFloat(first(s, /<loc:latitude>([^<]+)</)), lon = parseFloat(first(s, /<loc:longitude>([^<]+)</));
  if (!isFinite(lat) || !isFinite(lon)) continue;
  const name = decode(first(s, /<fac:name>\s*<com:values>\s*<com:value[^>]*>([^<]*)</));
  const opBlock = first(s, /(<fac:operator[\s\S]*?<\/fac:operator>)/);
  const op = decode(first(opBlock, /<com:value(?:\s[^>]*)?>([^<]*)</));
  const town = decode(first(s, /Municipio:\s*([^<]*)</));
  let kw = 0, dc = 0, pts = 0; const ct = {};
  const points = s.split("<egi:refillPoint ").slice(1);
  pts = points.length;
  for (const pnt of points) {
    for (const c of pnt.split("<egi:connector>").slice(1)) {
      const w = parseFloat(first(c, /<egi:maxPowerAtSocket>([^<]+)</)) / 1000;
      if (isFinite(w)) kw = Math.max(kw, w);
      const type = first(c, /<egi:connectorType>([^<]+)</), mode = first(c, /<egi:chargingMode>([^<]+)</);
      { const k = type || "?"; ct[k] = ct[k] || [0, 0]; ct[k][0] = Math.max(ct[k][0], isFinite(w) ? w : 0); ct[k][1]++; ALL[k] = (ALL[k] || 0) + 1; }
      if (/mode4DC/i.test(mode) || /COMBO|chademo/i.test(type)) dc = 1;
    }
  }
  if (!dc && kw >= 40) dc = 1;
  out.push([+lat.toFixed(5), +lon.toFixed(5), Math.round(kw * 10) / 10, dc, op, name, -1, pts, town, Object.entries(ct).map(([k, v]) => k + ":" + Math.round(v[0]) + ":" + v[1]).join(",")]);
}
console.log("Puntos válidos:", out.length);
console.log("Tipos de conector:", JSON.stringify(ALL));
if (out.length < 5000) { console.error("Demasiado pocos resultados, no se guarda"); process.exit(1); }
mkdirSync("data", { recursive: true });
writeFileSync("data/chargers.json", JSON.stringify({
  updated: new Date().toISOString(), n: out.length,
  source: "MITECO / DGT Punto de Acceso Nacional (CC-BY)",
  fields: ["lat", "lon", "kw", "dc", "operator", "name", "fee", "points", "town", "conn"], d: out,
}));
console.log("Guardado data/chargers.json");
