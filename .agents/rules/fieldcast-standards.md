# Padrões de Arquitetura e Governança — FieldCast (Atualizado)

> Regra canônica espelhada em `/AGENTS.md` e nas skills modulares em `/.agents/skills/`.

## Regra 1 — Fidelidade Arquitetural (`docs/SPEC.md`)
- Projeto **100% open-source, gratuito, sem backend próprio e sem chaves de API pagas**.
- Previsões operam em resolução **horária (1h)** para **168h (7 dias)** em produção (48h em fixtures).
- Chamadas Open-Meteo usam `timeformat=unixtime&timezone=auto`.
- Altitude exclusivamente do DEM (`elevation`); nunca usar altitude do GPS.
- Datas ISO sem hora (`YYYY-MM-DD`) devem ser parseadas/agrupadas no fuso local ou meio-dia UTC (nunca `00:00 UTC`).

## Regra 2 — Qualidade TypeScript, Zod & Modelos
- TypeScript com `strict: true` e `noUnusedLocals`.
- APIs validadas via Zod (`src/types/schemas.ts`): Open-Meteo Forecast (`ecmwf_ifs025`, `gfs_seamless`, `icon_seamless`, `gem_seamless`), Open-Meteo Marine (`wave_*`, `swell_*`, `ocean_current_*`, `sea_level_height_msl`), Archive (`archive-api.open-meteo.com`), RainViewer, Nominatim e `ipwho.is`.
- Qualquer exibição de nível do mar (`sea_level_height_msl`) deve sinalizar que trata-se de estimativa (~8 km MSL) e **não substitui tábua oficial da DHN / Marinha**.

## Regra 3 — Zero-Crash, Fluidez Mobile & Exportação
- Ações assíncronas envolvidas por `safeAction`; HTTP protegido pelo Circuit Breaker (`src/services/httpClient.ts`).
- **Anti-Auto-Scroll**: nunca chamar `scrollIntoView` automático em `useEffect` que desloque a janela principal do usuário no Android/Desktop.
- **Anti-Jank**: caches offscreen no canvas de mapa; bússola prioriza sensor absoluto (`AbsoluteOrientationSensor` / `deviceorientationabsolute` exclusivo) e oculta automaticamente se disfuncional.
- Exportações cobrem `CSV (BOM UTF-8)`, `JSON`, `GPX`, `GeoJSON`, `KML` e `KMZ`, mais boletim WhatsApp com hora local, temperatura, chuva, vento médio, direção e rajadas sempre pareados.

## Regra 4 — Segurança & Escopo em Swarm Paralelo
- Protegido por `.agents/hooks.json` (`.agents/scripts/safety-gate.mjs`).
- Cada operador atua em seu escopo modular (`.agents/skills/*`) ou worktree compartilhada (`workspace: "share"`), com entrega validada por `npx tsc --noEmit`, `npm run test` e `npm run build`.
- Repositório final consolidado e compilado em `F:\Backup-data\local_data\App_FieldCast` (PWA `dist/` + Android `.apk` com ícones `mipmap-*` e `assets/`).
