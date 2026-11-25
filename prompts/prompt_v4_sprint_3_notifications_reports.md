# SPRINT 3 (V4) — NOTIFICAÇÕES COM JANELA HORÁRIA, SUB-TELAS DE DADOS & RELATÓRIOS ACADÊMICOS

## Objetivo
Implementar o sistema completo de **Notificações Configuráveis (com Eventos Extremos, Janelas Horárias e 3 Templates)**, criar a **Central de Configurações**, eliminar a estrutura monolítica da aba **Dados & Armazenamento** via sub-telas interativas e construir o motor de **Análise Estatística & Relatório Técnico/Acadêmico Formal (ERA5 + Forecast)**.

## Divisão de Operadores (Wave 3 — Máx. 3 Subagentes)

### Operador 3A — Motor de Notificações (Android Nativo + Web SW), Janelas Horárias, Templates & Aba Configurações
- **Write-Scope:** `src/services/notificationService.ts`, `src/components/settings/*`, `android/app/src/main/java/org/fieldcast/app/FieldCastNotificationsPlugin.java`
- **Entregáveis:**
  1. `FieldCastNotificationsPlugin.java` (Android `NotificationChannel` + `NotificationManagerCompat` + permissão `POST_NOTIFICATIONS`) + fallback Web (`ServiceWorkerRegistration.showNotification` / `Notification` API).
  2. `notificationService.ts`: controle total de opt-in pelo usuário, disparo automático opcional para **Eventos Extremos**, **Regras Personalizadas** (temperatura, prob. chuva, vento, nebulosidade, onda, Kp + título e mensagem customizados), **filtro estrito de Janela Horária** (`startHHMM`–`endHHMM` e horário de boletim `"a partir de HH:MM"`) e **3 Templates Guia** (*Tempestade/Eventos Severos*, *Janela Ideal de Campo*, *Alerta Costeiro/Vento*).
  3. `SettingsTab.tsx`: painel organizado para gerenciar Notificações, Templates, Janelas Horárias, Calibração de Scores Operacionais, Tema e Permissões de Segundo Plano.

### Operador 3B — Motor Científico ERA5/Open-Meteo & Gerador de Relatórios Técnicos/Acadêmicos
- **Write-Scope:** `src/services/historicalWeatherService.ts`, `src/utils/scientificAnalytics.ts`, `src/utils/technicalReportGenerator.ts`, `src/components/reports/*`
- **Entregáveis:**
  1. Expandir `historicalWeatherService.ts` com `et0_fao_evapotranspiration` e umidade na Archive API (`archive-api.open-meteo.com` — Copernicus ERA5).
  2. `scientificAnalytics.ts`: estatística descritiva rigorosa (média, mediana, desvio-padrão, $P_{10}/P_{90}$, extremos, tendência linear), anomalias ($Z\text{-score}$), **Balanço Hídrico Agroclimático ($P - ET_0$ FAO-56)**, **Graus-Dia (`GDD`)** e coerência vetorial de vento ($R$).
  3. `technicalReportGenerator.ts` + `TechnicalReportsPanel.tsx`: geração instantânea de **Relatório Técnico-Científico Parcimonioso** (tanto para blocos de previsão 168h quanto para séries históricas ERA5) com metodologia explícita, citações formais das bases (*Copernicus ERA5, ECMWF IFS, NOAA GFS/SWPC, DWD ICON, ECCC GEM*), gráficos em tela cheia/embutidos, tabelas estatísticas e download direto em **HTML/PDF Imprimível**, **Markdown Científico**, **CSV (UTF-8 BOM)** e **JSON Auditável**.

### Operador 3C — Refatoração Modular de Dados & Armazenamento em Sub-Telas Interativas
- **Write-Scope:** `src/components/field/FieldDataTab.tsx`
- **Entregáveis:**
  1. Substituir o rolo monolítico único por navegação reativa em sub-vistas ocupando a tela útil inteira (via botões de sub-sidebar / pílulas responsivas):
     - **Resumo de Armazenamento** (IndexedDB, tiles offline, locais salvos)
     - **GPS Tracker & Rotas** (com status real de segundo plano Android + exportação)
     - **Waypoints & Fotos** (captura comprimida ~200 KB + snapshot climático)
     - **Séries Históricas & Recorrência** (extração sob demanda + gráficos em tela cheia)
     - **Relatórios Técnicos & Exportação Científica** (integração direta com `TechnicalReportsPanel`)
