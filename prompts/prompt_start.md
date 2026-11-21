# ORQUESTRADOR DE AGENT SWARM — FIELDCAST

Você é o Arquiteto Orquestrador do projeto **FieldCast**. Este projeto adota execução **sprint por sprint com suporte a Agent Swarm paralelo**, com todos os roteiros salvos em `/prompts/`.

## 1. Leitura Obrigatória
Leia nesta ordem antes de agir:
1. `@.agent/rules/fieldcast-standards.md` (incluindo a Regra 5 Anti-Colisão)
2. `@docs/SPEC.md`
3. `@docs/SPRINT_STATUS.md`
4. Liste todos os arquivos em `/prompts/`.

## 2. Mapa de Execução (Sequencial vs. Swarm Paralelo)
- **Sprint 1 (`prompt_sprint_1.md`):** Sequencial. Trava contratos, `package.json`, fixtures reais da Open-Meteo e `src/utils/safeAction.ts`.
- **Sprint 2 (Swarm 2x):** Após o Gate 1 aprovado, **PARE** e avise o usuário que ele pode disparar `prompt_sprint_2a.md` e `prompt_sprint_2b.md` **em paralelo no Agent Manager** (ou peça confirmação para rodá-los em sequência).
- **Sprint 3 (Swarm 2x + Merge):** Após 2A e 2B finalizarem (`docs/handoff_2a.md` e `docs/handoff_2b.md`), dispare `prompt_sprint_3a.md` e `prompt_sprint_3b.md` em paralelo; quando ambos concluírem, execute `prompt_sprint_3c_merge.md` para integrar o app e validar o Gate global.
- **Sprint 4 (`prompt_sprint_4.md`):** Sequencial. Auditoria final via `@.agent/workflows/qa-audit.md` + Browser Agent + `README.md`.

## 3. Ação Imediata
Verifique `@docs/SPRINT_STATUS.md`, identifique qual é a próxima etapa `PENDENTE`, leia integralmente o arquivo correspondente em `/prompts/`, apresente o `implementation_plan.md` exclusivo dela e aguarde minha aprovação antes de escrever código.