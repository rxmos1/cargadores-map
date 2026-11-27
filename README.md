# Cargadores cerca de Sabadell

Mapa web que junta en un solo sitio los cargadores de la zona (Sabadell, Sant Quirze, Sant Cugat, Terrassa) con potencia, precio estimado, tiempo y coste de tu carga.

- Ubicaciones y potencias: [Open Charge Map](https://openchargemap.org) (clave gratuita).
- Precios: `prices.json`, con los que has ido comprobando. Ningún operador publica una API abierta de precios en tiempo real, así que **hay que revisarlos a mano** en cada app.
- Sin dependencias ni build: HTML + JS + Leaflet.

## Usar

1. Pide una clave en https://openchargemap.org/site/develop/api (gratis).
2. Abre `index.html` con un servidor local (`python3 -m http.server`) o publícalo con GitHub Pages (Settings → Pages → rama `main`, carpeta `/`).
3. Pega la clave en «Ajustes». Se guarda solo en tu navegador.

## Usar mi ubicación

El botón «Usar mi ubicación» centra la búsqueda donde estés (el navegador pide permiso; necesita HTTPS o localhost, como en GitHub Pages).

## Guía y comparador de coches

`guia/index.html` es una página independiente (sin claves ni servidor) con la lista de cargadores de la zona, el esquema de mapa y la pestaña para comparar coches.

## Editar precios

`prices.json` → `rules`. Cada regla tiene un `match` (expresión regular sobre «operador título dirección») y precios `ac` / `dc` en €/kWh. Opcional: `schedule` (franjas horarias de la rápida), `sub` (suscripción: `pctOff`, `eurOff` o `fixed`) y `note`.

## Límites

- El tiempo de carga en DC es una estimación (media 10-80 % hasta 110 kW, y 25 kW por encima del 80 %).
- En AC se limita a 11 kW, el máximo del Model 3 de tracción trasera.
- Los puntos privados (como el Wallbox del trabajo) no salen en Open Charge Map.
- No he podido probarlo contra la API real desde la sesión donde lo escribí.
