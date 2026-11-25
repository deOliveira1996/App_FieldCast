# SPRINT 1 (V4) — FUNDAÇÃO UI RESPONSIVA, SIDEBAR RETRÁTIL, TELA CHEIA & SEPARAÇÃO DE ABAS

## Objetivo
Eliminar a sobrecarga visual da interface, corrigir definitivamente o travamento de layout mobile na rotação `Vertical -> Horizontal -> Vertical`, introduzir a **Sidebar Retrátil**, **Tela Cheia Universal (`<FullscreenViewer>`)**, **Trava de Pin no Mapa** e separar a **Tela Inicial Simplificada (Resumo Diário)** da **Aba Exclusiva de Comparação de Modelos & Parâmetros**.

## Divisão de Operadores (Wave 1 — Máx. 3 Subagentes)

### Operador 1A — Shell Responsivo, Sidebar Retrátil & Correção de Orientação
- **Write-Scope:** `src/hooks/useViewportResize.ts`, `src/components/common/FullscreenViewer.tsx`, `src/components/common/ModelModeSwitchPill.tsx`, `src/components/layout/AppShell.tsx`, `src/styles/index.css`
- **Entregáveis:**
  1. `useViewportResize.ts`: monitorar `resize`, `orientationchange` e `visualViewport`, emitindo `layoutEpoch` com debounce (`100ms`) e disparando evento global para redimensionar ECharts e Leaflet ao retornar do modo paisagem para retrato.
  2. `FullscreenViewer.tsx`: container reutilizável com botão *"Tela Cheia / Reduzir"*, suporte a `Escape`, bloqueio limpo de scroll de fundo e redimensionamento automático do conteúdo filho.
  3. `ModelModeSwitchPill.tsx`: seletor compacto reutilizável de modelo (`FieldCast Ensemble` padrão, `ECMWF`, `GFS`, `ICON`, `GEM`) para presença consistente em todas as telas de previsão.
  4. `AppShell.tsx` & `index.css`: Sidebar lateral expansível/recolhível no desktop (`240px <-> 68px`) + Drawer/Sidebar deslizante e barra inferior com folga `safe-area` generosa no mobile, `overflow-x: clip` e `min-w-0` em toda a árvore flex/grid.

### Operador 1B — Aba 1 (Resumo Diário Intuitivo) & Aba 2 (Comparação Multi-Modelo + Toggles de Plots)
- **Write-Scope:** `src/components/summary/*`, `src/components/comparison/*`, `src/components/forecast/ForecastCharts.tsx`, `src/components/forecast/ForecastTab.tsx`
- **Entregáveis:**
  1. `DailySummaryTab.tsx`: visão limpa e intuitiva para o usuário do dia a dia — Temperatura Atual / Mínima / Máxima, Sensação Térmica, Umidade Relativa (`%`), Probabilidade e Taxa de Chuva (`mm/h`), Risco de Trovoada/Raios, **Span Fixo Global de Eventos Extremos** (com fonte oficial clara + botão *"Mais Detalhes"* expansível), previsão enxuta das próximas 24h, resumo de 7 dias, Score Geral de Campo, seletor de modelo e Mini-Mapa com **Trava de Pin** + **Tela Cheia**.
  2. `ModelComparisonTab.tsx`: tela exclusiva estilo Windguru/Windy com `WindguruTable` (168h), comparação direta de todos os modelos contra o `FieldCast Ensemble`, e **botões toggle para abrir/ocultar os plots ECharts** (Vento 10–120m, Chuva/Pressão, Ondas, Nebulosidade) + botão **Tela Cheia** em cada gráfico.

### Operador 1C — Mapas em Tela Cheia, Trava de Marcador (Pin Lock) & Gaveta Estilo Windy
- **Write-Scope:** `src/components/forecast/ForecastPinMiniMap.tsx`, `src/components/map/MapRadarTab.tsx`
- **Entregáveis:**
  1. Botão reativo **Travar / Destravar Pin** no `ForecastPinMiniMap` e no `MapRadarTab` (quando travado, o clique/arraste no mapa permite explorar regiões vizinhas e inspecionar camadas sem alterar a coordenada fixada da previsão; quando destravado, move o pin normalmente).
  2. Botão **Tela Cheia** em ambos os mapas com `map.invalidateSize()` automático em transições de tela cheia e rotação mobile.
  3. Sidebar/painel retrátil de camadas no `MapRadarTab` para não cobrir o mapa em telas pequenas.
