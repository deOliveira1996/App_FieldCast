# FieldCast — Previsão Meteorológica, Oceanográfica & Apoio à Decisão em Campo

**FieldCast** é uma plataforma **100% open-source, gratuita e offline-first** (sem servidor próprio e sem chaves de API pagas) para previsão meteorológica multi-modelo horária (**168 horas / 7 dias**), previsão oceanográfica, radar de precipitação animado, cache tático de mapa offline e operações georreferenciadas em campo.

Construído com uma base de código única em **React 18 + TypeScript (`strict: true`) + Vite + Tailwind CSS + Dexie (IndexedDB)**, o projeto entrega duas versões sincronizadas:

1. **Versão Web / PWA (`vite-plugin-pwa`):** Instalável em Windows, Linux, macOS, Android e iOS, com Service Worker Workbox e pré-cache completo de assets e previsões offline.
2. **Versão Nativa Android (`@capacitor/android`):** Pronta para compilação em `.apk` com GPS em segundo plano (*Foreground Service* compatível com Android 14+), câmera nativa com compressão `<canvas>` (~200 KB), magnetômetro/bússola, compartilhamento nativo e **build automático gratuito na nuvem via GitHub Actions** (`.github/workflows/android-apk.yml`).

---

## Sumário

1. [Arquitetura e Stack Tecnológica](#1-arquitetura-e-stack-tecnológica)
2. [Motor Matemático, Meteorológico e de Confiança](#2-motor-matemático-meteorológico-e-de-confiança)
3. [Operações de Campo e Arquitetura Zero-Crash](#3-operações-de-campo-e-arquitetura-zero-crash)
4. [Passo 1 — Como Rodar Localmente](#4-passo-1--como-rodar-localmente)
5. [Passo 2 — Publicação Gratuita do PWA (Vercel ou GitHub Pages)](#5-passo-2--publicação-gratuita-do-pwa-vercel-ou-github-pages)
6. [Passo 3 — Compilação Local do `.apk` Android via Capacitor](#6-passo-3--compilação-local-do-apk-android-via-capacitor)
7. [Passo 4 — Download do `.apk` Gerado na Nuvem via GitHub Actions](#7-passo-4--download-do-apk-gerado-na-nuvem-via-github-actions)
8. [Estrutura de Diretórios](#8-estrutura-de-diretórios)

---

## 1. Arquitetura e Stack Tecnológica

| Camada | Tecnologia | Papel no FieldCast |
|---|---|---|
| **Core UI & Build** | Vite 5 + React 18 + TypeScript 5.6 (`strict: true`) | SPA modular de alta performance com tipagem estrita sem `any` implícito |
| **Estilização & UX** | Tailwind CSS 3.4 + `lucide-react` | Temas **Claro (Alto Contraste Solar)** e **Escuro (Noturno)** persistentes, com alvos de toque $\ge 44\times44\text{px}$ |
| **Gráficos Meteorológicos** | Apache ECharts 5 (`echarts-for-react`) | Séries horárias interativas de vento, perfil vertical (10–120m), ondas/swell, chuva/pressão e nebulosidade estratificada |
| **Mapa & Radar** | Leaflet 1.9 (`react-leaflet`) + CartoDB CORS + RainViewer | Mapa tático com camada `OfflineCartoTileLayer` lendo do IndexedDB e radar de chuva animado |
| **Banco Offline** | IndexedDB via `dexie` 4 | Tabelas locais: `savedLocations`, `forecastCache`, `waypoints`, `tracks`, `offlineTiles` e `errorLogs` |
| **Validação de Contratos** | `zod` 3.24 | Validação estrita em tempo de execução para Open-Meteo Forecast, Open-Meteo Marine, RainViewer, Nominatim e `ipwho.is` |
| **Efemérides Offline** | `suncalc` | Cálculo 100% local de nascer/pôr do sol, crepúsculo civil e náutico, e fase/iluminação lunar |
| **Empacotamento Híbrido** | Capacitor 6 (`@capacitor/core`, `@capacitor/android`) | Ponte nativa para Geolocalização, Câmera, Filesystem, Share e Foreground Service Android |
| **Testes Automatizados** | Vitest 2 + `jsdom` | 9 suítes e 67 testes unitários e de integração cobrindo matemática vetorial, confiabilidade, alertas, cache de tiles e campo |

### Fontes de Dados Públicas (Sem Chave de API)
- **Open-Meteo Forecast API (`https://api.open-meteo.com/v1/forecast`):** Resolução horária (`1h`) por 7 dias (`168h`), consultando simultaneamente **`ecmwf_ifs025`**, **`gfs_seamless`** e **`icon_seamless`** com `timeformat=unixtime&timezone=auto`. A altitude exibida usa exclusivamente o **Modelo Digital de Elevação (`elevation` DEM)** da Open-Meteo.
- **Open-Meteo Marine API (`https://marine-api.open-meteo.com/v1/marine`):** Altura, direção e período de ondas totais e *swell*, além de velocidade e direção de correntes oceânicas.
- **RainViewer API (`https://api.rainviewer.com/public/weather-maps.json`):** Quadros de radar meteorológico passados e *nowcast* com animação temporal sobre o mapa Leaflet.
- **Nominatim OpenStreetMap & `ipwho.is`:** Geocodificação textual disparada apenas no envio (`onSubmit` / botão *Buscar*) com fallback offline e geolocalização em cascata (GPS $\rightarrow$ IP aproximado $\rightarrow$ Cache IndexedDB).

---

## 2. Motor Matemático, Meteorológico e de Confiança

### 2.1. Ensemble Multi-Modelo vs. Visão Nativa (`src/utils/ensembleMath.ts`)
- **Modos de Inspeção:** O usuário pode alternar em tempo real entre o **Modelo FieldCast (Ensemble)**, cada modelo individual (**ECMWF IFS 0.25°**, **NOAA GFS**, **DWD ICON**) ou o modo comparativo **Spaghetti Plot**.
- **Variáveis Escalares (vento, rajadas, precipitação, temperatura, pressão, ondas):** Cálculo horário de média aritmética, mínimo, máximo e desvio padrão populacional ($\sigma$) ignorando valores `null` ou níveis ausentes em determinado modelo (ex.: ECMWF entrega vento nativo em `10m` e `100m`, enquanto GFS e ICON entregam `10m`, `80m`, `100m` e `120m`).
- **Variáveis Circulares (direção do vento e correntes em graus $[0^\circ, 360^\circ)$):** Para evitar erros aritméticos na passagem pelo Norte ($350^\circ$ e $10^\circ$ têm média real $0^\circ$, e não $180^\circ$), o FieldCast aplica decomposição vetorial meteorológica:
  $$u = -\text{speed} \cdot \sin\left(\frac{\theta \cdot \pi}{180}\right), \quad v = -\text{speed} \cdot \cos\left(\frac{\theta \cdot \pi}{180}\right)$$
  $$\bar{\theta} = \left(\text{atan2}(-\bar{u}, -\bar{v}) \cdot \frac{180}{\pi} + 360\right) \bmod 360$$
  A coerência direcional entre os modelos é medida pelo comprimento do vetor resultante unitário médio $R \in [0, 1]$:
  $$R = \sqrt{\left(\frac{1}{N}\sum_{i=1}^N \sin\theta_i\right)^2 + \left(\frac{1}{N}\sum_{i=1}^N \cos\theta_i\right)^2}$$

### 2.2. Perfil Vertical de Vento (10m a 120m) e Double-Check de Cisalhamento
- **Interpolação por Lei de Potência:** Quando o toggle **Interpolação 10–120m** é ativado, o FieldCast estima a velocidade de 10 em 10 metros ($10\text{m}, 20\text{m}, \dots, 120\text{m}$) usando:
  $$v(z) = v_{\text{ref}} \cdot \left(\frac{z}{z_{\text{ref}}}\right)^\alpha, \quad \alpha = \frac{\ln(v_{\text{top}} / v_{10})}{\ln(z_{\text{top}} / 10)}$$
- **Double-Check Obrigatório:** Todos os níveis interpolados recebem o selo explícito **"Estimado"**. Se o expoente de Hellmann $\alpha$ sair da faixa física normal ($\alpha < 0.05$ ou $\alpha > 0.40$), o sistema dispara o alerta **"Cisalhamento Atípico — Baixa Confiança na Interpolação"** e aplica penalidade explícita no Índice de Confiança. As **rajadas de vento (`wind_gusts_10m`) são exibidas estritamente em `10m`**.

### 2.3. Índice de Confiabilidade 0 a 100 (`src/utils/confidenceIndex.ts`)
Calculado hora a hora e consolidado para o período com badge colorido (**Verde 80–100**, **Âmbar 50–79**, **Vermelho 0–49**) e detalhamento dos 4 componentes:
1. **Concordância entre Modelos (`0–50 pts`):** Baixa dispersão escalar entre ECMWF, GFS e ICON + alta coerência direcional $R$.
2. **Integridade e Frescor das Fontes (`0–30 pts`):** Avalia disponibilidade dos 3 modelos atmosféricos, disponibilidade marinha e idade do cache ($> 30\text{ min}$ sofre decaimento gradual).
   - **Regra Continental (Zero Penalidade Indevida):** Quando a coordenada é continental/interior (ex.: Brasília `-15.7939, -47.8828`, onde a Open-Meteo Marine retorna grade 100% `null` e `marineAvailable === false`), os pontos da fonte marinha são **redistribuídos integralmente** para os modelos atmosféricos e frescor, exibindo aviso informativo continental sem reduzir a nota de confiança.
3. **Horizonte Temporal (`0–20 pts`):** Pontuação máxima nas primeiras `0–24h`, decaimento moderado em `24–72h` e decaimento acentuado de `72–168h`.
4. **Penalidade de Cisalhamento (`0` ou `-10 pts`):** Aplicada quando a interpolação vertical está ativa e $\alpha \notin [0.05, 0.40]$.

### 2.4. Alertas Operacionais e Semáforo (`src/utils/operationalAlerts.ts`)
- **Semáforo de Janela Segura Configurável:** Classifica cada hora em **Verde (Seguro)**, **Amarelo (Atenção)** ou **Vermelho (Perigo)** com limites editáveis e persistidos localmente para vento a 10m, rajadas a 10m, altura de onda e probabilidade de chuva.
- **Tendência Barométrica ($\Delta P / 3\text{h}$):** Queda de pressão atmosférica $> 4\text{ hPa}$ em janela móvel de 3 horas dispara alerta de aproximação frontal / linha de instabilidade (*squall*).
- **Risco de Nevoeiro / Baixa Visibilidade:** Dispara quando `visibility < 1000m` combinado com *dew point spread* estreito ($T_{2\text{m}} - T_{\text{orvalho}} < 2^\circ\text{C}$).

---

## 3. Operações de Campo e Arquitetura Zero-Crash

- **Safe Action Wrapper (`src/utils/safeAction.ts`):** Todas as interações assíncronas de interface passam por `safeAction`, prevenindo duplo clique, capturando exceções silenciosamente, gravando no banco de logs (`errorLogs`) e emitindo feedback visual via Toast.
- **Circuit Breaker HTTP (`src/services/httpClient.ts`):** Timeout de `10s`, até `2` retentativas com *exponential backoff*, validação `zod` obrigatória e abertura automática do circuito após `3` falhas consecutivas com fallback transparente para o cache IndexedDB (`dexie`).
- **Error Boundaries Granulares e Global:** Cada módulo possui seu `<ModuleErrorBoundary>` com botão *"Recarregar Módulo"*, e a raiz conta com `<GlobalErrorBoundary>` oferecendo *"Copiar Relatório Técnico"* e *"Limpar Cache e Reiniciar"*.
- **Painel de Autodiagnóstico (Health Check):** Indicador fixo no cabeçalho monitorando Plataforma (`Web` vs `Android`), status e latência das 5 APIs, GPS, saúde do IndexedDB, idade do cache e histórico de erros.
- **Cache de Mapa Offline (Área de Missão):** Seleção de área no mapa Leaflet baixando tiles CartoDB CORS (`Voyager` / `DarkMatter`, `crossOrigin: 'anonymous'`) para o IndexedDB com trava estrita de **máximo 300 tiles por missão** e fila de **4 downloads simultâneos**.
- **GPS Tracker Adaptativo (`LocationTrackerService.ts`):** Filtra leituras com acurácia $> 20\text{m}$, calcula distância acumulada via **Haversine**, aciona notificação persistente de *Foreground Service* no Android (*"FieldCast: Gravando rota..."*) e utiliza `Screen Wake Lock API` + alerta de tela ligada na Web.
- **Waypoints Georreferenciados & Exportação Zero-Servidor:** Criação de waypoints com foto comprimida via `<canvas>` para `~200 KB` (WebP/JPEG) e **snapshot automático das condições meteorológicas/oceanográficas da hora**. Exportação 100% local em **CSV (com BOM UTF-8 `\uFEFF` para Excel)**, **JSON**, **GPX 1.1**, **GeoJSON (RFC 7946)** e boletim formatado para **WhatsApp (`wa.me`)**.

---

## 4. Passo 1 — Como Rodar Localmente

### Pré-requisitos
- **Node.js** `>= 20.x` (recomendado `v20 LTS` ou `v22/v24`) e **npm**.

### Comandos

```bash
# 1. Instalar todas as dependências
npm install

# 2. Gerar os ícones PNG de alta resolução (PWA e Android) a partir de public/icon.svg
npm run icons:generate

# 3. Validar tipagem estrita TypeScript (0 erros)
npx tsc --noEmit

# 4. Executar a suíte completa de testes unitários e de integração (Vitest)
npm run test

# 5. Iniciar o servidor de desenvolvimento (http://localhost:5173)
npm run dev

# 6. Gerar o bundle de produção PWA em dist/ (com Service Worker e Manifesto)
npm run build

# 7. Testar localmente o bundle de produção PWA (http://127.0.0.1:4173)
npx vite preview --port 4173 --host 127.0.0.1
```

---

## 5. Passo 2 — Publicação Gratuita do PWA (Vercel ou GitHub Pages)

O FieldCast é 100% client-side e não exige backend próprio. Você pode hospedá-lo gratuitamente com HTTPS (requisito para Service Worker, Geolocalização e Wake Lock):

### Opção A — Deploy Gratuito na Vercel (Recomendado)
1. Suba este repositório para a sua conta no GitHub.
2. Acesse [vercel.com](https://vercel.com/) e clique em **Add New... $\rightarrow$ Project**.
3. Importe o repositório do **FieldCast**:
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run icons:generate && npm run build`
   - **Output Directory:** `dist`
4. Clique em **Deploy**. Em menos de 1 minuto seu PWA estará no ar com HTTPS e pronto para instalação no celular ou desktop (*"Adicionar à Tela Inicial"* / *"Instalar Aplicativo"*).

### Opção B — Deploy Gratuito no GitHub Pages
1. No repositório GitHub, vá em **Settings $\rightarrow$ Pages** e em **Build and deployment / Source** selecione **GitHub Actions**.
2. Caso publique em subdiretório (`https://<usuario>.github.io/<repositorio>/`), ajuste `base: './'` no `vite.config.ts` antes do build:
   ```bash
   npm run icons:generate
   npm run build
   ```
3. Publique o conteúdo da pasta `dist/` usando o workflow oficial `actions/deploy-pages@v4` ou via pacote `gh-pages`:
   ```bash
   npx gh-pages -d dist
   ```

---

## 6. Passo 3 — Compilação Local do `.apk` Android via Capacitor

Para compilar o aplicativo Android nativo (`org.fieldcast.app`) em sua máquina local:

### Pré-requisitos Locais
- **Node.js 20+**
- **JDK 21** (Eclipse Temurin recomendado)
- **Android Studio** ou **Android SDK Command-line Tools** (`ANDROID_HOME` configurado)

### Passo a Passo

```bash
# 1. Gerar ícones PNG e compilar o bundle web de produção (dist/)
npm run icons:generate
npm run build

# 2. Adicionar a plataforma Android (apenas na primeira vez)
npx cap add android

# 3. Sincronizar assets web e plugins nativos Capacitor com o projeto Android
npx cap sync android
```

4. **Permissões Android 14+ (`android/app/src/main/AndroidManifest.xml`):**
   Certifique-se de que as permissões abaixo estejam declaradas antes de `</manifest>` (o workflow do GitHub Actions injeta todas automaticamente):
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.WAKE_LOCK" />
   <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
   <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
   <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
   ```

5. **Compilar o `.apk` via Linha de Comando ou Android Studio:**
   - **Via Terminal (Gradle):**
     ```bash
     cd android
     ./gradlew assembleDebug
     ```
     O arquivo instalável será gerado em:
     `android/app/build/outputs/apk/debug/app-debug.apk`
   - **Via Android Studio:**
     ```bash
     npm run cap:android
     ```
     No Android Studio, acesse **Build $\rightarrow$ Build Bundle(s) / APK(s) $\rightarrow$ Build APK(s)**.

---

## 7. Passo 4 — Download do `.apk` Gerado na Nuvem via GitHub Actions

Você **não precisa** instalar o Android Studio localmente para obter o `.apk` do FieldCast. O repositório já inclui o pipeline completo em [`.github/workflows/android-apk.yml`](.github/workflows/android-apk.yml):

1. Faça `git push` para a branch `main` (ou `master`), abra um Pull Request, ou dispare manualmente na aba **Actions $\rightarrow$ Build FieldCast Android APK (Capacitor) $\rightarrow$ Run workflow**.
2. O runner `ubuntu-latest` do GitHub Actions executará automaticamente:
   - Setup do **Node.js 20**, **Java 21 (Temurin)** e **Android SDK**;
   - `npm ci` e `npm run icons:generate`;
   - `npx tsc --noEmit` e `npm run test` (garantindo 100% dos testes antes do empacotamento);
   - `npm run build` e `npx cap add android && npx cap sync android`;
   - Injeção idempotente das permissões Android 14+ de GPS e *Foreground Service* no `AndroidManifest.xml`;
   - `./gradlew assembleDebug --no-daemon`.
3. Ao concluir o job **Build & Package Android Debug APK**:
   - Role até a seção **Artifacts** na página da execução do workflow no GitHub;
   - Clique em **`fieldcast-android-debug-apk`** para baixar o `.zip` contendo o `app-debug.apk` pronto para instalação no seu dispositivo Android.

---

## 8. Estrutura de Diretórios

```text
fieldcast/
├── .agent/
│   ├── rules/fieldcast-standards.md     # Regras de arquitetura, tipagem e governança
│   └── workflows/qa-audit.md            # Roteiro oficial de Auditoria QA
├── .github/
│   └── workflows/android-apk.yml        # Pipeline CI/CD que compila e publica o .apk Android
├── assets/                              # Assets PNG gerados para Capacitor Android
├── docs/
│   ├── SPEC.md                          # Especificação técnica consolidada
│   └── SPRINT_STATUS.md                 # Status das Sprints e Relatório Final de QA
├── public/
│   ├── icon.svg                         # Ícone vetorial oficial de alto contraste
│   └── icons/                           # Ícones PNG 192x192, 512x512 e maskable
├── scripts/
│   └── generate-icons.mjs               # Gerador automatizado de ícones via sharp
├── src/
│   ├── components/
│   │   ├── common/                      # Error Boundaries, Health Check, Glossário, HelpPopover, Toasts
│   │   ├── field/                       # GPS Tracker, Waypoints com Foto, Bússola e Exportação
│   │   ├── forecast/                    # Resumo DEM, Semáforo, Alertas, ECharts 168h, Windguru Table, Efemérides
│   │   ├── layout/                      # AppShell responsivo e Modal de Pontos Salvos / Busca Nominatim
│   │   └── map/                         # Mapa Leaflet CartoDB CORS, Player RainViewer e Área de Missão Offline
│   ├── db/
│   │   └── database.ts                  # Banco IndexedDB (Dexie) e helpers de persistência offline
│   ├── hooks/                           # useTheme, useToast, useSmartLocation (Cascata GPS -> IP -> Cache)
│   ├── services/
│   │   ├── platform/                    # Adaptadores híbridos Capacitor/Web (Tracker, Câmera, Share)
│   │   ├── httpClient.ts                # Circuit Breaker com timeout 10s, retries e validação Zod
│   │   ├── openMeteoService.ts          # Cliente e normalizador multi-modelo Atmosférico + Marinho
│   │   ├── rainViewerService.ts         # Cliente de radar meteorológico RainViewer
│   │   ├── geocodingService.ts          # Cliente Nominatim OSM e fallback ipwho.is
│   │   └── offlineTilesService.ts       # Cache offline de tiles (trava de 300 tiles e 4 downloads simultâneos)
│   ├── test/                            # 9 suítes Vitest (67 testes) + fixtures reais de 48h (Costeiro e Continental)
│   ├── types/                           # Contratos TypeScript e schemas Zod (schemas.ts, weather.ts, field.ts, health.ts)
│   ├── utils/                           # ensembleMath.ts, confidenceIndex.ts, operationalAlerts.ts, exporters.ts, safeAction.ts
│   ├── App.tsx                          # Integração raiz com resiliência Cold-Boot Offline
│   └── main.tsx                         # Ponto de entrada React 18
├── capacitor.config.ts                  # Configuração Capacitor (org.fieldcast.app)
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts                       # Configuração Vite + vite-plugin-pwa + Vitest
```
