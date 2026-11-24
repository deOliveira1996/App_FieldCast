---
name: fieldcast-field-ops
description: Manage GPS cascade resolution, Capacitor foreground route tracking, mobile WebView compass calibration/auto-hide, waypoint photo compression, historical time-series extraction UI, and multi-format sharing/export controls. Use when editing `src/components/field/` or `src/services/platform/`.
---

# FieldCast Field Operations

- **Compass Safety**: Prioritize `AbsoluteOrientationSensor` / exclusive `deviceorientationabsolute` (`absolute === true`) with tilt compensation; never overwrite magnetic heading with relative `deviceorientation`. Provide an auto-disable / manual hide option when hardware sensors return invalid axes.
- **Historical & Weekly Logs**: Provide an optional on-demand query card (location, date range, models/all selector, CSV/JSON/KML/KMZ export) and local auto-check weekly recurrence rule ready for 1-click Android share or download.
- **Export Verification**: Deliver `CSV`, `JSON`, `GPX`, `GeoJSON`, `KML`, `KMZ`, and WhatsApp summary via `@capacitor/share` (native) or Blob download (web).
- **Verify**: Run `npm run test -- fieldOps exportersAndDb` and test UI interactions.
