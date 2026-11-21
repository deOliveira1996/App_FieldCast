# SPRINT 2A — CORE MATEMÁTICO, SERVIÇOS, DEXIE & VITEST (SWARM PARALELO)

Leia `@.agent/rules/fieldcast-standards.md` (especialmente Regra 5 Anti-Colisão) e `@docs/SPEC.md`.

## Write-Scope Estrito (RESPEITO OBRIGATÓRIO)
- **PERMITIDO criar/editar:** `src/utils/*` (EXCETO `safeAction.ts`), `src/services/httpClient.ts`, `src/services/openMeteoService.ts`, `src/services/rainViewerService.ts`, `src/services/geocodingService.ts`, `src/db/*`, `src/test/*.test.ts`, `docs/handoff_2a.md`.
- **PROIBIDO editar:** `package.json`, `src/types/*`, `src/utils/safeAction.ts`, `src/components/*`, `src/App.tsx`, `docs/SPRINT_STATUS.md`.

## Entregáveis
1. `src/utils/ensembleMath.ts`:
   - Modelos nativos (ECMWF, GFS, ICON, Spaghetti) vs. *Modelo FieldCast* (escalares ignorando `null` + decomposição vetorial $u/v$ e comprimento unitário $R \in [0,1]$ para ângulos circulares).
   - Perfil vertical (0m–120m): níveis nativos primários + interpolação opcional de 10 em 10m via Lei de Potência com Double-Check ($\alpha < 0.05$ ou $\alpha > 0.40$ -> alerta de cisalhamento atípico). Rajadas estritamente em `10m`.
2. `src/utils/confidenceIndex.ts`:
   - Score horário e geral `0–100` (Concordância 50 + Integridade/Frescor 30 + Horizonte 20 - penalidade de cisalhamento), aplicando a **regra continental** (sem penalizar ausência de grade marinha em terra firme).
3. `src/utils/operationalAlerts.ts`:
   - Semáforo configurável (Verde/Amarelo/Vermelho), tendência barométrica ($\Delta P / 3\text{h} > 4\text{ hPa}$), alerta de nevoeiro (`visibility < 1000m` + *dew point spread* `< 2 °C`), nebulosidade estratificada e efemérides offline (`suncalc`).
4. `src/utils/exporters.ts`:
   - Geradores puros para **CSV com BOM UTF-8 (`\uFEFF`)**, **JSON**, **GPX** e **GeoJSON** + cálculo Haversine.
5. `src/db/database.ts`:
   - Banco Dexie para `savedLocations`, `forecastCache`, `waypoints`, `tracks`, `offlineTiles` e `errorLogs`.
6. `src/services/httpClient.ts` e clientes de API (`openMeteoService.ts`, `rainViewerService.ts`, `geocodingService.ts`):
   - Timeout 10s (`AbortController`), 2 retries com backoff exponencial, validação `zod`, Circuit Breaker (abre após 3 falhas consecutivas -> fallback automático Dexie) e parsing usando `timeformat=unixtime&timezone=auto`.
   - Nominatim com proteção contra rate-limit e RainViewer com degradação graciosa.
7. **Suíte Vitest Completa (`src/test/`):**
   - Cubra todos os critérios da Seção 7.4 de `docs/SPEC.md` + parsing real dos fixtures de `src/test/fixtures/`.

## Validação e Handoff
- Execute `npx vitest run src/test/` (100% aprovado).
- Salve seu resumo, funções exportadas e resultado dos testes em `docs/handoff_2a.md`.