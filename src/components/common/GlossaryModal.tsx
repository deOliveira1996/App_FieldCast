import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Compass,
  Gauge,
  Layers,
  Search,
  ShieldCheck,
  Sun,
  Waves,
  Wind,
  X,
} from 'lucide-react';
import { HELP_TOPICS, type HelpTopicId } from './HelpPopover';

export interface GlossaryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface GlossaryEntry {
  id: string;
  category: 'modelos' | 'confianca' | 'alertas' | 'marinho' | 'campo';
  title: string;
  badge: string;
  summary: string;
  bullets: string[];
  tip?: string;
}

const TOPIC_TO_CATEGORY: Record<HelpTopicId, GlossaryEntry['category']> = {
  ensemble_vs_native: 'modelos',
  vertical_profile: 'modelos',
  confidence: 'confianca',
  safe_window: 'alertas',
  barometric_trend: 'alertas',
  fog_risk: 'alertas',
  stratified_clouds: 'alertas',
  waves_swell: 'marinho',
  ephemeris: 'campo',
};

const TOPIC_BADGES: Record<HelpTopicId, string> = {
  ensemble_vs_native: 'Multi-Modelo (ECMWF + GFS + ICON)',
  vertical_profile: '10m a 120m + Lei de Potência α',
  confidence: 'Score 0–100 Auditável',
  safe_window: 'Verde / Amarelo / Vermelho',
  barometric_trend: 'ΔP / 3h > 4 hPa',
  fog_risk: 'Visibilidade < 1km & Spread < 2°C',
  stratified_clouds: 'Baixa / Média / Alta',
  waves_swell: 'Open-Meteo Marine Grid',
  ephemeris: 'SunCalc 100% Offline',
};

const FIELD_EXTRA_ENTRIES: GlossaryEntry[] = [
  {
    id: 'field_workflow',
    category: 'campo',
    title: 'Fluxo Rápido de Operação em Campo & Offline',
    badge: 'PWA & Android Nativo',
    summary:
      'Como preparar e executar uma missão sem conexão de internet utilizando os recursos integrados do FieldCast.',
    bullets: [
      '1. Salve seus Pontos de Missão: No seletor do topo, busque ou insira coordenadas e favorite seus locais. A última previsão de 168h fica salva no IndexedDB.',
      '2. Baixe o Mapa da Área de Missão: Na aba "Mapa & Radar", selecione um retângulo de missão para guardar até 300 tiles CartoDB com suporte offline.',
      '3. Grave Rotas (GPS Tracker) e Waypoints: Na aba "Campo & Dados", registre waypoints com foto comprimida (~200 KB) e snapshot automático de vento, pressão e onda do momento.',
      '4. Exporte sem Servidor: Exporte relatórios e trilhas em CSV (UTF-8 com BOM para Excel), JSON, GPX ou GeoJSON diretamente pelo dispositivo.',
    ],
    tip: 'Em ambiente sob sol forte, alterne para o Tema Claro (Alto Contraste Solar) no cabeçalho para leitura imediata.',
  },
  {
    id: 'circular_math',
    category: 'modelos',
    title: 'Média Circular Vetorial (Direção de Vento e Corrente)',
    badge: 'Decomposição u, v & Coerência R',
    summary:
      'Por que o FieldCast nunca faz média aritmética simples entre direções em graus (ex.: 350° e 10°).',
    bullets: [
      'Média aritmética comum entre 350° (Norte) e 10° (Norte) daria 180° (Sul — erro grave de 180°).',
      'O FieldCast decompõe cada vetor nas componentes zonais e meridionais (u = -v·sin θ, v = -v·cos θ) e reconstrói o ângulo verdadeiro via atan2(-u_médio, -v_médio) → 0° (Norte).',
      'O comprimento resultante médio unitário R ∈ [0, 1] mede a coerência direcional pura entre os modelos: R ≈ 1 indica alinhamento total; R ≈ 0 indica direções opostas.',
    ],
    tip: 'Quando R é baixo, o Índice de Confiabilidade reduz os pontos de concordância e alerta sobre incerteza de direção.',
  },
];

const ALL_ENTRIES: GlossaryEntry[] = [
  ...FIELD_EXTRA_ENTRIES,
  ...(Object.keys(HELP_TOPICS) as HelpTopicId[]).map((topicId) => {
    const t = HELP_TOPICS[topicId];
    return {
      id: topicId,
      category: TOPIC_TO_CATEGORY[topicId],
      title: t.title,
      badge: TOPIC_BADGES[topicId],
      summary: t.summary,
      bullets: t.details,
      tip: t.operationalTip,
    };
  }),
];

export const GlossaryModal: React.FC<GlossaryModalProps> = ({ isOpen, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'todos' | GlossaryEntry['category']>(
    'todos',
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredEntries = ALL_ENTRIES.filter((entry) => {
    const matchesCategory = activeCategory === 'todos' || entry.category === activeCategory;
    if (!matchesCategory) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return (
      entry.title.toLowerCase().includes(normalizedQuery) ||
      entry.summary.toLowerCase().includes(normalizedQuery) ||
      entry.badge.toLowerCase().includes(normalizedQuery) ||
      entry.bullets.some((b) => b.toLowerCase().includes(normalizedQuery))
    );
  });

  const categories: Array<{
    id: 'todos' | GlossaryEntry['category'];
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'todos', label: 'Todos', Icon: BookOpen },
    { id: 'campo', label: 'Guia de Campo', Icon: Compass },
    { id: 'modelos', label: 'Modelos & Perfil Vertical', Icon: Wind },
    { id: 'confianca', label: 'Confiabilidade', Icon: ShieldCheck },
    { id: 'alertas', label: 'Alertas & Semáforo', Icon: Gauge },
    { id: 'marinho', label: 'Ondas & Marinho', Icon: Waves },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="glossary-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30">
              <BookOpen className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2 id="glossary-modal-title" className="text-lg md:text-xl font-bold">
                Guia Rápido & Glossário Operacional
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Referência rápida em português simples para tomada de decisão meteorológica e
                oceanográfica em campo
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Guia Rápido e Glossário"
            className="min-h-[44px] min-w-[44px] rounded-xl inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Search & Category Filter */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3 bg-white dark:bg-slate-900">
          <div className="relative">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar termo (ex.: Cisalhamento, Ensemble, Barômetro, Swell, Nevoeiro, Offline)..."
              aria-label="Filtrar termos do glossário"
              className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1">
            {categories.map(({ id, label, Icon }) => {
              const isActive = activeCategory === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveCategory(id)}
                  className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 shrink-0 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    isActive
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content List */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 scrollbar-thin flex-1">
          {filteredEntries.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <Layers className="w-10 h-10 text-slate-400 mx-auto" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Nenhum tópico encontrado para &ldquo;{searchQuery}&rdquo;.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setActiveCategory('todos');
                }}
                className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 text-white hover:bg-sky-500 transition-colors"
              >
                Limpar Filtro
              </button>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <article
                key={entry.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 sm:p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {entry.title}
                  </h3>
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/15 text-sky-800 dark:text-sky-300 border border-sky-500/30">
                    {entry.badge}
                  </span>
                </div>

                <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
                  {entry.summary}
                </p>

                <ul className="space-y-1.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300 list-disc pl-5 leading-relaxed">
                  {entry.bullets.map((bullet, idx) => (
                    <li key={idx}>{bullet}</li>
                  ))}
                </ul>

                {entry.tip && (
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-amber-950 dark:text-amber-200">
                    <Sun
                      className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <span>
                      <strong>Recomendação Prática:</strong> {entry.tip}
                    </span>
                  </div>
                )}
              </article>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            FieldCast — Resolução horária 168h (7 dias) • Altitude DEM Open-Meteo
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] px-5 py-2 rounded-xl text-sm font-bold bg-slate-900 dark:bg-sky-600 text-white hover:opacity-95 transition-opacity focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
};
