"use strict";

const CENTER = [41.5463, 2.1086]; // Sabadell
const map = L.map("map").setView(CENTER, 12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);
const layer = L.layerGroup().addTo(map);
let origin = CENTER.slice();
let youMarker = null;

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};
$("key").value = store.get("ocmKey") || "";

let rules = [];
fetch("prices.json").then((r) => r.json()).then((j) => { rules = j.rules || []; }).catch(() => {});

function findRule(text) {
  const t = text.toLowerCase();
  return rules.find((r) => new RegExp(r.match).test(t));
}

// Precio base €/kWh para el tipo de carga y la hora actual.
function basePrice(rule, isDC) {
  if (!rule) return null;
  if (isDC && rule.schedule) {
    const h = new Date().getHours();
    const s = rule.schedule.find((x) => h >= x[0] && h < x[1]);
    if (s) return s[2];
  }
  const p = isDC ? rule.dc : rule.ac;
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

// Tiempo estimado en horas. AC: limitado por el coche (11 kW). DC: media 10-80 % hasta 110 kW, resto a 25 kW.
function estimateHours(kwh, kwLow, kwhAbove80, isDC, stationKW) {
  if (!isDC) return kwh / Math.min(stationKW, 11);
  const fast = Math.min(stationKW, 110);
  return kwLow / fast + kwhAbove80 / Math.min(stationKW, 25);
}

function fmtTime(h) {
  const m = Math.round(h * 60);
  return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min";
}

function bestConn(poi) {
  const conns = poi.Connections || [];
  let best = null;
  for (const c of conns) {
    const kw = c.PowerKW || 0;
    if (!best || kw > best.kw) best = { kw, dc: c.CurrentTypeID === 30, type: (c.ConnectionType && c.ConnectionType.Title) || "" };
  }
  return best;
}

function parseCost(s) {
  const m = /(\d+[.,]\d+)\s*(?:€|eur)/i.exec(s || "");
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

async function load() {
  const key = $("key").value.trim();
  if (!key) { $("status").textContent = "Falta la clave de Open Charge Map (gratis en openchargemap.org)."; return; }
  store.set("ocmKey", key);
  const radius = Math.min(50, Math.max(1, +$("radius").value || 15));
  const url = "https://api.openchargemap.io/v3/poi/?output=json&countrycode=ES&maxresults=400&compact=false&verbose=false" +
    "&latitude=" + origin[0] + "&longitude=" + origin[1] + "&distance=" + radius + "&distanceunit=KM&key=" + encodeURIComponent(key);
  $("status").textContent = "Buscando…";
  let data;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    data = await r.json();
  } catch (e) {
    $("status").textContent = "Error al consultar Open Charge Map: " + e.message;
    return;
  }
  render(data);
}

function render(data) {
  layer.clearLayers();
  $("list").innerHTML = "";
  const minkw = +$("minkw").value || 0;
  const want = $("ctype").value;
  const useMember = $("member").checked;
  const batt = +$("batt").value || 60;
  const from = +$("from").value || 0;
  const to = Math.max(from, +$("to").value || 80);
  const kwhTotal = batt * (to - from) / 100;
  const kwhTo80 = batt * Math.max(0, Math.min(to, 80) - from) / 100;
  const kwhAbove80 = Math.max(0, kwhTotal - kwhTo80);

  const rows = [];
  for (const poi of data) {
    const a = poi.AddressInfo || {};
    const b = bestConn(poi);
    if (!b || b.kw < minkw) continue;
    if (want === "DC" && !b.dc) continue;
    if (want === "AC" && b.dc) continue;
    const op = (poi.OperatorInfo && poi.OperatorInfo.Title) || "";
    const text = [op, a.Title, a.AddressLine1].join(" ");
    const rule = findRule(text);
    let price = basePrice(rule, b.dc);
    let src = price != null ? "mis datos" : null;
    if (price == null) { price = parseCost(poi.UsageCost); if (price != null) src = "Open Charge Map"; }
    const p = useMember ? memberPrice(rule, price) : price;
    const hours = estimateHours(kwhTotal, kwhTo80, kwhAbove80, b.dc, b.kw || 7);
    rows.push({ poi, a, b, op, rule, price: p, src, hours, cost: p != null ? p * kwhTotal : null });
  }
  rows.sort((x, y) => (x.a.Distance || 0) - (y.a.Distance || 0));

  $("status").textContent = rows.length + " cargadores · carga de " + kwhTotal.toFixed(0) + " kWh";
  for (const r of rows) {
    const color = r.b.dc ? "#d33" : "#27a";
    const m = L.circleMarker([r.a.Latitude, r.a.Longitude], { radius: 8, color, fillColor: color, fillOpacity: 0.7 }).addTo(layer);
    const priceTxt = r.price != null ? r.price.toFixed(2) + " €/kWh" : "sin precio";
    m.bindPopup("<b>" + esc(r.a.Title) + "</b><br>" + esc(r.op) + "<br>" + r.b.kw + " kW " + (r.b.dc ? "DC" : "AC") + "<br>" + esc(priceTxt));

    const li = document.createElement("li");
    li.innerHTML =
      '<div class="t">' + esc(r.a.Title) + "</div>" +
      '<div class="m">' + esc(r.op || "operador desconocido") + " · " + esc(r.a.AddressLine1 || "") + " · " + (r.a.Distance != null ? r.a.Distance.toFixed(1) + " km" : "") + "</div>" +
      '<div class="m">' + r.b.kw + " kW " + (r.b.dc ? "DC" : "AC") + " · ~" + fmtTime(r.hours) + "</div>" +
      (r.price != null
        ? '<div class="price">' + r.price.toFixed(2) + " €/kWh · " + r.cost.toFixed(2) + " € la carga</div>"
        : '<div class="m warn">Sin precio: míralo en la app del operador</div>') +
      (r.rule && r.rule.note ? '<div class="m">' + esc(r.rule.note) + "</div>" : "");
    li.addEventListener("click", () => { map.setView([r.a.Latitude, r.a.Longitude], 15); m.openPopup(); });
    $("list").appendChild(li);
  }
  if (rows.length) {
    map.fitBounds(L.latLngBounds(rows.map((r) => [r.a.Latitude, r.a.Longitude])).pad(0.1));
  }
}

$("load").addEventListener("click", load);

// Usa tu ubicación actual como centro de la búsqueda (pide permiso al navegador).
$("locate").addEventListener("click", () => {
  if (!navigator.geolocation) { $("status").textContent = "Tu navegador no permite geolocalización."; return; }
  $("status").textContent = "Obteniendo tu ubicación…";
  navigator.geolocation.getCurrentPosition((pos) => {
    origin = [pos.coords.latitude, pos.coords.longitude];
    if (youMarker) map.removeLayer(youMarker);
    youMarker = L.circleMarker(origin, { radius: 9, color: "#0a7", fillColor: "#0a7", fillOpacity: 0.9 }).addTo(map).bindPopup("Tú");
    map.setView(origin, 13);
    load();
  }, (err) => { $("status").textContent = "No se pudo obtener la ubicación: " + err.message; }, { enableHighAccuracy: true, timeout: 15000 });
});
