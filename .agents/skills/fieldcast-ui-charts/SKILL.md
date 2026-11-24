---
name: fieldcast-ui-charts
description: Build and maintain FieldCast Forecast UI cards, ECharts plots, Windguru comparison tables, and local-timezone ephemeris components without forced scroll jumping or mobile layout collapse. Use when editing `src/components/forecast/`.
---

# FieldCast Forecast UI & Charts

- **Responsiveness**: Ensure chart containers (`[data-chart-id="waves"]`, etc.) enforce explicit `minHeight` and avoid `flex-1` collapse inside auto-height cards.
- **No Forced Auto-Scroll**: Never call `scrollIntoView` inside `useEffect` on table/chart updates; use container-local horizontal `scrollLeft` only on explicit user click.
- **Current Hour Sync & Summary**: Sync headers, vertical `markLine`, and compact chart summary bars to local forecast timezone (`useCurrentLocalHourIndex`), updating when clicked or at hour rollover.
- **Ephemeris Calendar Fix**: Never parse `YYYY-MM-DD` with raw `new Date(iso)` in UTC-negative timezones without anchoring noon UTC or local calendar formatting so today's date always renders accurately.
- **Verify**: Run `npm run test -- forecastReactivityAndLayout wavesAndMapRadar` and check desktop + mobile viewports.
