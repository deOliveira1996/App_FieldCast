# SPRINT 4 (V4) — INTEGRAÇÃO FINAL, QA COMPLETO, DOCUMENTAÇÃO V4, BUILD WINDOWS/ANDROID & GIT (`dev` + `main`)

## Objetivo
Integrar todos os módulos V4 em `src/App.tsx`, executar a bateria completa de testes automatizados e auditoria de usabilidade/segurança, atualizar toda a documentação (`README.md`, `docs/SPRINT_STATUS.md`, `docs/V4_SPRINT_PLAN.md`), sincronizar e compilar as entregas finais em `F:\Backup-data\local_data\App_FieldCast` (bundle Windows PWA `dist/` + `app-debug.apk` Android) e realizar commit/push nas branches `dev` e `main`.

## Checklist Obrigatório de Entrega (Gate V4)
1. **Integração `src/App.tsx`:**
   - Conectar as abas modulares (`Resumo`, `Modelos & Gráficos`, `Navegação`, `Aeronáutica`, `Mapa & Radar`, `Dados & Relatórios`, `Configurações & Alertas`), Sidebar Retrátil, Seletor Global de Modelo (`FieldCast Ensemble` padrão), avaliador de Notificações com Janela Horária e persistência offline.
2. **Testes & Tipagem:**
   - `npx tsc --noEmit` -> **0 erros**
   - `npm run test` -> **100% aprovado** (incluindo novas suítes unitárias e de UI para bússola `360° <-> 0°`, notificações com janela horária, eventos extremos, estatística científica/relatórios, trava de pin e abas V4)
   - `npm run build` -> bundle PWA limpo em `dist/`.
3. **Auditoria QA Visual & Responsiva:**
   - Testar transições `Vertical (390x844) -> Horizontal (844x390) -> Vertical (390x844)`, Sidebar retrátil, modo Tela Cheia em mapas e gráficos, e `0` erros de console.
4. **Documentação Completa:**
   - Atualizar `README.md`, `docs/SPRINT_STATUS.md` e `docs/V4_SPRINT_PLAN.md` documentando todas as funcionalidades V4, fontes de dados, equações estatísticas, permissões Android 14+ e guias de uso.
5. **Release Windows + Android & Git:**
   - Sincronizar para `F:\Backup-data\local_data\App_FieldCast`, executar `npx cap sync android` e `.\gradlew.bat assembleDebug`.
   - Realizar commit estruturado V4 e atualizar as branches **`dev`** e **`main`** (local + `origin`).
