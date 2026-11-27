# FieldCast V4.3 — Guia de Distribuição & Empacotamento / Distribution & Packaging Guide

O **FieldCast** é 100% open-source, offline-first e **zero backend** (sem chaves de API pagas e sem servidores proprietários). Você pode distribuir o aplicativo gratuitamente como **PWA estático (Web/Mobile)**, **APK Android nativo (Capacitor 6)** ou **aplicativo Desktop offline (Windows `.exe` / macOS `.dmg`)**.

**FieldCast** is 100% open-source, offline-first, and **zero-backend** (no paid API keys or proprietary servers). You can distribute it at zero cost as a **static PWA (Web/Mobile)**, a **native Android APK (Capacitor 6)**, or an **offline Desktop app (Windows `.exe` / macOS `.dmg`)**.

---

## 1. Hospedagem Gratuita de PWA Estático / Free Static PWA Hosting

### 1.1 GitHub Pages (Deploy 1-Clique / 1-Click Deploy)
O repositório já inclui o workflow [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml):

1. No repositório do GitHub, acesse **Settings → Pages → Build and deployment → Source** e selecione **GitHub Actions**.
2. Faça `git push` na branch `main` (ou execute manualmente em **Actions → Deploy FieldCast PWA to GitHub Pages → Run workflow**).
3. O workflow executa automaticamente:
   ```bash
   npm ci
   VITE_BASE_PATH="/<nome-do-repo>/" npm run build
   ```
4. O PWA ficará disponível em `https://<usuario>.github.io/<nome-do-repo>/` com HTTPS nativo (obrigatório para GPS, Service Worker offline e instalação "Adicionar à Tela Inicial").

> **Build local para subcaminho / Local subpath build:**
> - PowerShell: `$env:VITE_BASE_PATH="/FieldCast/"; npm run build:pages`
> - Bash/macOS/Linux: `VITE_BASE_PATH="/FieldCast/" npm run build:pages`

### 1.2 Cloudflare Pages (Zero Custo / Zero Cost)
1. Conecte o repositório no dashboard do **Cloudflare Pages** (plano gratuito ilimitado para sites estáticos).
2. Configure:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Environment variable:** `VITE_BASE_PATH=/`
3. O deploy gera HTTPS automático em `*.pages.dev` (ou domínio próprio).

> **Nota sobre Alertas no Navegador (Web/PWA):** Sem servidor Push pago, navegadores desktop/mobile avaliam regras e alertas enquanto a aba/PWA estiver aberta. Para alertas contínuos em segundo plano com o aplicativo fechado ou tela bloqueada, utilize o APK Android nativo abaixo.

---

## 2. Aplicativo Android Nativo (APK — Capacitor 6)

O build Android inclui:
- **Foreground Location Service (Android 14+)** para rastreamento GPS de rotas com filtro `<= 20 m`.
- **Motor Nativo de Alertas em Segundo Plano**: `AlarmManager` (`FieldCastAlertAlarmReceiver`), reinicialização pós-boot (`FieldCastBootReceiver`) e verificação periódica via `WorkManager` (`FieldCastBackgroundCheckWorker`) consultando Open-Meteo Forecast/Marine diretamente mesmo com o app fechado.

### Compilação Local (Windows PowerShell)
```powershell
npm run icons:generate
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```
O APK compilado estará em `android/app/build/outputs/apk/debug/app-debug.apk`.

### Permissões Recomendadas no Android (Configurações → Alertas em Segundo Plano)
1. **Notificações (`POST_NOTIFICATIONS`)**: obrigatória no Android 13+.
2. **Alarmes Exatos (`SCHEDULE_EXACT_ALARM`)**: opcional no Android 12+; garante disparo pontual (se não concedida, o FieldCast faz fallback automático para `setAndAllowWhileIdle`).
3. **Isenção de Otimização de Bateria (Doze Mode)**: recomendada para manter o `WorkManager` periódico ativo com a tela bloqueada.

---

## 3. Aplicativo Desktop Offline (Windows `.exe` & macOS `.dmg`)

O wrapper desktop em [`desktop/electron/`](../desktop/electron/) utiliza **Electron** open-source com endurecimento de segurança (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`) carregando diretamente o bundle local `dist/index.html`.

### 3.1 Preparação e Empacotamento no Windows (`.exe` Portátil e Instalador NSIS)
```powershell
# 1) Apenas compila dist/ (base ./) e sincroniza para desktop/electron/dist/
npm run desktop:prepare

# 2) Compila dist/ + instala dependências Electron + gera .exe portátil e instalador NSIS
.\scripts\package-desktop.ps1 -BuildInstaller
```
Os executáveis gerados ficam em `desktop/electron/release/`:
- `FieldCast 4.3.0.exe` (Portátil — roda direto sem instalação / Portable)
- `FieldCast Setup 4.3.0.exe` (Instalador NSIS / Installer)

### 3.2 Empacotamento no macOS (`.dmg` Universal / Apple Silicon & Intel)
Execute em um Mac (macOS 12+ com Xcode Command Line Tools):
```bash
VITE_BASE_PATH="./" npm run build
rm -rf desktop/electron/dist && cp -R dist desktop/electron/dist
cd desktop/electron
npm install
npm run pack:mac
```
O instalador `.dmg` será gerado em `desktop/electron/release/`.

### 3.3 Alternativa Ultraleve Opcional: Tauri v2 (Rust + WebView2 / WKWebView)
Caso prefira binários menores (~10–15 MB) usando o WebView nativo do sistema operacional:
1. Instale Rust (`rustup`) e o CLI open-source `@tauri-apps/cli`.
2. Inicialize em uma pasta separada (`npx tauri init`) apontando `frontendDist` para `../dist` e `beforeBuildCommand` para `VITE_BASE_PATH=./ npm run build`.
3. Execute `npx tauri build` para gerar `.msi`/`.exe` (Windows) ou `.dmg`/`.app` (macOS).

---

## 4. Avisos Operacionais Obrigatórios / Mandatory Operational Notices
- **Marés / Oceanografia**: Estimativas de nível do mar MSL (`sea_level_height_msl`, ~8 km Open-Meteo Marine) são referência hidrodinâmica indicativa e **NÃO substituem** as tábuas de marés oficiais da **DHN / Marinha do Brasil** nem cartas náuticas oficiais.
- **Aeronáutica / VANT**: Dados verticais e alertas de cisalhamento (10 m–1000 m) são suporte tático complementar e **NÃO substituem** briefings oficiais **REDEMET / DECEA** (METAR/TAF/NOTAM/SIGMET).
- **Altitude Topográfica**: Sempre proveniente do DEM Open-Meteo (`elevation`), nunca sobrescrita pela altitude do GPS do dispositivo.
