import React, { useEffect, useMemo, useState } from 'react';
import {
  BellPlus,
  BookOpen,
  CheckCircle2,
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
import { useLocale, type AppLocale } from '../../context/LocaleContext';
import {
  loadNotificationPreferences,
  NOTIFICATION_RULE_TEMPLATES,
  saveNotificationPreferences,
} from '../../services/notificationService';
import type {
  CustomNotificationRule,
  NotificationRuleTemplate,
  UserNotificationPreferences,
} from '../../types/v4';
import { HELP_TOPICS, HELP_TOPICS_EN, type HelpTopicId } from './HelpPopover';

export interface GlossaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivateTemplate?: (
    template: NotificationRuleTemplate,
    updatedPrefs: UserNotificationPreferences,
  ) => void;
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
  model_dispersion: 'modelos',
  confidence: 'confianca',
  confidence_agreement: 'confianca',
  confidence_integrity: 'confianca',
  confidence_proximity: 'confianca',
  confidence_vertical: 'confianca',
  safe_window: 'alertas',
  barometric_trend: 'alertas',
  fog_risk: 'alertas',
  stratified_clouds: 'alertas',
  alerts_builder_help: 'alertas',
  waves_swell: 'marinho',
  ephemeris: 'campo',
  summary_overview: 'campo',
  report_studio_overview: 'campo',
  report_water_balance: 'campo',
  report_gdd: 'campo',
  report_vector_r: 'modelos',
  report_zscore_ols: 'modelos',
  report_era5_hybrid: 'campo',
  report_16d_projection: 'modelos',
  route_planning_4d: 'campo',
  goes_satellite: 'modelos',
  ground_truth_validation: 'confianca',
  bessel_robust_stats: 'modelos',
  tide_alerts_dhn: 'marinho',
  background_alerts_android: 'alertas',
};

const TOPIC_BADGES: Record<HelpTopicId, string> = {
  ensemble_vs_native: 'Multi-Modelo (ECMWF + GFS + ICON + GEM)',
  vertical_profile: '10m a 120m + Lei de Potência α',
  model_dispersion: 'Envelope Mín–Máx & Spread',
  confidence: 'Score 0–100 Auditável',
  confidence_agreement: 'Sub-índice 0–50 pts',
  confidence_integrity: 'Sub-índice 0–30 pts',
  confidence_proximity: 'Sub-índice 0–20 pts',
  confidence_vertical: 'Checagem Lei de Hellmann α',
  safe_window: 'Verde / Amarelo / Vermelho',
  barometric_trend: 'ΔP / 3h > 4 hPa',
  fog_risk: 'Visibilidade < 1km & Spread < 2°C',
  stratified_clouds: 'Baixa / Média / Alta',
  alerts_builder_help: 'Regras & Janelas Horárias',
  waves_swell: 'Open-Meteo Marine Grid',
  ephemeris: 'SunCalc 100% Offline',
  summary_overview: 'Hora Local & 4 Períodos',
  report_studio_overview: 'PDF / DOCX / HTML / MD / CSV',
  report_water_balance: 'FAO-56 (P − ET0)',
  report_gdd: 'GDD Base 10 °C',
  report_vector_r: 'Coerência Vetorial R ∈ [0,1]',
  report_zscore_ols: '|Z| máx & Regressão OLS',
  report_era5_hybrid: 'Reanálise ERA5 + Híbrido',
  report_16d_projection: 'Horizonte Estendido 16 Dias',
  route_planning_4d: 'Rota 4D (GPX/KML/KMZ + ETA)',
  goes_satellite: 'Satélite IR / Vapor d’Água',
  ground_truth_validation: 'Campo + Calibração Bayesiana',
  bessel_robust_stats: 'Bessel (n−1) • MAD • Theil-Sen',
  tide_alerts_dhn: 'Maré MSL ~8 km (≠ DHN)',
  background_alerts_android: 'Android 2º Plano & Recorrência',
};

const TOPIC_BADGES_EN: Record<HelpTopicId, string> = {
  ensemble_vs_native: 'Multi-Model (ECMWF + GFS + ICON + GEM)',
  vertical_profile: '10m to 120m + Power Law α',
  model_dispersion: 'Min–Max Envelope & Spread',
  confidence: 'Auditable 0–100 Score',
  confidence_agreement: 'Sub-index 0–50 pts',
  confidence_integrity: 'Sub-index 0–30 pts',
  confidence_proximity: 'Sub-index 0–20 pts',
  confidence_vertical: 'Hellmann Power Law α Check',
  safe_window: 'Green / Amber / Red',
  barometric_trend: 'ΔP / 3h > 4 hPa',
  fog_risk: 'Visibility < 1km & Spread < 2°C',
  stratified_clouds: 'Low / Mid / High',
  alerts_builder_help: 'Rules & Time Windows',
  waves_swell: 'Open-Meteo Marine Grid',
  ephemeris: 'SunCalc 100% Offline',
  summary_overview: 'Local Time & 4 Periods',
  report_studio_overview: 'PDF / DOCX / HTML / MD / CSV',
  report_water_balance: 'FAO-56 (P − ET0)',
  report_gdd: 'GDD Base 10 °C',
  report_vector_r: 'Vector Coherence R ∈ [0,1]',
  report_zscore_ols: '|Z| max & OLS Trend',
  report_era5_hybrid: 'ERA5 Reanalysis + Hybrid',
  report_16d_projection: 'Extended 16-Day Horizon',
  route_planning_4d: '4D Route (GPX/KML/KMZ + ETA)',
  goes_satellite: 'GOES Satellite IR / Water Vapor',
  ground_truth_validation: 'Field Truth + Bayesian Skill',
  bessel_robust_stats: 'Bessel (n−1) • MAD • Theil-Sen',
  tide_alerts_dhn: 'MSL Tide ~8 km (≠ DHN)',
  background_alerts_android: 'Android Background & Recurrence',
};

const FIELD_EXTRA_ENTRIES_PT: GlossaryEntry[] = [
  {
    id: 'field_workflow',
    category: 'campo',
    title: 'Fluxo Rápido de Operação em Campo & Offline',
    badge: 'Celular & Computador (Offline)',
    summary:
      'Como preparar e executar uma missão sem conexão de internet utilizando os recursos integrados do FieldCast.',
    bullets: [
      '1. Salve seus Pontos de Missão: No seletor do topo, busque ou insira coordenadas e favorite seus locais. A última previsão de 168h fica salva no aparelho.',
      '2. Baixe o Mapa da Área de Missão: Na aba "Mapa & Radar", selecione um retângulo de missão para guardar áreas de mapa com suporte offline.',
      '3. Grave Rotas (GPS) e Waypoints: Na aba de Dados & Campo, registre marcações com foto comprimida (~200 KB) e registro automático de vento, pressão e onda do momento.',
      '4. Exporte sem Servidor: Exporte relatórios e trilhas em PDF, DOCX, CSV, JSON, GPX ou GeoJSON diretamente pelo dispositivo.',
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

const FIELD_EXTRA_ENTRIES_EN: GlossaryEntry[] = [
  {
    id: 'field_workflow',
    category: 'campo',
    title: 'Quick Field & Offline Operations Workflow',
    badge: 'Mobile & Desktop (Offline)',
    summary:
      'How to prepare and execute a field mission without internet access using FieldCast built-in offline tools.',
    bullets: [
      '1. Save Mission Locations: Use the top location selector to search or pick coordinates and star favorites. The latest 168h forecast stays saved on your device.',
      '2. Download Offline Map Area: In "Map & Radar", select a mission bounding box to save offline map regions on your device.',
      '3. Record GPS Routes & Waypoints: In Field & Data, log waypoints with compressed photos (~200 KB) and an automatic snapshot of wind, pressure, and waves.',
      '4. Server-Free Exports: Export reports and tracks as PDF, DOCX, CSV, JSON, GPX, or GeoJSON straight from your device.',
    ],
    tip: 'Under bright sunlight, switch to the Light High-Contrast theme in the header for crisp visibility.',
  },
  {
    id: 'circular_math',
    category: 'modelos',
    title: 'Vector Circular Mean (Wind & Current Direction)',
    badge: 'u, v Decomposition & Coherence R',
    summary:
      'Why FieldCast never averages angular directions arithmetically (e.g., 350° and 10°).',
    bullets: [
      'A plain arithmetic mean of 350° (North) and 10° (North) yields 180° (South — a severe 180° error).',
      'FieldCast decomposes each vector into zonal/meridional components (u = -v·sin θ, v = -v·cos θ) and reconstructs the true angle via atan2(-u_mean, -v_mean) → 0° (North).',
      'The mean resultant length R ∈ [0, 1] measures pure directional coherence across models: R ≈ 1 means full alignment; R ≈ 0 means opposing directions.',
    ],
    tip: 'When R is low, the Confidence Index lowers model-agreement points and warns about directional uncertainty.',
  },
];

const TEMPLATE_TRANSLATIONS_EN: Record<
  string,
  { name: string; categoryLabel: string; description: string }
> = {
  'tpl-extreme-storm': {
    name: 'Civil Defense — Storm, Lightning & Severe Gusts',
    categoryLabel: 'Civil Defense & Safety',
    description:
      '24h monitoring for severe downpours, lightning risk, and intense gusts without time restrictions.',
  },
  'tpl-morning-field': {
    name: 'Daily Field Planning (Morning Window)',
    categoryLabel: 'Land & Field Operations',
    description:
      'Tracks temperature range (14–32 °C), wind, and rain probability during daytime, notifying from 06:30.',
  },
  'tpl-marine-drone': {
    name: 'Marine & Aviation Alert (Wind, Wave & Kp)',
    categoryLabel: 'Coastal Marine & Drone/UAV',
    description:
      'Monitors sustained wind, significant wave height, and NOAA Kp geomagnetic index starting at 05:30.',
  },
};

function getTemplateConditionChips(tpl: NotificationRuleTemplate, locale: AppLocale): string[] {
  const isEn = locale === 'en';
  const c = tpl.suggestedConditions;
  const chips: string[] = [];
  if (c.minTempC !== undefined && c.minTempC !== null) {
    chips.push(`${isEn ? 'Min Temp' : 'Temp Mín'}: ${c.minTempC} °C`);
  }
  if (c.maxTempC !== undefined && c.maxTempC !== null) {
    chips.push(`${isEn ? 'Max Temp' : 'Temp Máx'}: ${c.maxTempC} °C`);
  }
  if (c.minPrecipProbPct !== undefined && c.minPrecipProbPct !== null) {
    chips.push(`${isEn ? 'Rain' : 'Chuva'} ≥ ${c.minPrecipProbPct}%`);
  }
  if (c.maxWindKmh !== undefined && c.maxWindKmh !== null) {
    chips.push(`${isEn ? 'Wind' : 'Vento'} ≥ ${c.maxWindKmh} km/h`);
  }
  if (c.maxGustKmh !== undefined && c.maxGustKmh !== null) {
    chips.push(`${isEn ? 'Gust' : 'Rajada'} ≥ ${c.maxGustKmh} km/h`);
  }
  if (c.maxWaveM !== undefined && c.maxWaveM !== null) {
    chips.push(`${isEn ? 'Wave' : 'Onda'} ≥ ${c.maxWaveM} m`);
  }
  if (c.maxKpIndex !== undefined && c.maxKpIndex !== null) {
    chips.push(`Kp ≥ ${c.maxKpIndex}`);
  }
  return chips;
}

export const GlossaryModal: React.FC<GlossaryModalProps> = ({
  isOpen,
  onClose,
  onActivateTemplate,
}) => {
  const { locale, tr } = useLocale();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'todos' | GlossaryEntry['category']>(
    'todos',
  );
  const [activatedTemplateIds, setActivatedTemplateIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const prefs = loadNotificationPreferences();
    const activeIds = NOTIFICATION_RULE_TEMPLATES.filter((tpl) =>
      prefs.rules.some(
        (r) => r.enabled && (r.id === `rule-${tpl.templateId}` || r.name === tpl.name),
      ),
    ).map((tpl) => tpl.templateId);
    setActivatedTemplateIds(activeIds);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const allEntries = useMemo<GlossaryEntry[]>(() => {
    const extraEntries = locale === 'en' ? FIELD_EXTRA_ENTRIES_EN : FIELD_EXTRA_ENTRIES_PT;
    const topicDict = locale === 'en' ? HELP_TOPICS_EN : HELP_TOPICS;
    const badgeDict = locale === 'en' ? TOPIC_BADGES_EN : TOPIC_BADGES;

    return [
      ...extraEntries,
      ...(Object.keys(HELP_TOPICS) as HelpTopicId[]).map((topicId) => {
        const topicDef = topicDict[topicId];
        return {
          id: topicId,
          category: TOPIC_TO_CATEGORY[topicId],
          title: topicDef.title,
          badge: badgeDict[topicId],
          summary: topicDef.summary,
          bullets: topicDef.details,
          tip: topicDef.operationalTip,
        };
      }),
    ];
  }, [locale]);

  if (!isOpen) {
    return null;
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredEntries = allEntries.filter((entry) => {
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

  const showTemplatesSection = activeCategory === 'todos' || activeCategory === 'alertas';
  const filteredTemplates = showTemplatesSection
    ? NOTIFICATION_RULE_TEMPLATES.filter((tpl) => {
        if (!normalizedQuery) {
          return true;
        }
        const enCopy = TEMPLATE_TRANSLATIONS_EN[tpl.templateId];
        const haystack = [
          tpl.name,
          tpl.categoryLabel,
          tpl.description,
          enCopy?.name ?? '',
          enCopy?.categoryLabel ?? '',
          enCopy?.description ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : [];

  const handleActivateTemplateClick = (tpl: NotificationRuleTemplate) => {
    const current = loadNotificationPreferences();
    const targetRuleId = `rule-${tpl.templateId}`;
    const existingIdx = current.rules.findIndex(
      (r) => r.id === targetRuleId || r.name === tpl.name,
    );

    const newRule: CustomNotificationRule = {
      id: existingIdx >= 0 ? current.rules[existingIdx]!.id : targetRuleId,
      name: tpl.name,
      enabled: true,
      conditions: { ...tpl.suggestedConditions },
      timeWindow: { ...tpl.suggestedTimeWindow },
      customTitle: tpl.suggestedTitle,
      customMessage: tpl.suggestedMessage,
      createdAtIso:
        existingIdx >= 0
          ? current.rules[existingIdx]!.createdAtIso
          : new Date().toISOString(),
      lastTriggeredIso:
        existingIdx >= 0 ? current.rules[existingIdx]!.lastTriggeredIso ?? null : null,
    };

    const nextRules =
      existingIdx >= 0
        ? current.rules.map((r, idx) => (idx === existingIdx ? newRule : r))
        : [...current.rules, newRule];

    const saved = saveNotificationPreferences({
      ...current,
      masterEnabled: true,
      rules: nextRules,
    });

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent<UserNotificationPreferences>('fieldcast:notification-prefs-updated', {
          detail: saved,
        }),
      );
    }

    setActivatedTemplateIds((prev) =>
      prev.includes(tpl.templateId) ? prev : [...prev, tpl.templateId],
    );

    onActivateTemplate?.(tpl, saved);
  };

  const categories: Array<{
    id: 'todos' | GlossaryEntry['category'];
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'todos', label: tr('Todos', 'All'), Icon: BookOpen },
    { id: 'campo', label: tr('Guia de Campo', 'Field Guide'), Icon: Compass },
    { id: 'modelos', label: tr('Modelos & Perfil Vertical', 'Models & Vertical Profile'), Icon: Wind },
    { id: 'confianca', label: tr('Confiabilidade', 'Confidence'), Icon: ShieldCheck },
    { id: 'alertas', label: tr('Alertas & Semáforo', 'Alerts & Safe Window'), Icon: Gauge },
    { id: 'marinho', label: tr('Ondas & Marinho', 'Waves & Marine'), Icon: Waves },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="glossary-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-sky-950/45 dark:bg-slate-950/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-[#132a47] text-slate-800 dark:text-sky-50 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-sky-100 dark:border-sky-800 bg-gradient-to-r from-sky-50 via-blue-50/40 to-white dark:from-[#0f243d] dark:to-[#132a47]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-[#0080cd] text-white shadow-sm">
              <BookOpen className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="glossary-modal-title"
                className="text-lg md:text-xl font-bold text-slate-900 dark:text-white"
              >
                {tr('Guia Rápido & Glossário', 'Quick Guide & Glossary')}
              </h2>
              <p className="text-xs text-slate-600 dark:text-sky-200/80">
                {tr(
                  'Explicações simples e diretas sobre vento, ondas, modelos, alertas e operação em campo',
                  'Clear, practical explanations about wind, waves, models, alerts, and field operations',
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={tr(
              'Fechar Guia Rápido e Glossário',
              'Close Quick Guide & Glossary',
            )}
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
              placeholder={tr(
                'Buscar termo ou guia (ex.: Cisalhamento, Ensemble, Barômetro, Swell, Alerta, Offline)...',
                'Search term or guide (e.g., Shear, Ensemble, Barometer, Swell, Alert, Offline)...',
              )}
              aria-label={tr('Filtrar termos do glossário', 'Filter glossary terms')}
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
        <div className="p-4 sm:p-5 overflow-y-auto space-y-5 scrollbar-thin flex-1">
          {/* 3 Guide Templates inside Help Center */}
          {filteredTemplates.length > 0 && (
            <section
              data-testid="glossary-guide-templates"
              className="rounded-2xl border border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/35 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BellPlus className="w-4 h-4 text-[#0080cd] dark:text-sky-400" aria-hidden="true" />
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                    {tr(
                      'Modelos Prontos de Alerta (Ativação em 1 Clique)',
                      'Ready-to-Use Alert Templates (1-Click Activation)',
                    )}
                  </h3>
                </div>
                <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                  {tr(
                    'Desativados por padrão — ative os que desejar monitorar',
                    'Off by default — activate the ones you want to monitor',
                  )}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {filteredTemplates.map((tpl) => {
                  const enCopy = TEMPLATE_TRANSLATIONS_EN[tpl.templateId];
                  const titleText = locale === 'en' && enCopy ? enCopy.name : tpl.name;
                  const categoryText =
                    locale === 'en' && enCopy ? enCopy.categoryLabel : tpl.categoryLabel;
                  const descText =
                    locale === 'en' && enCopy ? enCopy.description : tpl.description;
                  const chips = getTemplateConditionChips(tpl, locale);
                  const isActivated = activatedTemplateIds.includes(tpl.templateId);

                  return (
                    <article
                      key={tpl.templateId}
                      className="flex flex-col justify-between rounded-xl border border-sky-200/80 dark:border-sky-800/80 bg-white dark:bg-slate-900/90 p-3.5 shadow-xs"
                    >
                      <div className="space-y-2">
                        <span className="inline-block rounded-md bg-indigo-100 dark:bg-indigo-950/80 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 dark:text-indigo-300">
                          {categoryText}
                        </span>
                        <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-snug">
                          {titleText}
                        </h4>
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                          {descText}
                        </p>

                        <div className="flex flex-wrap gap-1 pt-1">
                          <span className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-200">
                            {tr('Janela', 'Window')} {tpl.suggestedTimeWindow.startHHMM}–
                            {tpl.suggestedTimeWindow.endHHMM}
                          </span>
                          {chips.map((chip) => (
                            <span
                              key={chip}
                              className="rounded-md bg-sky-100/80 dark:bg-sky-900/50 px-2 py-0.5 text-[10px] font-semibold text-sky-900 dark:text-sky-200"
                            >
                              {chip}
                            </span>
                          ))}
                        </div>
                      </div>

                      <button
                        type="button"
                        data-testid={`use-template-${tpl.templateId}`}
                        onClick={() => handleActivateTemplateClick(tpl)}
                        className={`mt-3 min-h-[44px] w-full px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                          isActivated
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            : 'bg-[#0080cd] hover:bg-[#006eb3] text-white'
                        }`}
                      >
                        {isActivated ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>
                              {tr('Alerta Ativo — Atualizar', 'Alert Active — Update')}
                            </span>
                          </>
                        ) : (
                          <>
                            <BellPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>{tr('Ativar como Alerta', 'Activate as Alert')}</span>
                          </>
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {filteredEntries.length === 0 && filteredTemplates.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <Layers className="w-10 h-10 text-slate-400 mx-auto" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {tr(
                  `Nenhum tópico encontrado para "${searchQuery}".`,
                  `No topics found for "${searchQuery}".`,
                )}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setActiveCategory('todos');
                }}
                className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 text-white hover:bg-sky-500 transition-colors"
              >
                {tr('Limpar Filtro', 'Clear Filter')}
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
                      <strong>{tr('Recomendação Prática:', 'Practical Tip:')}</strong> {entry.tip}
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
            {tr(
              'FieldCast — Resolução horária 168h (7 dias) • Altitude do terreno Open-Meteo',
              'FieldCast — 168h (7-day) hourly resolution • Open-Meteo terrain elevation',
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] px-5 py-2 rounded-xl text-sm font-bold bg-slate-900 dark:bg-sky-600 text-white hover:opacity-95 transition-opacity focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {tr('Entendi', 'Got it')}
          </button>
        </div>
      </div>
    </div>
  );
};
