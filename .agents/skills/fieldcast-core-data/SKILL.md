---
name: fieldcast-core-data
description: Implement and verify FieldCast weather APIs (Open-Meteo Forecast/Marine/Archive), Zod schemas, weighted ensemble math, IndexedDB persistence, and multi-format exporters (CSV, JSON, GPX, GeoJSON, KML, KMZ, WhatsApp). Use for backend-less client data layer changes.
---

# FieldCast Core Data & Exporters

- **Models**: Maintain `ecmwf_ifs025`, `gfs_seamless`, `icon_seamless`, and `gem_seamless` via `timeformat=unixtime&timezone=auto`.
- **Marine & Tides**: Fetch `sea_level_height_msl` along with wave/swell/currents. Always mark MSL estimates as non-navigational (MSL != DHN).
- **Historical Data**: Fetch recent history via Forecast `past_days` or older ranges via `archive-api.open-meteo.com/v1/archive` only on explicit user/recurrence trigger.
- **Persistence & Health**: Store primary location, saved favorites, offline forecasts, and historical recurrence rules in localStorage/Dexie; track actual probe timestamps and latency in `httpClient.ts`.
- **Exporters**: Output `CSV` (UTF-8 BOM), `JSON`, `GPX`, `GeoJSON`, `KML`, and `KMZ`, plus WhatsApp bulletins pairing current local hour average wind, direction, gusts, temperature, precipitation, marine status, and confidence.
- **Verify**: Run `npx tsc --noEmit` and relevant Vitest suites in `src/test/`.
