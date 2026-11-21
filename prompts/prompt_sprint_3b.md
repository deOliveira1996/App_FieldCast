# SPRINT 3B — CAMPO, ADAPTADORES HÍBRIDOS, TRACKER, WAYPOINTS & BÚSSOLA (SWARM PARALELO)

Leia `@.agent/rules/fieldcast-standards.md` (Regra 5 Anti-Colisão), `@docs/SPEC.md` e `@docs/handoff_2a.md`.

## Write-Scope Estrito (RESPEITO OBRIGATÓRIO)
- **PERMITIDO criar/editar:** `src/services/platform/*`, `src/hooks/useSmartLocation.ts`, `src/components/field/*`, `src/test/fieldOps.test.ts`, `docs/handoff_3b.md`.
- **PROIBIDO editar:** `package.json`, `src/types/*`, `src/components/map/*`, `src/services/offlineTilesService.ts`, `src/App.tsx`, `docs/SPRINT_STATUS.md`.

## Entregáveis
1. `src/services/platform/` (detecção via `Capacitor.isNativePlatform()`):
   - `LocationTrackerService.ts`: Android via adaptador para Foreground Service com notificação persistente (*"FieldCast: Gravando rota..."*), filtrando acurácia `> 20m`; Web via `navigator.geolocation.watchPosition` + `Screen Wake Lock API` + estado de aviso para manter tela ligada.
   - `CameraService.ts`: Capacitor Camera no Android / `<input type="file" capture="environment">` na Web + compressão automática via `<canvas>` para ~200 KB (WebP/JPEG).
   - `ShareService.ts`: Capacitor Share / Web Share API no mobile (anexando arquivos); Desktop fazendo download local + link `https://wa.me/?text=...` com resumo formatado.
2. `src/hooks/useSmartLocation.ts`:
   - Geolocalização em cascata: (1) GPS (timeout 8s) -> (2) `https://ipwho.is/` (flag *"Aproximado via IP"*) -> (3) última coordenada no Dexie.
3. `src/components/field/FieldDataTab.tsx` (com `<ModuleErrorBoundary>` por sub-módulo):
   - **Painel GPS Tracker:** iniciar/pausar/encerrar gravação de rota, distância acumulada (Haversine), acurácia atual e banner Wake Lock na Web.
   - **Waypoints Georreferenciados:** formulário para criar waypoint com nota, foto comprimida e **snapshot automático das condições meteorológicas/oceanográficas** do momento + galeria offline.
   - **Bússola de Vento e Onda Relativa (`WindCompass.tsx`):** iOS com botão explícito chamando `DeviceOrientationEvent.requestPermission()` + `webkitCompassHeading`; Android via `deviceorientationabsolute`; oculta automaticamente em desktops sem sensor.
   - **Central de Exportação & Compartilhamento:** botões `safeAction` para exportar previsões horárias, waypoints e tracks em **CSV (BOM UTF-8)**, **JSON**, **GPX** e **GeoJSON**.
4. Testes unitários em `src/test/fieldOps.test.ts` cobrindo filtro de acurácia (`> 20m`), fallback em cascata de localização e geração do link `wa.me`.

## Validação e Handoff
- Execute `npx vitest run src/test/fieldOps.test.ts`.
- Salve props e instruções de integração em `docs/handoff_3b.md`.