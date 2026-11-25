# FieldCast V4.0 — Previsão Multi-Modelo, Apoio à Decisão em Campo, Navegação, Aeronáutica & Relatórios Científicos

**FieldCast** é uma plataforma **100% open-source, gratuita, zero-backend e offline-first** (sem servidor próprio e sem chaves de API pagas) projetada tanto para o **usuário do dia a dia** quanto para **operações técnicas em campo, navegação costeira, voo de drones (VANT) e pesquisa acadêmica/ambiental**.

Construído sobre uma base única em **React 18 + TypeScript (`strict: true`) + Vite + Tailwind CSS + Apache ECharts + Leaflet + Dexie (IndexedDB) + Zod**, o projeto gera duas entregas sincronizadas:
1. **Versão Web / PWA (`vite-plugin-pwa`):** Instalável em Windows, Linux, macOS, Android e iOS, com Service Worker Workbox, pré-cache completo de assets e operação offline imediata (*cold-boot* com dados reais pré-carregados).
2. **Versão Nativa Android (`@capacitor/android` — SDK 35 / Android 14+):** Compilada em `.apk` nativo com **Serviço de Rastreamento GPS em Segundo Plano real (`FieldCastLocationForegroundService` + `WakeLock`)**, **Notificações Locais Nativas (`FieldCastNotificationsPlugin`)**, câmera com compressão `<canvas>` (`~200 KB`), bússola 3D contínua sem loop em `0°/360°`, compartilhamento nativo e pipeline gratuito de Cloud Build via GitHub Actions (`.github/workflows/android-apk.yml`).

---

## Novidades da Arquitetura Modular V4.0

### 1. Navegação em 7 Módulos + Sidebar Retrátil & Modo Tela Cheia Universal
- **Sidebar Retrátil Desktop (`240px ↔ 72px`) & Gaveta Deslizante Mobile:** Organização limpa sem sobrecarga monolítica, com folgas ergonômicas (`safe-area-inset`), alvos de toque $\ge 44\times44\text{px}$ e recuperação automática de layout na rotação `Vertical ↔ Horizontal` (`useViewportResize` + `overflow-x: clip`).
- **Seletor Global de Modelo:** Em todas as telas de previsão, o **FieldCast Ensemble** é o padrão, permitindo alternar a qualquer instante para **ECMWF IFS 0.25°**, **NOAA GFS**, **DWD ICON** ou **ECCC CMC GEM** (além do modo **Spaghetti** na comparação).
- **Tela Cheia (`<FullscreenViewer>`):** Todos os mapas e todos os gráficos ECharts/tabelas possuem botão dedicado para expandir em tela cheia (`Escape` ou toque para reduzir).

### 2. Os 7 Módulos Especializados
1. **Resumo (`DailySummaryTab` — Dia a Dia):** Cartões limpos e fontes amplas com Temperatura Atual / Mínima / Máxima / Sensação, Umidade Relativa (`%`), Probabilidade e Taxa de Chuva (`mm/h`), Risco de Trovoada (`CAPE` + códigos WMO), **Span Fixo Global de Eventos Extremos** (sempre visível com indicação clara da fonte oficial e botão expansível *"Mais Detalhes"*), previsão horária de 24h, síntese de 7 dias no fuso local, **Score de Qualidade de Campo (`0–100`)** e Mini-Mapa com **Trava de Pin**.
2. **Modelos (`ModelComparisonTab` — Especialista / Windguru):** Aba exclusiva para comparação multi-modelo (`168h`), matriz lado a lado contra o `FieldCast Ensemble`, **botões toggle sob demanda para exibir/ocultar os plots analíticos** (Vento & Estratos `10–120m`, Chuva & Pressão, Ondas & Maré MSL, Nebulosidade Estratificada) e tabela `WindguruTable` com opção de tela cheia.
3. **Navegação (`NavigationTab` — Costeira & Superfície):** Seções colapsáveis com curva e eventos de Preia-mar/Baixa-mar (`sea_level_height_msl`, acompanhados do aviso obrigatório de que estimativas ~8 km MSL **não substituem a Tábua de Marés oficial da DHN / Marinha do Brasil**), Onda Significativa, Swell, **Energia de Swell (`kW/m`)**, Esbeltez, Correntes, **Score Náutico Configurável (`0–100`)** e **Bússola Vetorial Contínua** (`WindCompass` com filtro circular $\sin/\cos$ EMA + ângulo desenrolado contínuo sem salto em `360° ↔ 0°`).
4. **Aeronáutica (`AeronauticsTab` — VANT/Drone & Clima Espacial):** **Score de Voo para Drone (`0–100`)** por altitude AGL (`30–120m`), **Tesoura de Vento / Wind Shear (`kt/100ft`)**, **Teto Estimado de Nuvens (`LCL`)**, Densidade-Altitude, Risco Convectivo (`CAPE`), e painel geomagnético **NOAA SWPC Kp (`G0–G5` + Override Manual `0.0–9.0`)**.
5. **Mapa (`MapRadarTab` — Tático, Radar & Offline):** Mapa Leaflet multi-estilo em tela ampla/cheia, **Botão Reativo Travar/Destravar Pin** (permite explorar regiões e inspecionar a malha 3×3 sem perder a coordenada fixada da previsão), gaveta retrátil estilo Windy, radar animado **RainViewer** e **Área de Missão Offline** no IndexedDB (limite estrito de **300 tiles**, 4 downloads simultâneos).
6. **Armazenamento & Relatórios (`FieldDataTab` — Sub-Telas Interativas):** Navegação interna dedicada por tela cheia (sem rolo monolítico):
   - *Resumo de Armazenamento* (status IndexedDB, locais salvos, área principal, tiles offline);
   - *GPS Tracker & Rotas* (filtro $\le 20\text{m}$, Haversine, serviço Android 14+ em segundo plano com consentimento explícito);
   - *Waypoints & Fotos* (compressão `<canvas>` `~200 KB` + snapshot meteorológico automático);
   - *Séries Históricas ERA5 & Recorrência Semanal* (`archive-api.open-meteo.com`);
   - *Relatórios Técnicos & Acadêmicos (`TechnicalReportsPanel`)*: estatística descritiva completa (`Média`, `Mediana`, `DP`, `P10`, `P90`, `IQR`, tendência linear OLS, anomalia padronizada $|Z|$), **Balanço Hídrico Agroclimático FAO-56 ($P - ET_0$)**, **Graus-Dia (`GDD`)**, citações bibliográficas formais (*Hersbach et al. 2020 Copernicus ERA5, ECMWF IFS, NOAA GFS/SWPC, DWD ICON, ECCC GEM, SRTM DEM*) e download em **Relatório HTML/PDF Imprimível**, **Markdown Científico**, **CSV (UTF-8 BOM)**, **JSON**, **GPX**, **GeoJSON**, **KML**, **KMZ** e boletim **WhatsApp**.
7. **Configurações (`SettingsTab` — Alertas, Janelas Horárias & Limites):**
   - **Notificações Zero-Backend (Android Nativo + Web SW)** com controle total de opt-in do usuário;
   - **Alertas Automáticos de Eventos Extremos** (tempestades, vendavais, chuvas severas, queda barométrica, ressaca, tempestade solar Kp);
   - **Construtor de Alertas Personalizados** (temperatura, prob. chuva, vento, rajada, nebulosidade, onda, Kp + título e mensagem próprios);
   - **Filtro Estrito de Janela Horária** (`Início HH:MM` até `Fim HH:MM`, incluindo janelas noturnas e gatilho *"Avisar a partir das HH:MM"*);
   - **3 Templates Guia Prontos** (*Defesa Civil / Tempestade*, *Janela Matinal de Campo*, *Alerta Náutico & VANT*);
   - Permissões de GPS em segundo plano e calibração dos Scores Operacionais.

---

## Fontes de Dados Abertas & Rastreabilidade Científica (Zero API Keys)

| Fonte | Endpoint / Base | Uso no FieldCast |
|---|---|---|
| **Open-Meteo Multi-Model Forecast** | `api.open-meteo.com/v1/forecast` | Séries horárias (`1h` / `168h`, `unixtime`, DEM `elevation`) combinando `ecmwf_ifs025`, `gfs_seamless`, `icon_seamless` e `gem_seamless` + `CAPE`, `weather_code`, `relative_humidity_2m`, `apparent_temperature` e `et0_fao_evapotranspiration` |
| **Open-Meteo Marine** | `marine-api.open-meteo.com/v1/marine` | Ondas, período, swell, correntes oceânicas e estimativa regional `sea_level_height_msl` (~8 km; não substitui tábua DHN) |
| **Copernicus ERA5 (via Open-Meteo Archive)** | `archive-api.open-meteo.com/v1/archive` | Reanálise histórica horária para séries temporais, anomalias ($Z$-score), balanço hídrico ($P - ET_0$) e relatórios acadêmicos |
| **NOAA SWPC** | `services.swpc.noaa.gov` | Índice geomagnético planetário $K_p$ (`G0–G5`) para segurança GNSS/GPS e VANTs |
| **RainViewer** | `api.rainviewer.com/public/weather-maps.json` | Quadros passados e *nowcast* de radar meteorológico |
| **Nominatim OSM & `ipwho.is`** | `nominatim.openstreetmap.org` / `ipwho.is` | Geocodificação sob demanda (`1 req/s`) e fallback aproximado por IP |

---

## Como Executar, Testar e Compilar

### 1. Desenvolvimento & Verificação Local (Web / PWA)
```bash
# Instalar dependências
npm install

# Gerar ícones PWA e mipmaps Android
npm run icons:generate

# Checagem estrita de tipos TypeScript (0 erros)
npx tsc --noEmit

# Executar suíte completa de testes automatizados (Vitest)
npm run test

# Rodar servidor local de desenvolvimento
npm run dev

# Gerar bundle de produção PWA em dist/
npm run build
```

### 2. Compilação Local do `.apk` Android (Capacitor 6 / Android 14+)
Pré-requisitos: **Node.js 20+**, **JDK 21** e **Android SDK (API 35)**.
```bash
npm run icons:generate
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```
O instalador Android será gerado em `android/app/build/outputs/apk/debug/app-debug.apk` com os plugins nativos `BackgroundGeolocationPlugin`, `FieldCastLocationForegroundService` e `FieldCastNotificationsPlugin` integrados.

### 3. Build Automático na Nuvem (GitHub Actions)
A cada push/execução em `.github/workflows/android-apk.yml`, o pipeline valida `tsc`, `vitest` e `vite build`, sincroniza o Capacitor Android e publica o artefato `fieldcast-android-debug-apk`.

---

## Governança & Sprints (Agent Swarm)
- **Regras Globais:** `AGENTS.md` e `.agents/rules/fieldcast-standards.md`
- **Skills Modulares:** `.agents/skills/fieldcast-*` + Gate de Segurança `.agents/hooks.json` (`safety-gate.mjs`)
- **Prompts de Sprints (V1 a V4):** `prompts/` (`prompt_v4_master_swarm.md` e `prompt_v4_sprint_1..4_*.md`)
- **Histórico & Status:** `docs/SPRINT_STATUS.md` e `docs/V4_SPRINT_PLAN.md`
