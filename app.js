"use strict";
const $ = (id) => document.getElementById(id);
const map = L.map("map").setView([41.5463, 2.1086], 12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
const layer = L.layerGroup().addTo(map);
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
let reqId = 0;
let youMarker = null, rules = [], ctrl = null, timer = null, lastData = [], origin = null;

fetch("prices.json").then((r) => r.json()).then((j) => { rules = j.rules || []; if (lastData.length) render(); }).catch(() => {});

const esc = (s) => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };
const findRule = (t) => rules.find((r) => new RegExp(r.match).test(t.toLowerCase()));
function basePrice(rule, dc) {
  if (!rule) return null;
  if (dc && rule.schedule) { const h = new Date().getHours(); const s = rule.schedule.find((x) => h >= x[0] && h < x[1]); if (s) return s[2]; }
  const p = dc ? rule.dc : rule.ac;
  return typeof p === "number" ? p : null;
}
function memberPrice(rule, base) {
  if (!rule || !rule.sub || base == null) return base;
  const s = rule.sub;
  if (typeof s.fixed === "number") return Math.min(base, s.fixed);
  if (typeof s.pctOff === "number") return base * (1 - s.pctOff / 100);
  if (typeof s.eurOff === "number") return Math.max(0, base - s.eurOff);
  return base;
}
function fmtTime(h) { const m = Math.round(h * 60); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min"; }

function parseKw(v) {
  const m = /([\d.,]+)\s*(kw|w)?/i.exec(v || ""); if (!m) return 0;
  let n = parseFloat(m[1].replace(",", ".")); if (!isFinite(n)) return 0;
  const u = (m[2] || "").toLowerCase();
  if (u === "w" || (!u && n > 1000)) n /= 1000;
  return n;
}
function info(el) {
  const t = el.tags || {}; let kw = 0, dc = false;
  for (const k in t) {
    if (/^socket:(ccs|chademo|tesla_supercharger|type1_combo)(:|$)/.test(k)) dc = true;
    if (/^socket:.*:output$/.test(k)) kw = Math.max(kw, parseKw(t[k]));
  }
  if (!kw && t.capacity) kw = 0;
  if (!dc && kw >= 40) dc = true;
  return { kw, dc, op: t.operator || t.brand || t.network || "", name: t.name || t.operator || t.brand || "Cargador", fee: t.fee, charge: t.charge };
}
function dist(a, b) { const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); }

async function load() {
  if (map.getZoom() < 10) { layer.clearLayers(); $("list").innerHTML = ""; $("status").textContent = "Acerca el zoom (10 o más) para ver los cargadores."; return; }
  const b = map.getBounds();
  const q = `[out:json][timeout:25];(node["amenity"="charging_station"](${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()});way["amenity"="charging_station"](${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}););out center 1500;`;
  const id = ++reqId;
  if (ctrl) ctrl.abort();
  $("status").textContent = "Buscando cargadores…";
  let ok = false, lastErr = "";
  for (const u of OVERPASS) {
    ctrl = new AbortController();
    const mine = ctrl, to = setTimeout(() => mine.abort(), 20000);
    try {
      const r = await fetch(u, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: mine.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      lastData = (await r.json()).elements || []; ok = true; clearTimeout(to); break;
    } catch (e) {
      clearTimeout(to);
      if (id !== reqId) return;
      lastErr = e.name === "AbortError" ? "tiempo agotado" : e.message;
    }
  }
  if (id !== reqId) return;
  if (!ok) { $("status").textContent = "Los servidores de OpenStreetMap están saturados (" + lastErr + "). Mueve el mapa para reintentar."; return; }
  render();
}

function render() {
  layer.clearLayers(); $("list").innerHTML = "";
  const minkw = +$("minkw").value || 0, want = $("ctype").value, useM = $("member").checked;
  const batt = +$("batt").value || 60, from = +$("from").value || 0, to = Math.max(from, +$("to").value || 80);
  const kwh = batt * (to - from) / 100, k80 = batt * Math.max(0, Math.min(to, 80) - from) / 100, kAbove = Math.max(0, kwh - k80);
  const c = origin || [map.getCenter().lat, map.getCenter().lng];
  const rows = [];
  for (const el of lastData) {
    const pos = el.type === "node" ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon] : null; if (!pos) continue;
    const i = info(el);
    if (i.kw < minkw) continue;
    if (want === "DC" && !i.dc) continue;
    if (want === "AC" && i.dc) continue;
    const rule = findRule([i.op, i.name].join(" "));
    let p = basePrice(rule, i.dc); if (useM) p = memberPrice(rule, p);
    const eff = i.kw || (i.dc ? 50 : 7);
    const hours = i.dc ? k80 / Math.min(eff, 110) + kAbove / Math.min(eff, 25) : kwh / Math.min(eff, 11);
    rows.push({ pos, i, rule, p, hours, d: dist(c, pos) });
  }
  rows.sort((a, b) => a.d - b.d);
  $("status").textContent = rows.length + " cargadores en esta zona · carga de " + kwh.toFixed(0) + " kWh";
  rows.forEach((r, n) => {
    const col = r.i.dc ? "#d33" : "#27a";
    const priceTxt = r.p != null ? r.p.toFixed(2) + " €/kWh · " + (r.p * kwh).toFixed(2) + " € la carga" : "sin precio: mira la app del operador";
    const pop = "<b>" + esc(r.i.name) + "</b><br>" + esc(r.i.op) + "<br>" + (r.i.kw ? r.i.kw + " kW " : "") + (r.i.dc ? "DC" : "AC") + "<br>" + esc(priceTxt) +
      '<br><a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + r.pos[0] + "," + r.pos[1] + '">Cómo llegar</a>';
    const m = L.circleMarker(r.pos, { radius: 7, color: col, fillColor: col, fillOpacity: 0.75 }).addTo(layer).bindPopup(pop);
    if (n < 60) {
      const li = document.createElement("li");
      li.innerHTML = '<div class="t">' + esc(r.i.name) + '</div><div class="m">' + esc(r.i.op || "operador desconocido") + " · " + r.d.toFixed(1) + " km</div>" +
        '<div class="m">' + (r.i.kw ? r.i.kw + " kW " : "") + (r.i.dc ? "DC" : "AC") + " · ~" + fmtTime(r.hours) + "</div>" +
        (r.p != null ? '<div class="price">' + esc(priceTxt) + "</div>" : '<div class="m warn">' + esc(priceTxt) + "</div>") +
        (r.rule && r.rule.note ? '<div class="m">' + esc(r.rule.note) + "</div>" : "");
      li.addEventListener("click", () => { map.setView(r.pos, 16); m.openPopup(); });
      $("list").appendChild(li);
    }
  });
}

map.on("moveend", () => { clearTimeout(timer); timer = setTimeout(load, 600); });
["ctype", "minkw", "member", "batt", "from", "to"].forEach((id) => $(id).addEventListener("input", render));

$("locate").addEventListener("click", () => {
  if (!navigator.geolocation) { $("status").textContent = "Tu navegador no permite geolocalización."; return; }
  $("status").textContent = "Obteniendo tu ubicación…";
  navigator.geolocation.getCurrentPosition((p) => {
    origin = [p.coords.latitude, p.coords.longitude];
    if (youMarker) map.removeLayer(youMarker);
    youMarker = L.circleMarker(origin, { radius: 9, color: "#0a7", fillColor: "#0a7", fillOpacity: 0.9 }).addTo(map).bindPopup("Tú");
    map.setView(origin, 13);
  }, (e) => { $("status").textContent = "No se pudo obtener la ubicación: " + e.message; }, { enableHighAccuracy: true, timeout: 15000 });
});
map.on("dragstart", () => { origin = null; });

async function search() {
  const q = $("q").value.trim(); if (!q) return;
  try {
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=es&q=" + encodeURIComponent(q));
    const j = await r.json();
    if (!j.length) { $("status").textContent = "No encontré ese lugar."; return; }
    origin = null; map.setView([+j[0].lat, +j[0].lon], 13);
  } catch (e) { $("status").textContent = "Error en la búsqueda."; }
}
$("go").addEventListener("click", search);
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });

function route() {
  const h = location.hash.slice(1) || "mapa";
  $("app").hidden = h !== "mapa";
  $("frame").hidden = h === "mapa";
  ["mapa", "coches", "guia"].forEach((n) => { $("n-" + n).className = n === h ? "on" : ""; });
  if (h === "coches") $("frame").src = "guia/index.html#coches";
  else if (h === "guia") $("frame").src = "guia/index.html#cargadores";
  else setTimeout(() => map.invalidateSize(), 50);
}
window.addEventListener("hashchange", route);
route(); load();
