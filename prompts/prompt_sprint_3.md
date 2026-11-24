> **[ARQUIVO HISTÓRICO LEGADO]** Substituído pelo pipeline paralelo `prompt_sprint_3a.md` + `prompt_sprint_3b.md` + `prompt_sprint_3c.md` e pelas skills modulares em `.agents/skills/`. Mantido apenas para referência.

Siga `@.agent/rules/fieldcast-standards.md` e `@docs/SPEC.md`.
Conecte as camadas da Sprint 2A (Core/Serviços/Dexie) e Sprint 2B (UI) e implemente todas as funcionalidades de campo:

1. **Integração de Dados:** Substitua eventuais mocks da UI pelos serviços reais, Circuit Breaker, cache Dexie, timestamp *"Atualizado às HH:MM"* e dados reais no painel de Health Check.
2. **Adaptadores Híbridos (`src/services/platform/`):** Detecção `Capacitor.isNativePlatform()` para câmera, compartilhamento e GPS.
3. **Geolocalização em Cascata (`useSmartLocation.ts`):** GPS (8s) -> `ipwho.is` (*"Aproximado via IP"*) -> último ponto Dexie + busca Nominatim com envio explícito/debounce >= 1s.
4. **Aba Mapa & Radar:** Mapa Leaflet com tiles CartoDB CORS, radar RainViewer animado com player temporal (estado degradado âmbar se indisponível), visualização de tracks/waypoints e **Download de Área de Missão Offline** via subclasse customizada de `L.TileLayer` no Dexie (máximo 300 tiles, 4 requisições simultâneas, barra de progresso e aviso de erro CORS).
5. **Aba Campo & Dados:**
   - `LocationTrackerService`: Foreground Service (Android) / `watchPosition` + `Screen Wake Lock API` + banner (Web), filtro de acurácia `> 20m`.
   - Waypoints com foto comprimida via `<canvas>` (~200 KB WebP/JPEG) e snapshot automático das condições atuais.
   - Bússola de Vento e Onda Relativa: iOS (`DeviceOrientationEvent.requestPermission()` + `webkitCompassHeading`), Android (`deviceorientationabsolute`), oculta em desktops sem sensor.
   - Exportação (CSV BOM UTF-8, JSON, GPX, GeoJSON) e Compartilhamento (Capacitor/Web Share no mobile; download + link `wa.me` no desktop).

Critério de saída: `npx tsc --noEmit`, `npm run test` e `npm run build` com 0 erros.