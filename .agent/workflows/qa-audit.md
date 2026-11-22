---
description: Roteiro de Auditoria QA Completa (Terminal + Browser) para o FieldCast (Sprint 4)
---

# Workflow de Auditoria QA — FieldCast (`qa-audit.md`)

Execute os passos abaixo na Sprint 4 para validar 100% dos critérios da Seção 7 de `docs/SPEC.md`:

## 1. Validação Estática, Ícones e Testes Unitários (Terminal)
1. Verifique a geração de ícones PWA e Android:
   - Execute `npm run icons:generate` e confirme a existência dos arquivos em `public/icons/` (`192x192.png`, `512x512.png`, `maskable-512x512.png`) e `assets/` (`icon-only.png`, `icon-foreground.png`, `icon-background.png`).
2. Verifique a tipagem estrita TypeScript:
   - Execute `npx tsc --noEmit` (deve retornar 0 erros).
3. Execute toda a suíte Vitest:
   - Execute `npm run test` (100% dos testes aprovados, incluindo média circular vetorial, índice de confiabilidade costeiro vs. continental, interpolação vertical + double-check de cisalhamento, tendência barométrica, nevoeiro, cache de tiles <= 300 e operações de campo).
4. Verifique o build de produção PWA:
   - Execute `npm run build` (0 erros e geração de `dist/` com service worker e manifesto PWA).

## 2. Auditoria Visual e Funcional (Browser / Preview)
1. Suba o servidor local e inspecione as 3 abas principais (**Previsão**, **Mapa & Radar**, **Campo & Dados**) em viewport Desktop e Mobile:
   - Confirme ausência de erros no console (`console.error` / `uncaught exception`).
   - Teste o toggle de tema **Claro / Escuro** e verifique contraste e legibilidade.
   - Na aba **Previsão**, valide a hierarquia estrita: Resumo Atual + Seletor de Pontos Salvos/Busca + Badge de Confiança + Semáforo -> Alertas Ativos -> Seletor de Modelos (FieldCast Ensemble vs. ECMWF/GFS/ICON/Spaghetti + toggle de Interpolação Vertical) -> Gráficos ECharts -> Tabela Windguru 168h -> Efemérides.
   - Verifique os botões de ajuda contextual (`?`) e os modais **"Guia Rápido & Glossário"** e **"Autodiagnóstico (Health Check)"** no cabeçalho.
   - Na aba **Mapa & Radar**, valide o mapa Leaflet com tiles CartoDB CORS, controles do radar RainViewer e ferramenta de **Área de Missão Offline** (limite de 300 tiles).
   - Na aba **Campo & Dados**, valide o painel GPS Tracker, criação de Waypoint com foto e snapshot meteorológico, Bússola e botões de Exportação (CSV BOM UTF-8, JSON, GPX, GeoJSON).

## 3. Documentação Final e Status
1. Revise e finalize o `README.md` com instruções de execução local, deploy gratuito PWA, build local Capacitor Android e download do `.apk` via GitHub Actions (`.github/workflows/android-apk.yml`).
2. Atualize `docs/SPRINT_STATUS.md` marcando a Sprint 4 como `CONCLUÍDA`.
