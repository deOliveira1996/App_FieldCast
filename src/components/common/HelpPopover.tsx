import React, { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle, Lightbulb, X } from 'lucide-react';

export type HelpTopicId =
  | 'confidence'
  | 'ensemble_vs_native'
  | 'vertical_profile'
  | 'barometric_trend'
  | 'safe_window'
  | 'fog_risk'
  | 'stratified_clouds'
  | 'waves_swell'
  | 'ephemeris';

export interface HelpTopicDefinition {
  title: string;
  summary: string;
  details: string[];
  operationalTip?: string;
}

export const HELP_TOPICS: Record<HelpTopicId, HelpTopicDefinition> = {
  confidence: {
    title: 'Índice de Confiabilidade (0 a 100)',
    summary:
      'Mede o grau de certeza da previsão combinando a concordância entre 3 modelos globais, a saúde das fontes e o horizonte de tempo.',
    details: [
      'Concordância entre Modelos (até 50 pts): Compara ECMWF, GFS e ICON. Quanto menor a dispersão de vento/chuva e maior a coerência direcional vetorial (R → 1), maior a nota.',
      'Integridade e Frescor das Fontes (até 30 pts): Avalia se as APIs responderam em tempo real ou se o cache tem menos de 30 min. Em pontos continentais (sem mar), os pesos são redistribuídos automaticamente sem penalizar a nota.',
      'Horizonte Temporal (até 20 pts): Pontuação máxima nas primeiras 24h, com decaimento gradual de 24h a 72h e mais acentuado após 72h.',
      'Penalidade de Cisalhamento: Aplica desconto caso a interpolação vertical esteja ativa sob perfil de cisalhamento atípico (α fora de 0.05–0.40).',
    ],
    operationalTip:
      'Verde (80–100): Alta convergência entre modelos. Âmbar (50–79): Modelos divergem moderadamente; acompanhe as bandas min/máx. Vermelho (0–49): Alta incerteza; redobre a margem de segurança em campo.',
  },
  ensemble_vs_native: {
    title: 'Modelo FieldCast (Ensemble) vs. Modelos Nativos',
    summary:
      'Alterna entre a fusão estatística inteligente (Ensemble) e a leitura individual de cada centro meteorológico global.',
    details: [
      'Modelo FieldCast (Ensemble): Calcula hora a hora a média, mínimo, máximo e desvio padrão para variáveis escalares, e utiliza decomposição vetorial (u, v) para direções de vento e corrente.',
      'ECMWF IFS 0.25°: Modelo europeu de alta precisão sinótica (fornece vento nativo a 10m e 100m).',
      'NOAA GFS Seamless: Modelo norte-americano com excelente cobertura de visibilidade e vento a 10m, 80m e 120m.',
      'DWD ICON Seamless: Modelo alemão de malha icosaédrica detalhada (vento a 10m, 80m e 120m).',
      'Modo Spaghetti: Sobrepõe as curvas dos 3 modelos no mesmo gráfico para visualizar rapidamente onde eles concordam ou divergem.',
    ],
    operationalTip:
      'Use o Modelo FieldCast para decisão geral e ative o modo Spaghetti quando quiser inspecionar qual modelo puxa o cenário mais extremo.',
  },
  vertical_profile: {
    title: 'Perfil Vertical de Vento (0–120m) & Cisalhamento (α)',
    summary:
      'Mostra como a velocidade do vento varia desde a superfície (10m) até 120m de altura (útil para drones, torres, guindastes e vela oceânica).',
    details: [
      'Níveis Nativos: São os dados brutos calculados diretamente pelos modelos (10m, 80m, 100m e 120m).',
      'Interpolação Estimada (10 em 10m): Quando ativada no Modelo FieldCast, estima os níveis intermediários pela Lei de Potência v(z) = v_ref · (z / z_ref)^α.',
      'Double-Check de Cisalhamento: Se o expoente α calculado ficar abaixo de 0.05 (atmosfera hiper-misturada/inversão) ou acima de 0.40 (cisalhamento severo), um alerta é disparado.',
      'Rajadas (Gusts): Exibidas estritamente a 10m de altura, nunca extrapoladas artificialmente para níveis superiores.',
    ],
    operationalTip:
      'Valores interpolados são sempre sinalizados com o selo "Estimado". Para decisões críticas em altitude, priorize os níveis nativos 80m, 100m e 120m.',
  },
  barometric_trend: {
    title: 'Tendência Barométrica (ΔP / 3h)',
    summary:
      'Monitora variações rápidas na pressão atmosférica ao nível da superfície para antecipar frentes frias e linhas de instabilidade (squalls).',
    details: [
      'Gatilho Operacional: Uma queda superior a 4 hPa em um intervalo de 3 horas (ΔP / 3h < -4 hPa) dispara alerta imediato.',
      'Significado Físico: Quedas bruscas de pressão indicam aproximação rápida de cavados, frentes ou tempestades convectivas com entrada repentina de rajadas.',
    ],
    operationalTip:
      'Se o alerta barométrico estiver ativo, antecipe o recolhimento de equipamentos sensíveis mesmo que o vento atual ainda pareça calmo.',
  },
  safe_window: {
    title: 'Semáforo de Janela Segura (Configurável)',
    summary:
      'Classifica automaticamente cada hora das próximas 168h em Verde, Amarelo ou Vermelho segundo os limites da sua operação.',
    details: [
      'Verde (Janela Segura): Vento, rajadas, ondas e probabilidade de chuva estão confortavelmente abaixo dos seus limites configurados.',
      'Amarelo (Atenção / Margem Limite): Pelo menos um parâmetro atingiu 80% ou mais do limite configurado, ou há risco moderado.',
      'Vermelho (Fora dos Limites): Um ou mais parâmetros ultrapassaram o teto operacional configurado.',
    ],
    operationalTip:
      'Clique em "Configurar Limites" para ajustar os tetos de vento (km/h), rajada (km/h), onda (m) e probabilidade de chuva (%) ao seu equipamento ou embarcação.',
  },
  fog_risk: {
    title: 'Alerta de Nevoeiro e Baixa Visibilidade',
    summary:
      'Combina visibilidade horizontal estimada com a proximidade entre temperatura do ar e ponto de orvalho (Dew Point Spread).',
    details: [
      'Gatilho Cruzado: Disparado quando a visibilidade cai abaixo de 1000m E o spread (Temperatura 2m − Ponto de Orvalho 2m) é inferior a 2 °C.',
      'Quando o ar esfria até quase atingir o ponto de orvalho, o vapor condensa formando nevoeiro denso ou neblina costeira.',
    ],
    operationalTip:
      'Crítico para navegação visual, operação de VANTs/drones e deslocamento em trilhas ou rodovias serranas.',
  },
  stratified_clouds: {
    title: 'Nebulosidade Estratificada (Baixa, Média e Alta)',
    summary:
      'Separa a cobertura de nuvens em três camadas atmosféricas para avaliar teto operacional, radiação solar e potencial de chuva.',
    details: [
      'Nuvens Baixas (0–2 km): Stratus, Cumulus e Stratocumulus. Afetam diretamente o teto visual, nevoeiro de encosta e garoa.',
      'Nuvens Médias (2–6 km): Altostratus e Altocumulus. Indicam transição sinótica e redução moderada de insolação.',
      'Nuvens Altas (> 6 km): Cirrus e Cirrostratus. Nuvens finas de cristais de gelo; raramente bloqueiam operações visuais, mas podem anteceder frentes.',
    ],
    operationalTip:
      'Céu com 90% de nuvens altas (Cirrus) ainda permite boa visibilidade e iluminação em campo, enquanto 90% de nuvens baixas indica teto fechado.',
  },
  waves_swell: {
    title: 'Ondas Significativas, Swell e Corrente Oceânica',
    summary:
      'Dados da grade oceanográfica Open-Meteo Marine para pontos costeiros e marítimos.',
    details: [
      'Altura Significativa de Onda (m): Média do terço maior das ondas combinando vaga local (gerada pelo vento local) e ondulação distante.',
      'Swell (Ondulação de Fundo): Ondas geradas por sistemas distantes, caracterizadas por período mais longo (s) e maior energia na costa.',
      'Detecção Continental: Em cidades no interior (terra firme), a grade marinha não se aplica e o sistema exibe um aviso informativo sem descontar pontos de confiabilidade.',
    ],
    operationalTip:
      'Atenção especial quando a direção do vento local for oposta à direção do Swell ou da corrente oceânica, pois isso gera mar curto e íngreme.',
  },
  ephemeris: {
    title: 'Efemérides Solares e Lunares (100% Offline)',
    summary:
      'Calculadas localmente no dispositivo via algoritmos astronômicos (SunCalc) para a coordenada e fuso horário ativos.',
    details: [
      'Crepúsculo Civil: Sol até 6° abaixo do horizonte — ainda há luz natural suficiente para atividades ao ar livre sem iluminação artificial.',
      'Crepúsculo Náutico: Sol entre 6° e 12° abaixo do horizonte — horizonte marítimo ainda distinguível para navegação.',
      'Fase e Iluminação Lunar: Percentual do disco lunar iluminado, essencial para operações noturnas e amplitude de marés (sizígia vs. quadratura).',
    ],
    operationalTip:
      'Planeje o retorno de campo antes do fim do Crepúsculo Civil para evitar desmontagem de equipamentos no escuro.',
  },
};

export interface HelpPopoverProps {
  topic?: HelpTopicId;
  title?: string;
  summary?: string;
  details?: string[];
  operationalTip?: string;
  label?: string;
  align?: 'left' | 'right';
  className?: string;
}

export const HelpPopover: React.FC<HelpPopoverProps> = ({
  topic,
  title,
  summary,
  details,
  operationalTip,
  label,
  align = 'right',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const preset = topic ? HELP_TOPICS[topic] : undefined;
  const resolvedTitle = title ?? preset?.title ?? 'Ajuda Contextual';
  const resolvedSummary =
    summary ?? preset?.summary ?? 'Explicação operacional simplificada deste indicador.';
  const resolvedDetails = details ?? preset?.details ?? [];
  const resolvedTip = operationalTip ?? preset?.operationalTip;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        aria-expanded={isOpen}
        aria-controls={popoverId}
        aria-label={label ?? `Ajuda sobre ${resolvedTitle}`}
        title={`Ajuda: ${resolvedTitle}`}
        className="min-h-[44px] min-w-[44px] p-2 rounded-xl inline-flex items-center justify-center text-slate-600 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 hover:bg-slate-200/70 dark:hover:bg-slate-800/80 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        <HelpCircle className="w-4 h-4" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={resolvedTitle}
          onClick={(e) => e.stopPropagation()}
          className={`absolute z-50 top-full mt-1.5 w-80 sm:w-96 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl p-4 space-y-3 text-left ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <div className="flex items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
              <h4 className="text-sm font-bold leading-snug">{resolvedTitle}</h4>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Fechar ajuda"
              className="min-h-[44px] min-w-[44px] -m-2 rounded-xl inline-flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <p className="text-xs font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
            {resolvedSummary}
          </p>

          {resolvedDetails.length > 0 && (
            <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4 leading-relaxed">
              {resolvedDetails.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          )}

          {resolvedTip && (
            <div className="rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800/70 p-2.5 flex items-start gap-2 text-xs text-sky-950 dark:text-sky-200">
              <Lightbulb className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">
                <strong>Dica de Campo:</strong> {resolvedTip}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
