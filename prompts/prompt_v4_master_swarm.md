# FIELDCAST V4.0 — MASTER SWARM & SPRINT ORCHESTRATION PROMPT

> **Arquitetura Canônica:** Leia `@AGENTS.md`, `@.agents/rules/fieldcast-standards.md`, `@docs/V4_SPRINT_PLAN.md` e os contratos compartilhados em `src/types/v4.ts` antes de editar qualquer arquivo.

## Regras Mandatórias de Orquestração & Segurança
1. **100% Open-Source, Gratuito & Zero-Backend:** Nenhuma chave de API paga ou servidor proprietário. Fontes oficiais: `Open-Meteo (Forecast, Marine, Archive ERA5)`, `NOAA SWPC (Kp)`, `RainViewer`, `Nominatim OSM`, `ipwho.is` e `suncalc`.
2. **Preservação Integral:** Nenhuma funcionalidade existente das versões V1–V3 pode ser removida — apenas reorganizada, expandida e tornada responsiva/colapsável.
3. **Controle de Concorrência (Swarm Higiene):**
   - Máximo de **2 a 3 subagentes por onda (Wave)** com `Write-Scope` estritamente isolado (zero colisão de arquivos).
   - Aguardar término completo de cada onda antes de iniciar a próxima ou atualizar artefatos.
   - Relatórios de subagentes estritamente concisos (arquivos alterados, resumo curto e status `PASS/FAIL`).
4. **Segurança:** Respeitar `.agents/hooks.json` (`safety-gate.mjs`), `safeAction`, `fetchWithCircuitBreaker` + `zod`, opt-in explícito do usuário para GPS em segundo plano e notificações, e zero exposição de segredos/keystores.

---

## Mapa das 4 Sprints V4.0

1. **Sprint 1 (`prompts/prompt_v4_sprint_1_ui_shell.md`) — Fundação UI Responsiva, Sidebar Retrátil, Tela Cheia & Novas Abas:**
   - Correção definitiva do bug mobile `Vertical -> Horizontal -> Vertical` (`overflow-x: clip`, `min-w-0`, `safe-area-inset`, `useViewportResize` com resize automático de ECharts/Leaflet).
   - Sistema de **Sidebar Retrátil** (expande/recolhe no desktop e gaveta deslizante limpa no mobile) + margens ergonômicas.
   - Componente universal **`<FullscreenViewer>`** para expandir qualquer Mapa ou Gráfico ECharts em tela cheia.
   - **Trava/Destrava de Marcador (Pin Lock)** nos mapas para explorar sem perder o ponto fixado da previsão.
   - Separação entre **Aba 1: Resumo Diário (Usuário do Dia a Dia)** e **Aba 2: Modelos & Comparação (Windguru + Plots sob demanda)**, mantendo **Seletor de Modelo** (`FieldCast Ensemble` padrão + `ECMWF`, `GFS`, `ICON`, `GEM`) em todas as telas de previsão.

2. **Sprint 2 (`prompts/prompt_v4_sprint_2_hardware_metrics.md`) — Correções de Hardware (Bússola & GPS Background) + Métricas Físicas & Scores:**
   - Correção definitiva do loop `360° <-> 0°` em `WindCompass.tsx` (filtro circular vetorial $\sin/\cos$ + ângulo contínuo desenrolado sem salto de módulo 360 no CSS).
   - Serviço nativo Android 14+ **Foreground Location (`BackgroundGeolocationPlugin.java` + `FieldCastLocationForegroundService.java`)** para gravar trilhas com a tela apagada no bolso mediante consentimento explícito.
   - Ingestão aberta de **Umidade Relativa (`relative_humidity_2m`)**, **Sensação Térmica (`apparent_temperature`)**, **Convecção/Trovoadas (`cape` + `weather_code`)**, **Evapotranspiração FAO-56 (`et0_fao_evapotranspiration`)** e cálculo de **Wind Shear (`kt/100ft`)**.
   - Motor de **Alertas Globais de Eventos Extremos** (span fixo na tela inicial com fonte documentada + *"Mais Detalhes"*) e **Scores Customizáveis de Qualidade (0–100)** para Campo/Dia a Dia, Navegação e Aeronáutica.

3. **Sprint 3 (`prompts/prompt_v4_sprint_3_notifications_reports.md`) — Notificações com Janela Horária, Sub-telas de Dados & Relatórios Técnicos/Acadêmicos:**
   - Sistema de **Notificações Locais/Push Zero-Backend** (plugin nativo Android `FieldCastNotificationsPlugin.java` + Service Worker/Web Notification API) com opt-in total do usuário, alertas automáticos de eventos extremos, **regras customizadas com mensagem própria**, **filtro obrigatório de Janela Horária** (`startHHMM`–`endHHMM` e gatilho por horário) e **3 Templates Guia**.
   - Central dedicada de **Configurações & Alertas**.
   - Fim do scroll monolítico em **Dados & Armazenamento**: navegação reativa por sub-telas ocupando a área útil inteira (*Visão Geral*, *GPS Tracker*, *Waypoints & Fotos*, *Séries Históricas*, *Relatórios Técnicos/Acadêmicos*).
   - Motor **Estatístico & Relatório Técnico/Acadêmico Formal** (estatística descritiva, percentis $P_{10}/P_{90}$, anomalias $Z\text{-score}$, balanço hídrico $P - ET_0$ FAO-56, GDD, citações científicas ERA5/ECMWF/NOAA e exportação em **Report HTML/PDF imprimível**, **Markdown**, **CSV BOM** e **JSON**).

4. **Sprint 4 (`prompts/prompt_v4_sprint_4_qa_release.md`) — Integração, Auditoria QA, Documentação V4, Build Windows/Android APK & Git (`dev` + `main`):**
   - Validação `npx tsc --noEmit` (0 erros), `npm run test` (100% pass, incluindo suítes V4), `npm run build` e QA visual responsiva (`Portrait <-> Landscape`).
   - Atualização completa do `README.md`, `docs/SPRINT_STATUS.md` e instruções de uso.
   - Sincronização para `F:\Backup-data\local_data\App_FieldCast`, compilação `app-debug.apk` Android e commit/push nas branches `dev` e `main`.
