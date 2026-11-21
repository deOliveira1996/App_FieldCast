# ESPECIFICAÇÃO TÉCNICA CONSOLIDADA — FIELDCAST

## PAPEL E OBJETIVO
Construir o aplicativo **FieldCast** — plataforma completa de previsão meteorológica, oceanográfica e apoio à decisão em campo, **100% open-source e gratuita** (sem servidor próprio e sem API keys pagas), com base de código única preparada para duas entregas sincronizadas:
1. **Versão Web (PWA):** Compatível com Windows, Linux, macOS, Android e iOS (instalável via navegador, funcional offline).
2. **Versão Empacotada (Android via Capacitor):** Pronta para compilação em `.apk` nativo com GPS em segundo plano (*Foreground Service*), câmera, magnetômetro, compartilhamento nativo e **workflow gratuito de build automático na nuvem via GitHub Actions** (`.github/workflows/android-apk.yml`).

---

## 0. IDENTIDADE VISUAL E ÍCONE (OBRIGATÓRIO)
- **Nome Oficial:** `FieldCast`
- **Identificador Capacitor (`capacitor.config.ts`):** `appId: "org.fieldcast.app"` e `appName: "FieldCast"`.
- **Manifesto PWA:** `name: "FieldCast — Previsão Local & Campo"`, `short_name: "FieldCast"`.
- **Ícone Vetorial:** Criar `public/icon.svg` minimalista, geométrico e de alto contraste (combinando elementos de vento/onda/bússola ou ponto geográfico, legível em tamanhos pequenos e compatível com temas Claro e Escuro).
- **Geração Automatizada de Assets:** Script `scripts/generate-icons.mjs` usando `sharp` para gerar PNGs a partir de `public/icon.svg`:
  - PWA (`public/icons/`): `192x192`, `512x512` e versão `maskable` (com *safe-zone* de 20%).
  - Android (`assets/` e `resources/`): `icon-only.png`, `icon-foreground.png`, `icon-background.png` prontos para `@capacitor/assets` / `android/app/src/main/res/`.

---

## 1. REGRAS DE DADOS, APIS GRATUITAS E CONTRATOS (CORRIGIDOS)
1. **Resolução Temporal Obrigatória:** Toda previsão atmosférica, oceanográfica, gráficos, tabelas e exportações devem operar em resolução **horária (1 em 1 hora)** cobrindo no mínimo **7 dias (168 horas)**.
2. **Padronização Temporal e Altimétrica:**
   - Todas as chamadas Open-Meteo devem usar **`timeformat=unixtime&timezone=auto`**. Os timestamps chegam em segundos UTC puros (convertidos internamente para ISO UTC / epoch ms) e o campo `timezone` (IANA) é usado apenas na formatação de exibição.
   - **Altitude:** Utilizar exclusivamente `elevation` (DEM) retornada pela Open-Meteo; descartar altitude do GPS.
3. **Previsão Atmosférica Multi-modelo (Open-Meteo Forecast API):**
   - Endpoint: `https://api.open-meteo.com/v1/forecast`
   - Modelos: `models=ecmwf_ifs025,gfs_seamless,icon_seamless`
   - Parâmetros `hourly`: velocidade e direção do vento (`10m`, `80m`, `100m`, `120m`), rajadas (`wind_gusts_10m`), `precipitation`, `precipitation_probability`, `temperature_2m`, `dew_point_2m`, `visibility`, `surface_pressure`, `cloud_cover_low`, `cloud_cover_mid`, `cloud_cover_high`, além de `elevation`.
   - **Parsing Multi-modelo:** A API retorna chaves com sufixo do modelo (ex.: `wind_speed_10m_ecmwf_ifs025`) e modelos diferentes não entregam todos os níveis/variáveis (ex.: ECMWF sem `80m`/`120m` ou valores `null`). O schema `zod` deve aceitar chaves sufixadas opcionais com `(number | null)[]` e normalizar para um contrato interno único (`NormalizedForecast`).
4. **Previsão Oceanográfica (Open-Meteo Marine API):**
   - Endpoint: `https://marine-api.open-meteo.com/v1/marine` com `timeformat=unixtime&timezone=auto`.
   - Parâmetros `hourly`: `wave_height`, `wave_period`, `wave_direction`, `swell_wave_height`, `swell_wave_period`, `swell_wave_direction`, `ocean_current_velocity`, `ocean_current_direction`.
   - **Detecção Continental vs. Costeira:** Se a coordenada estiver em terra firme (sem grade marinha ou 100% `null`), definir `marineAvailable: false` sem erro crítico e sem penalizar o Índice de Confiabilidade.
5. **Radar de Chuva Animado (RainViewer):**
   - Endpoint: `https://api.rainviewer.com/public/weather-maps.json` com controles de reprodução (**Play/Pause** e linha do tempo) sobre o mapa Leaflet.
   - Indisponibilidade ou restrição de zoom deve sinalizar estado **degradado (âmbar)** no Health Check, nunca crash.
6. **Tiles de Mapa Gratuitos com CORS:**
   - Utilizar tiles gratuitos compatíveis com CORS para cache offline no IndexedDB (ex.: CartoDB Voyager para tema Claro e DarkMatter para tema Escuro via `https://{s}.basemaps.cartocdn.com/...` com `crossOrigin: 'anonymous'`). Não realizar download em massa de `tile.openstreetmap.org`.
7. **Geocodificação e Fallback de IP:**
   - **Nominatim (OSM):** Busca textual disparada apenas ao submeter (Enter / botão) ou com *debounce* mínimo de `1000ms` (respeitando 1 req/s). Não tentar sobrescrever header `User-Agent` no navegador.
   - **Fallback IP:** `https://ipwho.is/` (sinalizado como *"Aproximado via IP"*).

---

## 2. STACK TECNOLÓGICA
- **Core Web/PWA:** Vite + React + TypeScript (`strict: true`) + `vite-plugin-pwa`.
- **Empacotamento Android:** Capacitor (`@capacitor/core`, `@capacitor/android`, `@capacitor/geolocation`, `@capacitor/camera`, `@capacitor/share`, `@capacitor/filesystem` e adaptador para `@capacitor-community/background-geolocation`) + GitHub Actions workflow `.github/workflows/android-apk.yml`.
- **Armazenamento Offline:** IndexedDB via `dexie` (pontos/locais favoritos salvos, waypoints, fotos comprimidas, tracks, cache de previsão, cache de tiles e log de erros).
- **Estilização e UI:** Tailwind CSS (Claro/Escuro persistente) + `lucide-react`.
- **Visualização:** Apache ECharts (`echarts-for-react`) + Leaflet (`react-leaflet`).
- **Efemérides:** `suncalc` (100% offline).
- **Validação e Testes:** `zod` e `vitest`.

---

## 3. MOTOR MATEMÁTICO, METEOROLÓGICO E DE CONFIANÇA (`src/utils/`)

### 3.1. Modelos Nativos vs. "Modelo FieldCast" (`ensembleMath.ts`)
- **Visão Nativa:** Inspeção individual de ECMWF (`10m, 100m`), GFS (`10m, 80m, 120m`) ou ICON (`10m, 80m, 120m`) + modo *spaghetti plot* comparativo.
- **Visão "Modelo FieldCast" (Ensemble):**
  - *Escalares* (vento, rajada, chuva, onda, pressão): média, mínimo, máximo e desvio padrão hora a hora ignorando `null`.
  - *Circulares* (direção de vento e corrente em graus): decomposição vetorial:
    - $u = -\text{speed} \cdot \sin(\theta \cdot \pi / 180)$, $v = -\text{speed} \cdot \cos(\theta \cdot \pi / 180)$
    - Reconstrução via `atan2(-u_mean, -v_mean)` normalizado para `[0, 360)`
    - Comprimento do vetor resultante médio unitário $R \in [0, 1]$ (medindo coerência direcional pura).
- **Perfil Vertical de Vento (0m a 120m):**
  - Níveis nativos (`10m`, `80m`, `100m/120m`) como dados primários.
  - No "Modelo FieldCast", camada opcional interpolada de 10 em 10m até 120m usando Lei de Potência $v(z) = v_{\text{ref}} \cdot (z / z_{\text{ref}})^{\alpha}$ com $\alpha$ calculado dinamicamente dos níveis nativos da hora.
  - **Double-Check Obrigatório:** Marcar valores interpolados como *"Estimado"*. Se $\alpha < 0.05$ ou $\alpha > 0.40$, disparar *"Cisalhamento Atípico — Baixa Confiança na Interpolação"* e penalizar o Índice de Confiança. **Rajadas estritamente em `10m`**.

### 3.2. Índice de Confiabilidade 0 a 100 (`confidenceIndex.ts`)
Score horário (`0–100`) e score geral do período:
- **Concordância entre Modelos (50 pts):** Dispersão relativa dos escalares + coerência direcional $R$.
- **Integridade e Frescor das Fontes (30 pts):** Penaliza falha de modelos atmosféricos, erro real marinho em área costeira ou cache `> 30 min`. **Regra Continental:** Quando `marineAvailable === false` por coordenada continental, redistribuir o peso dentro de Integridade/Frescor sem penalizar a nota.
- **Horizonte Temporal (20 pts):** Cheio `0–24h`, decaimento leve `24–72h`, acentuado `> 72h`.
- **Penalidade de Cisalhamento:** Desconto explícito se $\alpha \notin [0.05, 0.40]$ com interpolação ativa.
- **UI:** Badge (**Verde 80–100**, **Âmbar 50–79**, **Vermelho 0–49**) com tooltip explicando os fatores da nota.

### 3.3. Alertas Operacionais e Efemérides (`operationalAlerts.ts`)
- **Semáforo de Janela Segura (Configurável):** Limites editáveis (vento, rajada, onda, probabilidade de chuva) pintando cada hora em **Verde**, **Amarelo** ou **Vermelho**.
- **Tendência Barométrica ($\Delta P / 3\text{h}$):** Queda `> 4 hPa / 3h` em `surface_pressure` dispara alerta de frente/rajadas (*squall*).
- **Alerta de Nevoeiro e Visibilidade:** Cruza `visibility < 1000m` com *dew point spread* (`temperature_2m - dew_point_2m < 2 °C`).
- **Nebulosidade Estratificada:** Baixa, Média e Alta separadas.
- **Efemérides (`suncalc`):** Nascer/pôr do sol, crepúsculo civil e náutico, e fase da lua.

---

## 4. OPERAÇÕES DE CAMPO, PONTOS SALVOS E ADAPTADORES HÍBRIDOS
Em `src/services/platform/` detectando `Capacitor.isNativePlatform()`:
1. **Geolocalização em Cascata (`useSmartLocation.ts`):** (1) GPS (timeout 8s) -> (2) `https://ipwho.is/` (*"Aproximado via IP"*) -> (3) última coordenada no IndexedDB. Distâncias via Haversine.
2. **Locais/Pontos Salvos Offline:** Salvar, renomear, alternar rapidamente e excluir pontos favoritos no IndexedDB (`dexie`), funcionando 100% offline com a última previsão em cache.
3. **GPS Tracker Adaptativo (`LocationTrackerService.ts`):**
   - *Android (Capacitor):* Adaptador Foreground Service com notificação persistente (*"FieldCast: Gravando rota..."*), filtrando acurácia `> 20m`. Declarar permissões Android 14+ (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`).
   - *Web (PWA):* `watchPosition` + `Screen Wake Lock API` + banner avisando para manter tela ligada.
4. **Waypoints com Foto Georreferenciada:** `Lat/Lon`, `UTC`, nota, foto comprimida via `<canvas>` (~200 KB WebP/JPEG) e **snapshot automático das condições meteorológicas/oceanográficas**.
5. **Cache de Mapa Offline (Área de Missão):** Seleção de retângulo no mapa salvando tiles CORS no IndexedDB via subclasse customizada de `L.TileLayer` (`createTile()`), com trava de **máximo 300 tiles** e **4 downloads simultâneos**.
6. **Bússola de Vento e Onda Relativa:**
   - *iOS:* Botão explícito chamando `DeviceOrientationEvent.requestPermission()` + `webkitCompassHeading`.
   - *Android/Web:* `deviceorientationabsolute` (`360 - alpha`).
   - *Desktop/Sem sensor:* Oculta automaticamente.
7. **Exportação e Compartilhamento (Zero Servidor):** **CSV (BOM UTF-8 `\uFEFF`)**, **JSON**, **GPX** e **GeoJSON**. Mobile: Capacitor Share / Web Share API; Desktop: download + link `https://wa.me/?text=...` com resumo formatado.

---

## 5. ARQUITETURA ZERO-CRASH E AUTODIAGNÓSTICO
1. **Error Boundaries Granulares (`<ModuleErrorBoundary>`)** por módulo com motivo legível e botão *"Recarregar Módulo"*.
2. **Error Boundary Global** com motivo exato, timestamp UTC, *"Copiar Relatório Técnico"* e *"Limpar Cache e Reiniciar"*.
3. **Safe Action Wrapper (`src/utils/safeAction.ts`)** em todas as interações.
4. **Circuit Breaker (`src/services/httpClient.ts`):** Timeout 10s, 2 retries backoff exponencial, validação `zod`, abre após 3 falhas consecutivas e aciona fallback automático para cache IndexedDB com aviso visual.
5. **Painel de Autodiagnóstico (Health Check):** Indicador fixo no cabeçalho (Verde/Amarelo/Vermelho) abrindo modal com status, latência e última checagem de: Plataforma (Web/Android), APIs, GPS, IndexedDB e Log de Erros.

---

## 6. UI/UX (INSPIRAÇÃO WINDY / WINDGURU)
1. **Ajuda Contextual:** Botões (`?`) ao lado de *Índice de Confiança*, *Ensemble vs. Nativo*, *Perfil Vertical/Cisalhamento*, *Tendência Barométrica* e *Semáforo*, mais modal **"Guia Rápido & Glossário"** no cabeçalho.
2. **Navegação:** *Bottom Tab Bar* fixa no mobile e barra superior limpa no desktop com 3 abas: **Previsão**, **Mapa & Radar** e **Campo & Dados**.
3. **Hierarquia Estrita na Aba Previsão:**
   1. Resumo Atual + Seletor de Pontos Salvos/Busca + Badge de Confiança + Semáforo de Janela Segura
   2. Alertas Ativos (Barômetro / Nevoeiro / Cisalhamento)
   3. Gráficos Horários ECharts (Vento & Perfil Vertical, Ondas, Chuva, Nebulosidade Estratificada)
   4. Tabela Horária Compacta estilo Windguru (168h)
   5. Efemérides

---

## 7. CRITÉRIOS DE ACEITAÇÃO (QA)
1. Estrutura modular (`src/services/`, `src/utils/`, `src/components/`, `src/hooks/`, `src/db/`, `src/types/`).
2. `capacitor.config.ts`, scripts `package.json` (`dev`, `build`, `test`, `icons:generate`, `cap:sync`, `cap:android`) e workflow `.github/workflows/android-apk.yml`.
3. `public/icon.svg` e PNGs gerados para PWA e Android.
4. Vitest 100% aprovado cobrindo:
   - Média circular vetorial (`350°` e `10°` = `0°`, $R \approx 1$; `0°` e `180°` -> $R \approx 0$).
   - Índice de Confiabilidade (costeiro vs. continental sem penalidade indevida).
   - Interpolação vertical + Double-Check de cisalhamento ($\alpha \notin [0.05, 0.40]$).
   - Tendência barométrica ($\Delta P / 3\text{h} > 4\text{ hPa}$) e nevoeiro (*dew point spread