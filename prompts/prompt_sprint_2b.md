# SPRINT 2B — UI WINDY/WINDGURU, ECHARTS, BOUNDARIES & AJUDA (SWARM PARALELO)

Leia `@.agent/rules/fieldcast-standards.md` (especialmente Regra 5 Anti-Colisão) e `@docs/SPEC.md`.

## Write-Scope Estrito (RESPEITO OBRIGATÓRIO)
- **PERMITIDO criar/editar:** `src/components/layout/*`, `src/components/common/*`, `src/components/forecast/*`, `src/hooks/useTheme.ts`, `src/hooks/useToast.ts`, `src/styles/*`, `docs/handoff_2b.md`.
- **PROIBIDO editar:** `package.json`, `src/types/*`, `src/utils/*`, `src/services/*`, `src/db/*`, `src/App.tsx`, `docs/SPRINT_STATUS.md`.

## Entregáveis
Crie componentes 100% tipados pelos contratos em `src/types/` e usando `src/utils/safeAction.ts`:
1. **Resiliência e Feedback (`src/components/common/`):**
   - `GlobalErrorBoundary.tsx` (motivo exato, timestamp UTC, *"Copiar Relatório Técnico"*, *"Limpar Cache e Reiniciar"*).
   - `ModuleErrorBoundary.tsx` (motivo legível + *"Recarregar Módulo"*).
   - `ToastContainer.tsx`, `SkeletonLoaders.tsx`, `HelpPopover.tsx` (`?` em português simples) e `GlossaryModal.tsx` (*"Guia Rápido & Glossário"*).
   - `HealthCheckModal.tsx` + `HealthBadge.tsx` (Verde/Amarelo/Vermelho no cabeçalho).
2. **Shell Responsivo (`src/components/layout/`):**
   - `AppShell.tsx` com *Bottom Tab Bar* fixa no mobile e barra superior limpa no desktop para 3 abas (**Previsão**, **Mapa & Radar**, **Campo & Dados**).
   - Toggle persistente de temas **Claro** (alto contraste solar) e **Escuro** (noturno), botão Glossário, HealthBadge e seletor/modal de **Pontos Salvos + Busca**. Todos os botões >= `44x44px`.
3. **Aba Previsão (`src/components/forecast/`) — Hierarquia estrita inspirada em Windy / Windguru:**
   - `CurrentSummaryCard.tsx`: resumo atual, DEM elevation, timestamp *"Atualizado às HH:MM"*, badge de Confiança (0–100 + tooltip detalhado), Semáforo de Janela Segura + `ThresholdSettingsModal.tsx`.
   - `ActiveAlertsBanner.tsx`: alertas de Barômetro, Nevoeiro e Cisalhamento Atípico.
   - `ModelSelectorBar.tsx`: alternância *Modelo FieldCast (Ensemble)* vs. Nativos (`ECMWF`, `GFS`, `ICON`, `Spaghetti`) + toggle de Interpolação Vertical Estimada (com aviso visual *"Estimado"*).
   - `ForecastCharts.tsx` (Apache ECharts): gráficos horários interativos com bandas de incerteza para Vento & Perfil Vertical (0–120m), Ondas/Swell (ocultado/sinalizado graciosamente quando continental), Chuva e Nebulosidade Estratificada.
   - `WindguruTable.tsx`: tabela horária compacta de 168h com setas direcionais e cores do Semáforo.
   - `EphemerisCard.tsx`: nascer/pôr do sol, crepúsculo civil/náutico e fase da lua.

## Validação e Handoff
- Verifique ausência de erros TypeScript nos arquivos de `src/components/` e `src/hooks/`.
- Salve seu inventário de componentes, props esperadas e observações em `docs/handoff_2b.md`.