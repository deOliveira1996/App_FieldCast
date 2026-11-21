# SPRINT 3A — MAPA INTERATIVO, RADAR RAINVIEWER & CACHE OFFLINE (SWARM PARALELO)

Leia `@.agent/rules/fieldcast-standards.md` (Regra 5 Anti-Colisão), `@docs/SPEC.md` e `@docs/handoff_2a.md`.

## Write-Scope Estrito (RESPEITO OBRIGATÓRIO)
- **PERMITIDO criar/editar:** `src/components/map/*`, `src/services/offlineTilesService.ts`, `src/test/offlineTiles.test.ts`, `docs/handoff_3a.md`.
- **PROIBIDO editar:** `package.json`, `src/types/*`, `src/components/field/*`, `src/services/platform/*`, `src/App.tsx`, `docs/SPRINT_STATUS.md`.

## Entregáveis
1. `src/services/offlineTilesService.ts`:
   - Gerenciador de download de área retangular (bounding box + níveis de zoom) salvando blobs de tiles no IndexedDB (`dexie`).
   - Trava rígida de **no máximo 300 tiles por missão** e fila com **no máximo 4 downloads simultâneos**, progresso em tempo real, cancelamento via `AbortController` e tratamento gracioso de erros de rede/CORS.
   - Subclasse customizada de `L.TileLayer` sobrescrevendo `createTile()` para ler primeiro do Dexie e cair na rede CartoDB CORS (`crossOrigin: 'anonymous'`) caso não esteja em cache.
2. `src/components/map/MapRadarTab.tsx` (encapsulado em `<ModuleErrorBoundary>`):
   - Mapa Leaflet responsivo usando CartoDB Voyager (tema Claro) e DarkMatter (tema Escuro).
   - Sobreposição de radar animado RainViewer com player (**Play/Pause**, slider temporal e timestamp do frame) e aviso não-bloqueante caso RainViewer esteja degradado.
   - Renderização de marcador do ponto ativo, pontos salvos, waypoints e trilhas (tracks) gravadas.
   - Ferramenta **Área de Missão Offline**: seleção de retângulo no mapa, estimativa prévia de quantidade de tiles (bloqueando se > 300), botão de download via `safeAction`, barra de progresso e listagem/limpeza do cache salvo.
3. Teste unitário em `src/test/offlineTiles.test.ts` validando o cálculo de tiles, a trava de 300 tiles e o limite de concorrência.

## Validação e Handoff
- Execute `npx vitest run src/test/offlineTiles.test.ts`.
- Salve props e instruções de integração em `docs/handoff_3a.md`.