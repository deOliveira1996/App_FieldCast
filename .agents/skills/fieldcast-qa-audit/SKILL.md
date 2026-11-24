---
name: fieldcast-qa-audit
description: Execute complete terminal and browser QA verification across FieldCast web PWA and Android WebView criteria, including console checks, light/dark themes, responsive layout, and security checks. Replaces legacy `.agent/workflows/qa-audit.md`.
---

# FieldCast QA Audit

1. **Static & Icon Check**: `npm run icons:generate`, verify `public/icons/` + `assets/` + Android `res/mipmap-*`, then run `npx tsc --noEmit`.
2. **Test Suite**: Run `npm run test` (100% pass rate; zero skipped tests).
3. **Production Bundle & Audit**: Run `npm run build` and check `.agents/scripts/safety-gate.mjs` + `npm audit --audit-level=high`.
4. **Live Browser Check**: Verify `Previsão`, `Mapa & Radar`, and `Campo & Dados` on Desktop & Mobile viewports with zero console/page errors, verifying Waves chart height, current-hour markers, Ephemeris local date, persistent primary location, and Diagnostics probes.
5. Update `docs/SPRINT_STATUS.md` if reporting a release milestone.
