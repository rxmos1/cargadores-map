# Cargadores de España y comparador de coches

Web (HTML + JS + Leaflet, sin build ni claves) con tres pestañas:

- **Mapa de cargadores**: mapa real con todos los cargadores de España que estén en OpenStreetMap (se cargan según la zona que ves; zoom 10 o más). Buscador de lugares, botón «Usar mi ubicación», filtros por tipo y potencia, precio, tiempo y coste de tu carga.
- **Comparar coches**: coches editables con consumo, precio, seguro, mantenimiento y cuota.
- **Guía de Sabadell**: lista curada de cargadores de la zona.

## Publicar

GitHub Pages: Settings → Pages → rama `main`, carpeta `/`. En repos privados exige plan de pago.

## Precios

`prices.json` → `rules`: `match` (regex sobre «operador nombre»), `ac`/`dc` en €/kWh, opcional `schedule`, `sub` (`pctOff`, `eurOff`, `fixed`) y `note`. Ningún operador publica precios abiertos: revísalos en su app. Donde no hay regla sale «sin precio».

## Límites

- Datos de OpenStreetMap: puede faltar algún cargador o su potencia.
- Tiempo DC estimado (10-80 % hasta 110 kW, 25 kW por encima); en AC máx. 11 kW (Model 3 RWD).
- La API Overpass tiene límites de uso: si falla, reintenta en unos segundos.
