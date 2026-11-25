# SPRINT 2 (V4) — HARDWARE (BÚSSOLA 0°/360° & GPS BACKGROUND ANDROID 14+) + MÉTRICAS & SCORES

## Objetivo
Corrigir definitivamente o loop `360° <-> 0°` da bússola e a parada do rastreamento GPS com tela fechada no Android, além de enriquecer a ingestão open-source (Umidade, Sensação, CAPE/Trovoadas, Wind Shear, Alertas Extremos) e adicionar Scores de Qualidade customizáveis + layouts colapsáveis em Navegação e Aeronáutica.

## Divisão de Operadores (Wave 2 — Máx. 3 Subagentes)

### Operador 2A — Ingestão Open-Source Expandida, Eventos Extremos & Scores Customizáveis
- **Write-Scope:** `src/types/schemas.ts`, `src/services/openMeteoService.ts`, `src/utils/extremeEvents.ts`, `src/utils/qualityScores.ts`, `src/utils/operationalAlerts.ts`
- **Entregáveis:**
  1. Incluir variáveis gratuitas Open-Meteo (`relative_humidity_2m`, `apparent_temperature`, `cape`, `weather_code`) mantendo 100% de retrocompatibilidade com fixtures offline existentes.
  2. `extremeEvents.ts`: detector determinístico de **Eventos Extremos Globais** (tempestade elétrica WMO `95–99` / `CAPE >= 1500 J/kg`, vendaval/rajada severa, chuva torrencial, squall barométrico, ressaca costeira e tempestade geomagnética NOAA `Kp >= 5`) com metadados obrigatórios de **fonte oficial** e **possíveis danos**.
  3. `qualityScores.ts`: motor configurável de **Scores de Qualidade (`0–100`)** para *Campo / Dia a Dia*, *Navegação Costeira* e *Aeronáutica / Drone*, mais cálculo de **Wind Shear (`kt/100ft`)**.

### Operador 2B — Correção da Bússola (`360° <-> 0°`) & Layout Colapsável em Navegação e Aeronáutica
- **Write-Scope:** `src/components/field/WindCompass.tsx`, `src/components/navigation/NavigationTab.tsx`, `src/components/aeronautics/AeronauticsTab.tsx`
- **Entregáveis:**
  1. `WindCompass.tsx`: implementar filtro passa-baixa circular vetorial ($\sin/\cos$ EMA + deadband `1.5°`) e **acumulador contínuo de rotação (`unwrappedHeadingDeg`)** para que cruzar `359° -> 1°` aplique apenas `+2°` no CSS sem jamais girar `-358°` em loop reverso.
  2. `NavigationTab.tsx` & `AeronauticsTab.tsx`: organizar seções em painéis colapsáveis limpos, incluir seletor de modelo (`FieldCast Ensemble` padrão), adicionar **Score Náutico Customizável**, **Wind Shear (`kt/100ft`)**, **Risco Convectivo/Trovoada (`CAPE`)**, e botão **Tela Cheia** nos gráficos de maré e perfil vertical.

### Operador 2C — Android 14+ Foreground Location Nativo & Consentimento de Segundo Plano
- **Write-Scope:** `android/app/src/main/java/org/fieldcast/app/*`, `android/app/src/main/AndroidManifest.xml`, `src/services/platform/LocationTrackerService.ts`
- **Entregáveis:**
  1. `FieldCastLocationForegroundService.java` + `BackgroundGeolocationPlugin.java` + registro em `MainActivity.java` e `<service android:foregroundServiceType="location">` no `AndroidManifest.xml` (com `POST_NOTIFICATIONS`), mantendo coleta GPS nativa (`LocationManager`) ativa com notificação persistente quando a tela do celular estiver apagada no bolso.
  2. Fluxo explícito de consentimento do usuário em `LocationTrackerService.ts` (opt-in de segundo plano, verificação real de disponibilidade do plugin e orientação de economia de bateria Android).
