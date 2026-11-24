---
name: fieldcast-map-radar
description: Maintain FieldCast Leaflet maps, RainViewer tiles, spatial 3x3 meteorological model canvas overlays, offline tile cache (300-tile limit), and frame-rate optimization. Use when editing `src/components/map/` or `ForecastPinMiniMap`.
---

# FieldCast Map & Weather Radar

- **Smooth Performance**: Cache static IDW heatmap rasters onto an offscreen canvas (`moveend`/`zoomend`/data change only) rather than recomputing per pixel inside `requestAnimationFrame`.
- **Resilient Layers**: Use `RAINVIEWER_MAX_NATIVE_ZOOM = 7` and degrade gracefully on tile/network failure. Provide clean layer toggles/fallbacks if an overlay errors.
- **Offline Missions**: Enforce `<= 300` tiles and max 4 concurrent requests via `offlineTilesService.ts`.
- **Verify**: Inspect Leaflet HUD, RainViewer status, and overlay behavior in Vitest + browser preview.
