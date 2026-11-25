# Plano de Sprints V4.0 — FieldCast (Modular UI, Hardware Fixes, Notificações & Relatórios Científicos)

| Sprint / Wave | Prompt Associado | Escopo Resumido | Agentes | Status |
|---|---|---|---|---|
| **Fase 0 — Setup & Contratos** | `prompts/prompt_v4_master_swarm.md` | Contratos tipados `src/types/v4.ts`, prompts das 4 Sprints e ambiente local | Coordenador | CONCLUÍDA |
| **Sprint 1 — UI Modular, Sidebar, Rotação & Tela Cheia** | `prompts/prompt_v4_sprint_1_ui_shell.md` | Sidebar retrátil, fix `Portrait<->Landscape`, `<FullscreenViewer>`, Trava de Pin, *Resumo Diário* vs *Comparação de Modelos* | 3 subagentes (`1A`, `1B`, `1C`) | CONCLUÍDA |
| **Sprint 2 — Bússola 0°/360°, GPS Background & Métricas** | `prompts/prompt_v4_sprint_2_hardware_metrics.md` | Bússola contínua vetorial, Foreground GPS Android 14+, Umidade/CAPE/Trovoada/Wind Shear, Eventos Extremos & Scores | 3 subagentes (`2A`, `2B`, `2C`) | CONCLUÍDA |
| **Sprint 3 — Notificações (Janela Horária) & Relatórios** | `prompts/prompt_v4_sprint_3_notifications_reports.md` | Alertas locais/extremos + Janela Horária + 3 Templates, Aba Configurações, Sub-telas de Dados e Report Técnico/Acadêmico ERA5 | 2 subagentes (`3A`, `3B`) | CONCLUÍDA |
| **Sprint 4 — Integração, QA, Docs, Builds & Git (`dev`/`main`)** | `prompts/prompt_v4_sprint_4_qa_release.md` | Integração `App.tsx`, suíte Vitest V4, QA Browser, `README.md`, sync Windows + `.apk` Android e commits em `dev` e `main` | Coordenador + QA | CONCLUÍDA |
