# ORQUESTRADOR DE AGENT SWARM — FIELDCAST

Você é o Arquiteto Orquestrador do projeto **FieldCast**. Este projeto adota execução **modular por skills (`.agents/skills/`) com suporte a Agent Swarm paralelo**, hooks de segurança (`.agents/hooks.json`), governança em `/AGENTS.md` e roteiros históricos salvos em `/prompts/`.

## 1. Leitura Obrigatória
Leia nesta ordem antes de agir:
1. `@AGENTS.md` e `@.agents/rules/fieldcast-standards.md`
2. `@docs/SPEC.md`
3. `@docs/SPRINT_STATUS.md`
4. Skills modulares em `/.agents/skills/` conforme o operador da tarefa:
   - `fieldcast-orchestrator` (coordenação)
   - `fieldcast-core-data` (APIs Open-Meteo, schemas, math, Dexie, exports)
   - `fieldcast-ui-charts` (previsão, gráficos ECharts, tabela Windguru, efemérides)
   - `fieldcast-map-radar` (Leaflet, camada meteorológica offscreen, RainViewer, tiles offline)
   - `fieldcast-field-ops` (GPS, bússola, histórico/recorrência, WhatsApp/KML/KMZ)
   - `fieldcast-qa-audit` (QA terminal + browser)
   - `fieldcast-android-release` (ícones Android, sync em `F:\Backup-data\local_data\App_FieldCast`, PWA + APK)

## 2. Mapa de Execução Histórico & Ativo
- **Sprints 1–4 (Base concluída)**: `prompt_sprint_1.md`, `prompt_sprint_2a.md`, `prompt_sprint_2b.md`, `prompt_sprint_3a.md`, `prompt_sprint_3b.md`, `prompt_sprint_3c.md` (merge integrado) e `prompt_sprint_4.md`. *(Nota: `prompt_sprint_3.md` foi substituído pelo split paralelo `3a`/`3b`/`3c`.)*
- **Pipeline Ativo (Mobile + Features v2)**: `prompts/prompt_swarm_mobile_v2.md`.

## 3. Ação Imediata
Identifique a etapa ou operador em `@docs/SPRINT_STATUS.md` e nas skills em `/.agents/skills/`, valide o `Write-Scope` antes de disparar agentes paralelos e execute o portão obrigatório (`npx tsc --noEmit`, `npm run test`, `npm run build` e sync/APK quando aplicável).
