# V4.1 — FIELDCAST (PROMPT CONSOLIDADO DE EVOLUÇÃO)

> Aprovado pelo usuário em 25/11/2026 com base nas invariantes de `AGENTS.md` e `.agents/rules/fieldcast-standards.md`.

## Escopo Integrado
1. **Arquitetura Colapsável Universal (`CollapsibleModule`) & Densidade de Tela**:
   - Cartões recolhíveis (`aria-expanded`, ícone discreto de hide/show, resumo compacto) aplicados em Resumo, Modelos, Navegação, Aeronáutica, Armazenamento, Relatórios e Configurações.
   - Barra lateral desktop em `AppShell.tsx` recolhida para `0px` mantendo apenas seta flutuante (`>`), com ícones/paddings enxutos em mobile e desktop.
   - Remoção do mini-mapa duplicado do final de `DailySummaryTab.tsx`.
2. **Matriz Comparativa & Tabela Windguru**:
   - Abertura automática horizontal (`container.scrollLeft`, zero `scrollIntoView`) no horário local atual em `WindguruTable.tsx`, preservando horas anteriores à esquerda.
   - Sincronização do botão central do stepper horário (`< Hora >`) em `ModelComparisonTab.tsx` com retorno rápido para `Agora`.
3. **Mapa Interativo, Vento Streamlines & Tela Cheia Sem Sobreposição**:
   - Gaveta fechada por padrão (`isSidebarOpen = false`), botão dedicado de ocultar/mostrar HUD, botões compactos icon-only e layout flex não-sobreposto em tela cheia.
   - Camada de fluxo de vento animada estilo `streamlines` sobre vetores `u/v` Open-Meteo em `WeatherModelOverlayLayer.tsx` com cache offscreen suave e play temporal do modelo.
4. **Configurações Modulares, Checkboxes Opcionais & Escalas Globais**:
   - `SettingsTab.tsx` em módulos colapsáveis (Escalas, Permissões Gerais, Templates, Criador de Alerta, Alertas Ativos, Scores).
   - Checkboxes opcionais por parâmetro em alertas customizados, scores de qualidade (`daily_field`, `coastal_navigation`), `SafeWindowThresholds`, `NavigationQualityLimits` e `DroneFlightLimits` (parâmetros desmarcados ignorados sem penalidade).
   - Escalas globais (`src/utils/units.ts` + `UnitsContext`): Vento (`km/h`, `m/s`, `kt`, `mph`), Temperatura (`°C`, `°F`), Ondas (`m`, `ft`), Pressão (`hPa`, `inHg`) e Chuva (`mm`, `in`).
5. **Relatórios Técnicos Estendidos (15d Pretérito, Consulta Pontual & Projeção +15/16d)**:
   - Visão pretérita 15 dias combinando ERA5 Archive + NWP recente por 4 faixas horárias (`Madrugada 00–05h`, `Manhã 06–11h`, `Tarde 12–17h`, `Noite 18–23h`).
   - Consulta pontual por data passada única com log diário/horário completo.
   - Projeção futura sob demanda (`forecast_days=16`) pelas 4 faixas horárias com aviso explícito de habilidade reduzida e predominância GFS após o dia `+7`.
