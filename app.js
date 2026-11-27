"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };

// Mapa con teselas oscuras de CARTO (datos © OpenStreetMap)
const map = L.map("map", { zoomControl: false, preferCanvas: true }).setView([41.5463, 2.1086], 11);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 18, attribution: "Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors" }).addTo(map);
L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 18 }).addTo(map);
const cluster = L.markerClusterGroup({
  chunkedLoading: true, maxClusterRadius: 55, disableClusteringAtZoom: 15, showCoverageOnHover: false,
  iconCreateFunction: (c) => { const n = c.getChildCount(), s = n < 100 ? 34 : n < 1000 ? 42 : 50; return L.divIcon({ html: "<div class='cl' style='width:" + s + "px;height:" + s + "px;line-height:" + (s - 4) + "px'>" + n + "</div>", className: "", iconSize: [s, s] }); },
});
map.addLayer(cluster);

let DATA = [], rules = [], origin = null, youMarker = null, filter = "", sel = null, updated = "";
const nm = (p) => { const n = p[0 + 5]; return n && !/^[\d*_.-]{6,}$/.test(n) ? n : (p[4] || "Punto de recarga") + (p[8] ? " · " + p[8] : ""); };
const F = { lat: 0, lon: 1, kw: 2, dc: 3, op: 4, name: 5, fee: 6 };

// ---------- Precios ----------
const findRule = (t) => rules.find((r) => new RegExp(r.match).test(t.toLowerCase()));
function basePrice(rule, dc) {
  if (!rule) return null;
  if (dc && rule.schedule) { const h = new Date().getHours(); const s = rule.schedule.find((x) => h >= x[0] && h < x[1]); if (s) return s[2]; }
  const p = dc ? rule.dc : rule.ac; return typeof p === "number" ? p : null;
}
function memberPrice(rule, base) {
  if (!rule || !rule.sub || base == null) return base;
  const s = rule.sub;
  if (typeof s.fixed === "number") return Math.min(base, s.fixed);
  if (typeof s.pctOff === "number") return base * (1 - s.pctOff / 100);
  if (typeof s.eurOff === "number") return Math.max(0, base - s.eurOff);
  return base;
}
const eur = (x, d = 2) => x.toFixed(d).replace(".", ",") + " €";
function fmtTime(h) { const m = Math.round(h * 60); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min"; }

function car() {
  const batt = +$("batt").value || 60, from = +$("from").value || 0, to = Math.max(from, +$("to").value || 80);
  const kwh = batt * (to - from) / 100, k80 = batt * Math.max(0, Math.min(to, 80) - from) / 100;
  return { kwh, k80, kAbove: Math.max(0, kwh - k80), acmax: +$("acmax").value || 11, member: $("member").checked };
}
function enrich(p, c) {
  const dc = !!p[F.dc], kw = p[F.kw] || (dc ? 50 : 7);
  const rule = findRule(p[F.op] + " " + p[F.name]);
  let price = p[F.fee] === 0 ? 0 : basePrice(rule, dc);
  if (c.member && price) price = memberPrice(rule, price);
  const hours = dc ? c.k80 / Math.min(kw, 110) + c.kAbove / Math.min(kw, 25) : c.kwh / Math.min(kw, c.acmax);
  return { p, dc, kw, rule, price, hours, cost: price != null ? price * c.kwh : null };
}
const passes = (p) => {
  if (filter === "DC") return !!p[F.dc];
  if (filter === "AC") return !p[F.dc];
  if (filter === "150") return p[F.kw] >= 150;
  if (filter === "priced") return p[F.fee] === 0 || !!findRule(p[F.op] + " " + p[F.name]);
  return true;
};

// ---------- Marcadores (todos los filtrados, agrupados) ----------
function buildMarkers() {
  cluster.clearLayers();
  const ms = [];
  for (const p of DATA) {
    if (!passes(p)) continue;
    const dc = !!p[F.dc];
    const m = L.circleMarker([p[F.lat], p[F.lon]], { radius: 6, color: "#111", weight: 1, fillColor: dc ? "#e82127" : "#f2f3f5", fillOpacity: 0.95 });
    m.on("click", () => select(p));
    ms.push(m);
  }
  cluster.addLayers(ms);
  refresh();
}

// ---------- Lista y estadísticas de la zona visible ----------
function dist(a, b) { const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r; const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); }
function refresh() {
  const c = car(), b = map.getBounds(), cen = origin || [map.getCenter().lat, map.getCenter().lng];
  const rows = [];
  for (const p of DATA) {
    if (!b.contains([p[F.lat], p[F.lon]]) || !passes(p)) continue;
    const e = enrich(p, c); e.d = dist(cen, [p[F.lat], p[F.lon]]); rows.push(e);
  }
  rows.sort((a, b) => a.d - b.d);
  const priced = rows.filter((r) => r.price != null && r.price > 0);
  $("s-n").textContent = rows.length;
  $("s-p").textContent = priced.length ? eur(Math.min(...priced.map((r) => r.price))) : "–";
  $("s-t").textContent = c.kwh.toFixed(0) + " kWh";
  $("status").textContent = map.getZoom() < 9 ? "Acerca el mapa para ver la lista." : "";
  $("list").innerHTML = "";
  if (map.getZoom() < 9) return;
  rows.slice(0, 50).forEach((r) => {
    const li = document.createElement("li");
    li.innerHTML = '<div><div class="nm"><span class="dot ' + (r.dc ? "dc" : "") + '"></span>' + esc(nm(r.p)) + '</div><div class="sub">' + esc(r.p[F.op] || "Operador desconocido") + " · " + (r.p[8] ? esc(r.p[8]) + " · " : "") + r.d.toFixed(1) + " km · " + r.kw + " kW " + (r.dc ? "DC" : "AC") + '</div></div>' +
      '<div class="pr">' + (r.price != null ? '<b class="ok">' + (r.price === 0 ? "Gratis" : eur(r.price) + "/kWh") + "</b><div class='sub'>" + (r.cost ? eur(r.cost, 1) + " · " : "") + fmtTime(r.hours) + "</div>" : '<div class="na">sin precio</div><div class="sub">' + fmtTime(r.hours) + "</div>") + "</div>";
    li.addEventListener("click", () => { map.setView([r.p[F.lat], r.p[F.lon]], Math.max(map.getZoom(), 16)); select(r.p); });
    $("list").appendChild(li);
  });
}

function select(p) {
  sel = p; const c = car(), e = enrich(p, c);
  const card = $("card"); card.hidden = false;
  const noteBase = e.rule && e.rule.sub ? "Suscripción: " + e.rule.sub.name : "";
  card.innerHTML = '<button class="x" aria-label="Cerrar">×</button><h3>' + esc(nm(p)) + '</h3><div class="sub">' + esc(p[F.op] || "Operador desconocido") + "</div>" +
    '<div class="big ' + (e.price != null ? "ok" : "") + '">' + (e.price == null ? "Sin precio" : e.price === 0 ? "Gratis" : eur(e.price) + '<small style="font-size:14px;color:var(--mut)"> /kWh</small>') + "</div>" +
    '<div class="grid"><div><span>Potencia</span>' + e.kw + " kW " + (e.dc ? "DC" : "AC") + "</div><div><span>Tiempo estimado</span>" + fmtTime(e.hours) + "</div>" +
    "<div><span>Coste de tu carga</span>" + (e.cost != null ? eur(e.cost, 2) : "—") + "</div><div><span>Km que añades</span>~" + Math.round(c.kwh / 0.16) + " km</div></div>" +
    (e.rule && e.rule.note ? '<p class="sub">' + esc(e.rule.note) + "</p>" : "") + (noteBase ? '<p class="sub">' + esc(noteBase) + "</p>" : "") +
    (e.price == null ? '<p class="sub">No tengo el precio de este operador. Mira su app (Reve/operador).</p>' : "") +
    '<a class="go" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + p[F.lat] + "," + p[F.lon] + '">Cómo llegar</a>';
  card.querySelector(".x").onclick = () => { card.hidden = true; sel = null; };
}

// ---------- Datos ----------
async function loadData() {
  $("status").textContent = "Cargando cargadores de España…";
  try {
    const j = await fetch("data/chargers.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    DATA = j.d; updated = j.updated;
    $("foot").textContent = DATA.length.toLocaleString("es") + " puntos oficiales (MITECO / DGT, CC-BY) · actualizado " + new Date(updated).toLocaleDateString("es") + ". Los precios solo salen donde los conozco; el precio oficial en tiempo real está en mapareve.es.";
    buildMarkers();
  } catch (e) {
    $("status").textContent = "Aún no hay datos descargados (data/chargers.json). Ejecuta la acción «Actualizar cargadores» en GitHub.";
  }
}
fetch("prices.json").then((r) => r.json()).then((j) => { rules = j.rules || []; if (DATA.length) buildMarkers(); }).catch(() => {});
loadData();

// ---------- Controles ----------
let t = null; map.on("moveend", () => { clearTimeout(t); t = setTimeout(refresh, 150); });
map.on("dragstart", () => { origin = null; });
$("chips").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; filter = b.dataset.t; [...$("chips").children].forEach((x) => x.classList.toggle("on", x === b)); buildMarkers(); });
["batt", "from", "to", "member", "acmax"].forEach((id) => $(id).addEventListener("input", () => { refresh(); if (sel) select(sel); }));
$("locate").addEventListener("click", () => {
  if (!navigator.geolocation) { $("status").textContent = "Tu navegador no permite geolocalización."; return; }
  $("status").textContent = "Buscando tu ubicación…";
  navigator.geolocation.getCurrentPosition((pos) => {
    origin = [pos.coords.latitude, pos.coords.longitude];
    if (youMarker) map.removeLayer(youMarker);
    youMarker = L.circleMarker(origin, { radius: 9, color: "#fff", weight: 3, fillColor: "#3b82f6", fillOpacity: 1 }).addTo(map);
    map.setView(origin, 13);
  }, (e) => { $("status").textContent = "No se pudo obtener la ubicación: " + e.message; }, { enableHighAccuracy: true, timeout: 15000 });
});
async function search() {
  const q = $("q").value.trim(); if (!q) return;
  try {
    const j = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=es&q=" + encodeURIComponent(q)).then((r) => r.json());
    if (!j.length) { $("status").textContent = "No encontré ese lugar."; return; }
    origin = null; map.setView([+j[0].lat, +j[0].lon], 13);
  } catch (e) { $("status").textContent = "Error en la búsqueda."; }
}
$("go").addEventListener("click", search);
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });

function route() {
  const h = location.hash.slice(1) || "mapa";
  const isMap = h === "mapa";
  $("panel").hidden = !isMap; if (!isMap) $("card").hidden = true;
  $("frame").hidden = isMap;
  ["mapa", "coches", "guia"].forEach((n) => { $("n-" + n).className = n === h ? "on" : ""; });
  if (h === "coches") $("frame").src = "guia/index.html#coches";
  else if (h === "guia") $("frame").src = "guia/index.html#cargadores";
  else setTimeout(() => map.invalidateSize(), 50);
}
window.addEventListener("hashchange", route); route();
