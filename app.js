"use strict";
const $ = (id) => document.getElementById(id);
if (typeof L === "undefined" || !L.markerClusterGroup) { const b = document.getElementById("boot"); b.className = "err"; b.textContent = "No se pudo cargar el mapa (librería bloqueada). Desactiva los escudos de Brave/bloqueador para este sitio y recarga."; throw new Error("leaflet"); }
const esc = (s) => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };

const map = L.map("map", { zoomControl: false, preferCanvas: true }).setView([41.5463, 2.1086], 11);
L.control.zoom({ position: "bottomright" }).addTo(map);
let tileErr = 0;
const base = L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 19, attribution: "Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors" });
const dark = L.layerGroup([base, L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 19 })]).addTo(map);
const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" });
const sat = L.layerGroup([L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 19, maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" }), L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 19 })]);
L.control.layers({ Oscuro: dark, Calles: osm, "Satélite": sat }, null, { position: "topright" }).addTo(map);
// Si el mapa base falla (bloqueador, red), cambia a OpenStreetMap estándar
base.on("tileerror", () => { if (++tileErr === 8) { map.removeLayer(base); L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map).bringToBack(); } });
const cluster = L.markerClusterGroup({
  chunkedLoading: true, maxClusterRadius: 55, disableClusteringAtZoom: 15, showCoverageOnHover: false,
  iconCreateFunction: (c) => { const n = c.getChildCount(), s = n < 100 ? 34 : n < 1000 ? 42 : 50; return L.divIcon({ html: "<div class='cl' style='width:" + s + "px;height:" + s + "px;line-height:" + (s - 4) + "px'>" + n + "</div>", className: "", iconSize: [s, s] }); },
});
map.addLayer(cluster);

let hourSel = null, brands = new Set(), DATA = [], rules = [], origin = null, youMarker = null, filter = "", sel = null, updated = "";
const nm = (p) => { const n = p[5]; return n && !/^[\d*_.-]{6,}$/.test(n) ? n : (p[4] || "Punto de recarga") + (p[8] ? " · " + p[8] : ""); };
let sortBy = "d";
const F = { lat: 0, lon: 1, kw: 2, dc: 3, op: 4, name: 5, fee: 6 };
const mq = matchMedia("(max-width:760px)");

// ---------- Precios ----------
const findRule = (t) => rules.find((r) => new RegExp(r.match).test(t.toLowerCase()));
function basePrice(rule, dc) {
  if (!rule) return null;
  if (dc && rule.schedule) { const h = hourSel != null ? hourSel : new Date().getHours(); const s = rule.schedule.find((x) => h >= x[0] && h < x[1]); if (s) return s[2]; }
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
  if (brands.size && !brands.has(p[10])) return false;
  if (filter === "CCS2") return /T2COMBO/.test(p[9] || "");
  if (filter === "T2") return /iec62196T2(:|,|$)/.test(p[9] || "");
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
    const m = L.circleMarker([p[F.lat], p[F.lon]], { radius: 7, color: "#111", weight: 1, fillColor: dc ? "#e82127" : "#f2f3f5", fillOpacity: 0.95 });
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
  rows.sort(sortBy === "p" ? (a, b) => (a.price == null) - (b.price == null) || a.price - b.price || a.d - b.d : sortBy === "k" ? (a, b) => b.kw - a.kw || a.d - b.d : (a, b) => a.d - b.d);
  const priced = rows.filter((r) => r.price != null && r.price > 0);
  $("s-n").textContent = rows.length;
  $("s-p").textContent = priced.length ? eur(Math.min(...priced.map((r) => r.price))) : "–";
  $("s-t").textContent = c.kwh.toFixed(0) + " kWh";
  $("status").textContent = map.getZoom() < 9 ? "Acerca el mapa para ver la lista." : "";
  $("list").innerHTML = "";
  if (map.getZoom() < 9) return;
  rows.slice(0, 50).forEach((r) => {
    const li = document.createElement("li");
    li.innerHTML = '<div><div class="nm"><span class="dot ' + (r.dc ? "dc" : "") + '"></span>' + logo(r.p[10], 18) + esc(nm(r.p)) + '</div><div class="sub">' + esc(r.p[F.op] || "Operador desconocido") + " · " + r.d.toFixed(1) + " km · " + r.kw + " kW " + (r.dc ? "DC" : "AC") + (connShort(r.p) ? " · " + connShort(r.p) : "") + '</div></div>' +
      '<div class="pr">' + (r.price != null ? '<b class="ok">' + (r.price === 0 ? "Gratis" : eur(r.price) + "/kWh") + "</b><div class='sub'>" + (r.cost ? eur(r.cost, 1) + " · " : "") + fmtTime(r.hours) + "</div>" : '<div class="na">sin precio</div><div class="sub">' + fmtTime(r.hours) + "</div>") + "</div>";
    li.addEventListener("click", () => { if (mq.matches) setSheet("min"); map.setView([r.p[F.lat], r.p[F.lon]], Math.max(map.getZoom(), 16)); select(r.p); });
    $("list").appendChild(li);
  });
}

const BR = [[/endesa/i, "Endesa X Way"], [/iberdrola/i, "Iberdrola"], [/repsol/i, "Repsol"], [/zunder|easychargar/i, "Zunder"], [/tesla/i, "Tesla"], [/electra/i, "Electra"], [/totalenergies/i, "TotalEnergies"], [/wenea/i, "Wenea"], [/\bedp\b/i, "EDP"], [/ionity/i, "Ionity"], [/atlante/i, "Atlante"], [/acciona/i, "Acciona"], [/galp/i, "Galp"], [/fastned/i, "Fastned"], [/barcelona de serveis|\bbsm\b/i, "BSM"], [/etecnic/i, "Etecnic"], [/charging together/i, "Charging Together"], [/eranovum/i, "Eranovum"], [/plenoil/i, "Plenoil"], [/bonpreu/i, "Bonpreu"]];
function brandOf(op) { op = op || ""; for (const [re, n] of BR) if (re.test(op)) return n; return op.replace(/[,.]?\s*(S\.?L\.?U?\.?|S\.?A\.?U?\.?|SRL)\s*$/i, "").trim() || "Otros"; }
function buildBrandUI() {
  const cnt = {}; DATA.forEach((p) => { cnt[p[10]] = (cnt[p[10]] || 0) + 1; });
  const list = Object.entries(cnt).sort((x, y) => y[1] - x[1]).slice(0, 40);
  $("brands").innerHTML = '<button data-b="" class="on">Todas</button>' + list.map(([n, k]) => '<button data-b="' + esc(n) + '">' + esc(n) + " <small>" + k + "</small></button>").join("");
}
$("brands").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (!b.dataset.b) brands.clear(); else if (brands.has(b.dataset.b)) brands.delete(b.dataset.b); else brands.add(b.dataset.b);
  [...$("brands").children].forEach((x) => x.classList.toggle("on", x.dataset.b ? brands.has(x.dataset.b) : !brands.size));
  $("bn").textContent = brands.size ? "(" + brands.size + ")" : "";
  buildMarkers();
});
const CTL = { iec62196T2COMBO: "CCS2", iec62196T2: "Tipo 2", chademo: "CHAdeMO", iec62196T1: "Tipo 1", iec62196T1COMBO: "CCS1", iec62196T3A: "Tipo 3A", iec62196T3C: "Tipo 3C" };
const ctLabel = (k) => CTL[k] || (/^domestic/.test(k) ? "Schuko/doméstico" : /^iec60309/.test(k) ? "Industrial CEE" : k);
function conns(p) { const m = {}; (p[9] || "").split(",").filter(Boolean).forEach((s) => { const [k, kw, n] = s.split(":"), l = ctLabel(k); m[l] = m[l] || { l, kw: 0, n: 0 }; m[l].kw = Math.max(m[l].kw, +kw); m[l].n += +n; }); return Object.values(m); }
const connShort = (p) => conns(p).map((c) => c.l).join("/");
const connChips = (p) => { const c = conns(p); return c.length ? '<div class="cc">' + c.map((x) => "<span>" + esc(x.l) + " <small>" + x.kw + " kW · ×" + x.n + "</small></span>").join("") + "</div>" : ""; };
const LOGO = { "Endesa X Way": "endesa.com", Iberdrola: "iberdrola.es", Repsol: "repsol.com", Zunder: "zunder.com", Tesla: "tesla.com", Electra: "electra.eu", TotalEnergies: "totalenergies.es", EDP: "edp.com", Ionity: "ionity.eu", Acciona: "acciona.com", Galp: "galp.com", Fastned: "fastnedcharging.com", Plenoil: "plenoil.es", Bonpreu: "bonpreu.cat" };
function logo(b, s) { const d = LOGO[b]; return '<span class="lg" style="width:' + s + "px;height:" + s + 'px"><b>' + esc((b || "?")[0]) + "</b>" + (d ? '<img alt="" loading="lazy" src="https://www.google.com/s2/favicons?domain=' + d + '&sz=64" onerror="this.remove()">' : "") + "</span>"; }
let pm = null;
function aerial(p) {
  if (pm) { pm.remove(); pm = null; }
  const el = $("ph"); if (!el) return;
  pm = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false }).setView([p[F.lat], p[F.lon]], 18);
  L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 19, maxZoom: 19 }).addTo(pm);
  L.circleMarker([p[F.lat], p[F.lon]], { radius: 8, color: "#fff", weight: 3, fillColor: "#e82127", fillOpacity: 1 }).addTo(pm);
}
function flat(e) { if (!e.rule || e.rule.schedule) return ""; const bp = basePrice(e.rule, e.dc); return bp == null ? "" : '<p class="alt">Tarifa plana las 24 h: ' + eur(bp) + " /kWh. No tengo franjas horarias publicadas para este operador.</p>"; }
function strip(e) {
  if (!e.rule || !e.rule.schedule || !e.dc) return "";
  const cur = hourSel != null ? hourSel : new Date().getHours(), v = [];
  for (let i = 0; i < 24; i++) { const s = e.rule.schedule.find((x) => i >= x[0] && i < x[1]); v.push(s ? s[2] : e.rule.dc); }
  const mx = Math.max(...v), mn = Math.min(...v); let bars = "";
  for (let i = 0; i < 24; i++) bars += '<i class="' + (i === cur ? "cur" : "") + '" style="height:' + (30 + (v[i] - mn) / (mx - mn || 1) * 70) + '%" title="' + i + ":00 · " + eur(v[i]) + '"></i>';
  let rows = "", i0 = 0;
  for (let i = 1; i <= 24; i++) if (i === 24 || v[i] !== v[i0]) { rows += '<div class="bd' + (cur >= i0 && cur < i ? " now" : "") + '"><span>' + String(i0).padStart(2, "0") + "–" + String(i).padStart(2, "0") + " h</span><b>" + eur(v[i0]) + "</b>" + (e.rule.sub ? "<em>con suscripción " + eur(memberPrice(e.rule, v[i0])) + "</em>" : "") + "</div>"; i0 = i; }
  return '<div class="bt"><b style="font-size:13px">Precio por franja horaria</b>' + rows + "</div>" + '<div class="strip"><div>' + bars + "</div><span>Tarifa pública por hora (0–24 h): de " + eur(mn) + " a " + eur(mx) + " /kWh</span></div>";
}
function select(p) {
  sel = p; const c = car(), e = enrich(p, c);
  const card = $("card"); card.hidden = false;
  const noteBase = e.rule && e.rule.sub ? "Suscripción: " + e.rule.sub.name : "";
  card.innerHTML = '<button class="x" aria-label="Cerrar">×</button><h3 class="hd">' + logo(p[10], 34) + "<span>" + esc(nm(p)) + '</span></h3><div class="sub">' + esc(p[F.op] || "Operador desconocido") + "</div>" +
    connChips(p) + '<div class="big ' + (e.price != null ? "ok" : "") + '">' + (e.price == null ? "Sin precio" : e.price === 0 ? "Gratis" : eur(e.price) + '<small style="font-size:14px;color:var(--mut)"> /kWh</small>') + "</div>" +
    (() => { const bp = basePrice(e.rule, e.dc), mp = memberPrice(e.rule, bp); return e.rule && e.rule.sub && bp && mp < bp ? '<p class="alt">Sin suscripción ' + eur(bp) + ' · Con suscripción ' + eur(mp) + ' /kWh</p>' : ""; })() + '<div class="grid"><div><span>Potencia</span>' + e.kw + " kW " + (e.dc ? "DC" : "AC") + "</div><div><span>Tiempo estimado</span>" + fmtTime(e.hours) + "</div>" +
    "<div><span>Coste de tu carga</span>" + (e.cost != null ? eur(e.cost, 2) : "—") + "</div><div><span>Km que añades</span>~" + Math.round(c.kwh / 0.16) + " km</div></div>" +
    strip(e) + flat(e) + (e.rule && e.rule.note ? '<p class="sub">' + esc(e.rule.note) + "</p>" : "") + (noteBase ? '<p class="sub">' + esc(noteBase) + "</p>" : "") +
    (e.price == null ? '<p class="sub">No tengo el precio de este operador. Mira su app (Reve/operador).</p>' : "") +
    '<div id="ph"></div><p class="alt">Vista aérea © Esri · el punto rojo es el cargador</p><a class="go" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + p[F.lat] + "," + p[F.lon] + '">Cómo llegar</a><a class="go sec" target="_blank" rel="noopener" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + p[F.lat] + "," + p[F.lon] + '">Ver la calle (Street View)</a>';
  aerial(p);
  card.querySelector(".x").onclick = () => { card.hidden = true; sel = null; };
}

// ---------- Datos ----------
async function loadData() {
  $("status").textContent = "Cargando cargadores de España…";
  try {
    const j = await fetch("data/chargers.json?v=" + Date.now().toString(36).slice(0, -3), { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    DATA = j.d; updated = j.updated;
    DATA.forEach((p) => { p[10] = brandOf(p[4]); }); buildBrandUI();
    $("foot").textContent = DATA.length.toLocaleString("es") + " puntos oficiales (MITECO / DGT, CC-BY) · actualizado " + new Date(updated).toLocaleDateString("es") + ". Precio solo donde se conoce la tarifa; el oficial en tiempo real está en mapareve.es.";
    buildMarkers(); $("boot").hidden = true;
  } catch (e) {
    const bt = $("boot"); bt.hidden = false; bt.className = "err"; bt.textContent = "No se pudieron cargar los cargadores. Recarga la página.";
    $("status").textContent = "Aún no hay datos descargados (data/chargers.json). Ejecuta la acción «Actualizar cargadores» en GitHub.";
  }
}
fetch("prices.json?v=" + Date.now().toString(36).slice(0, -3), { cache: "no-cache" }).then((r) => r.json()).then((j) => { rules = j.rules || []; if (DATA.length) buildMarkers(); }).catch(() => {});
loadData();
setTimeout(() => { const b = $("boot"); if (!b.hidden && !DATA.length) b.textContent = "Cargando cargadores… (puede tardar con datos móviles)"; }, 6000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------- Controles ----------
let t = null; map.on("moveend", () => { clearTimeout(t); t = setTimeout(refresh, 150); });
map.on("dragstart", () => { origin = null; });
$("chips").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; filter = b.dataset.t; [...$("chips").children].forEach((x) => x.classList.toggle("on", x === b)); buildMarkers(); });
const swh = () => { $("swh").textContent = $("member").checked ? "Precio con descuento de suscripción" : "Precio de tarifa pública, sin suscripción"; };
["batt", "from", "to", "member", "acmax"].forEach((id) => $(id).addEventListener("input", () => { swh(); refresh(); if (sel) select(sel); }));
$("member").addEventListener("change", () => { swh(); refresh(); if (sel) select(sel); }); swh();
const hs = $("hour");
hs.innerHTML = '<option value="">Ahora</option>' + Array.from({ length: 24 }, (_, i) => '<option value="' + i + '">' + String(i).padStart(2, "0") + ":00</option>").join("");
hs.addEventListener("change", () => { hourSel = hs.value === "" ? null : +hs.value; refresh(); if (sel) select(sel); });
function locate() {
  if (!navigator.geolocation) { $("status").textContent = "Tu navegador no permite geolocalización."; return; }
  $("status").textContent = "Buscando tu ubicación…";
  navigator.geolocation.getCurrentPosition((pos) => {
    origin = [pos.coords.latitude, pos.coords.longitude];
    if (youMarker) map.removeLayer(youMarker);
    youMarker = L.circleMarker(origin, { radius: 9, color: "#fff", weight: 3, fillColor: "#3b82f6", fillOpacity: 1, interactive: false }).addTo(map);
    map.setView(origin, 14); $("status").textContent = "";
  }, (e) => { $("status").textContent = "No se pudo obtener la ubicación (" + (e.code === 1 ? "permiso denegado" : "sin señal") + ")."; }, { enableHighAccuracy: true, timeout: 15000 });
}
$("locate").addEventListener("click", locate); $("fab").addEventListener("click", locate);
$("sort").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; sortBy = b.dataset.s; [...$("sort").children].forEach((x) => x.classList.toggle("on", x === b)); refresh(); });

// Hoja inferior arrastrable en móvil
const panel = $("panel"), grip = $("grip");
function setSheet(state) { panel.classList.toggle("min", state === "min"); panel.classList.toggle("full", state === "full"); const h = state === "min" ? 150 : state === "full" ? innerHeight * .88 : innerHeight * .44; document.documentElement.style.setProperty("--sh", h + "px"); panel.dataset.s = state; setTimeout(() => map.invalidateSize(), 250); }
const order = ["min", "mid", "full"];
grip.addEventListener("click", () => setSheet(order[(order.indexOf(panel.dataset.s || "mid") + 1) % 3]));
let y0 = null; grip.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; }, { passive: true });
grip.addEventListener("touchend", (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; if (Math.abs(dy) < 25) return; const i = order.indexOf(panel.dataset.s || "mid"); setSheet(order[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]); });
if (mq.matches) setSheet("mid");
$("q").addEventListener("focus", () => { if (mq.matches && panel.dataset.s === "min") setSheet("mid"); });
async function search() {
  const q = $("q").value.trim(); if (!q) return;
  try {
    const j = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=es&q=" + encodeURIComponent(q)).then((r) => r.json());
    if (!j.length) { $("status").textContent = "No encontré ese lugar."; return; }
    origin = null; map.setView([+j[0].lat, +j[0].lon], 13); if (mq.matches) { setSheet("mid"); $("q").blur(); }
  } catch (e) { $("status").textContent = "Error en la búsqueda."; }
}
$("go").addEventListener("click", search);
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });

function route() { setTimeout(() => map.invalidateSize(), 50); }
window.addEventListener("hashchange", route); route();
