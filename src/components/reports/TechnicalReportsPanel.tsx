import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Compass,
  Droplets,
  ExternalLink,
  FileCode,
  FileSpreadsheet,
  FileText,
  Flame,
  GraduationCap,
  History,
  Printer,
  RefreshCw,
} from 'lucide-react';
import {
  computePhysicalHourlyEt0FallbackMm,
  fetchHistoricalWeatherSeries,
} from '../../services/historicalWeatherService';
import { triggerBrowserFileDownload } from '../../services/platform/ShareService';
import type {
  ActiveCoordinates,
  HistoricalHourRecord,
  HistoricalLogEntry,
  HistoricalSeriesRequest,
  HistoricalSeriesResult,
} from '../../types/field';
import type { ErrorLogRecord, ToastMessage } from '../../types/health';
import type { AgroClimaticWaterBalance, ScientificAnalysisSummary } from '../../types/v4';
import type { ForecastViewMode, NormalizedForecast } from '../../types/weather';
import { formatCardinalDirection } from '../../utils/exporters';
import { formatLocalYMD } from '../../utils/localTimeHour';
import {
  computeApparentTemperatureFallbackC,
  computeMagnusRelativeHumidityPct,
} from '../../utils/qualityScores';
import { safeAction } from '../../utils/safeAction';
import {
  analyzeForecastScientifically,
  analyzeHistoricalSeriesScientifically,
} from '../../utils/scientificAnalytics';
import {
  formatScientificStatsCsvBom,
  formatTechnicalReportHtml,
  formatTechnicalReportJson,
  formatTechnicalReportMarkdown,
  generateTechnicalReportDocument,
} from '../../utils/technicalReportGenerator';
import { FullscreenViewer } from '../common/FullscreenViewer';
import { ModuleErrorBoundary } from '../common/ModuleErrorBoundary';

const CAN_ATTACH_ECHARTS_REF =
  (typeof ReactECharts === 'function' &&
    Boolean(
      (ReactECharts as unknown as { prototype?: { isReactComponent?: unknown } }).prototype
        ?.isReactComponent,
    )) ||
  (typeof ReactECharts === 'object' && ReactECharts !== null);

export type ReportDatasetSourceMode = 'forecast' | 'historical';

export interface TechnicalReportsPanelProps {
  forecast: NormalizedForecast | null;
  activeLocation: ActiveCoordinates;
  historicalLogs?: HistoricalLogEntry[];
  initialHistoricalSeries?: HistoricalSeriesResult | null;
  defaultSource?: ReportDatasetSourceMode;
  viewMode?: ForecastViewMode;
  isDark?: boolean;
  onFetchHistoricalSeries?: (req: HistoricalSeriesRequest) => Promise<HistoricalSeriesResult>;
  onToast?: (toast: Omit<ToastMessage, 'id'>) => void;
  onErrorLog?: (record: ErrorLogRecord) => void | Promise<void>;
}

const STRESS_BADGE_MAP: Record<
  AgroClimaticWaterBalance['waterStressClassification'],
  { label: string; className: string }
> = {
  surplus: {
    label: 'Superávit Hídrico',
    className:
      'bg-sky-500/15 text-sky-800 dark:text-sky-200 border border-sky-500/35',
  },
  balanced: {
    label: 'Equilíbrio Hídrico',
    className:
      'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border border-emerald-500/35',
  },
  moderate_deficit: {
    label: 'Déficit Moderado',
    className:
      'bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-500/35',
  },
  severe_deficit: {
    label: 'Déficit Severo',
    className:
      'bg-rose-500/15 text-rose-800 dark:text-rose-200 border border-rose-500/35',
  },
};

function slugifyFilePart(raw: string): string {
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'estacao'
  );
}

function buildOfflineHistoricalFallback(
  req: HistoricalSeriesRequest,
  forecast: NormalizedForecast | null,
): HistoricalSeriesResult {
  const maxHours = Math.min(168, Math.max(24, forecast?.hours.length ?? 24));
  const hours: HistoricalHourRecord[] = (forecast?.hours ?? [])
    .slice(0, maxHours)
    .map((h) => {
      const tempC = h.temperature2mC.mean;
      const dewC = h.dewPoint2mC.mean;
      const rh =
        h.relativeHumidity2mPct?.mean ?? computeMagnusRelativeHumidityPct(tempC, dewC);
      const apparent =
        h.apparentTemperatureC?.mean ??
        computeApparentTemperatureFallbackC(tempC, rh, h.windSpeed10m.mean);
      const et0 =
        h.et0FaoMm?.mean ?? computePhysicalHourlyEt0FallbackMm(tempC, 6);
      return {
        timestampUnix: h.timestampUnix,
        timestampIso: h.timestampIso,
        source: 'FieldCast Offline Cache Synthesis',
        temperature2mC: tempC,
        dewPoint2mC: dewC,
        relativeHumidity2mPct: rh,
        apparentTemperatureC: apparent,
        et0FaoEvapotranspirationMm: et0,
        windSpeed10mKmh: h.windSpeed10m.mean,
        windGusts10mKmh: h.windGusts10m.mean,
        windDirection10mDeg: h.windDirection10m.degree,
        precipitationMm: h.precipitationMm.mean,
        surfacePressureHpa: h.surfacePressureHpa.mean,
        waveHeightM: h.marine?.waveHeight ?? null,
        seaLevelHeightMsl: h.marine?.seaLevelHeightMsl ?? null,
      };
    });

  if (hours.length === 0) {
    const baseUnix = Math.floor(new Date(`${req.startDateIso}T12:00:00Z`).getTime() / 1000);
    for (let i = 0; i < 24; i++) {
      const ts = baseUnix + i * 3600;
      const tempC = 22 + Math.sin((i / 24) * Math.PI * 2) * 4;
      const dewC = 17.5;
      const rh = computeMagnusRelativeHumidityPct(tempC, dewC);
      hours.push({
        timestampUnix: ts,
        timestampIso: new Date(ts * 1000).toISOString(),
        source: 'FieldCast Offline Reference',
        temperature2mC: Number(tempC.toFixed(1)),
        dewPoint2mC: dewC,
        relativeHumidity2mPct: rh,
        apparentTemperatureC: computeApparentTemperatureFallbackC(tempC, rh, 15),
        et0FaoEvapotranspirationMm: computePhysicalHourlyEt0FallbackMm(tempC, 8),
        windSpeed10mKmh: 15,
        windGusts10mKmh: 22,
        windDirection10mDeg: 135,
        precipitationMm: i === 15 ? 1.2 : 0,
        surfacePressureHpa: 1015,
        waveHeightM: null,
        seaLevelHeightMsl: null,
      });
    }
  }

  return {
    locationName: req.locationName,
    latitude: req.latitude,
    longitude: req.longitude,
    elevationDemM: forecast?.elevationDemM ?? 0,
    timezone: forecast?.timezone ?? 'America/Sao_Paulo',
    startDateIso: req.startDateIso,
    endDateIso: req.endDateIso,
    modelsIncluded: req.models,
    sourceLabel: 'Síntese Local Offline / Cache FieldCast',
    fetchedAtIso: new Date().toISOString(),
    hours,
  };
}

function formatShortChartAxisLabel(timestampUnix: number, timezone: string): string {
  try {
    const d = new Date(timestampUnix * 1000);
    const dayMonth = d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      timeZone: timezone || undefined,
    });
    const hourStr = d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || undefined,
    });
    return `${dayMonth} ${hourStr}`;
  } catch {
    return new Date(timestampUnix * 1000).toISOString().slice(5, 16).replace('T', ' ');
  }
}

export const TechnicalReportsPanel: React.FC<TechnicalReportsPanelProps> = ({
  forecast,
  activeLocation,
  historicalLogs = [],
  initialHistoricalSeries = null,
  defaultSource = 'forecast',
  viewMode = 'fieldcast',
  isDark = false,
  onFetchHistoricalSeries,
  onToast,
  onErrorLog,
}) => {
  const [sourceMode, setSourceMode] = useState<ReportDatasetSourceMode>(defaultSource);
  const [selectedModelView, setSelectedModelView] = useState<ForecastViewMode>(viewMode);
  const [selectedLogId, setSelectedLogId] = useState<string>(() =>
    initialHistoricalSeries
      ? 'latest_query'
      : historicalLogs[0]?.id ?? 'latest_query',
  );
  const [extractedHistoricalSeries, setExtractedHistoricalSeries] =
    useState<HistoricalSeriesResult | null>(initialHistoricalSeries);
  const [isExtractingHistory, setIsExtractingHistory] = useState<boolean>(false);

  const chartRef = useRef<ReactECharts | null>(null);

  useEffect(() => {
    setSelectedModelView(viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (initialHistoricalSeries) {
      setExtractedHistoricalSeries(initialHistoricalSeries);
      setSelectedLogId('latest_query');
    }
  }, [initialHistoricalSeries]);

  const activeHistoricalSeries: HistoricalSeriesResult | null = useMemo(() => {
    if (selectedLogId !== 'latest_query') {
      const matched = historicalLogs.find((l) => l.id === selectedLogId);
      if (matched) {
        return matched.result;
      }
    }
    if (extractedHistoricalSeries) {
      return extractedHistoricalSeries;
    }
    return historicalLogs[0]?.result ?? null;
  }, [extractedHistoricalSeries, historicalLogs, selectedLogId]);

  const handleQuickExtractHistorical = useCallback(
    (daysAgo: 7 | 30 | 90) => {
      void safeAction(
        async () => {
          const now = new Date();
          const endAnchor = new Date(now.getTime() - 86_400_000);
          const startAnchor = new Date(now.getTime() - daysAgo * 86_400_000);
          const req: HistoricalSeriesRequest = {
            locationName: activeLocation.name,
            latitude: activeLocation.latitude,
            longitude: activeLocation.longitude,
            startDateIso: formatLocalYMD(startAnchor, forecast?.timezone),
            endDateIso: formatLocalYMD(endAnchor, forecast?.timezone),
            models: forecast?.marineAvailable
              ? ['fieldcast', 'ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless', 'marine']
              : ['fieldcast', 'ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'],
          };

          let series: HistoricalSeriesResult;
          try {
            series = onFetchHistoricalSeries
              ? await onFetchHistoricalSeries(req)
              : await fetchHistoricalWeatherSeries(req);
          } catch {
            series = buildOfflineHistoricalFallback(req, forecast);
          }

          setExtractedHistoricalSeries(series);
          setSelectedLogId('latest_query');
          setSourceMode('historical');

          onToast?.({
            type: 'success',
            title: `Série histórica de ${daysAgo} dias pronta para análise`,
            message: `${series.locationName}: ${series.hours.length} horas processadas no estúdio científico.`,
          });
        },
        {
          actionKey: `report_quick_extract_${daysAgo}d`,
          moduleName: 'TechnicalReportsPanel',
          errorTitle: `Falha ao extrair série histórica (${daysAgo}d)`,
          onLoadingChange: setIsExtractingHistory,
          onToast,
          onErrorLog,
        },
      );
    },
    [activeLocation, forecast, onErrorLog, onFetchHistoricalSeries, onToast],
  );

  const analysis: ScientificAnalysisSummary | null = useMemo(() => {
    if (sourceMode === 'historical') {
      const targetSeries =
        activeHistoricalSeries ??
        (forecast
          ? buildOfflineHistoricalFallback(
              {
                locationName: activeLocation.name,
                latitude: activeLocation.latitude,
                longitude: activeLocation.longitude,
                startDateIso: formatLocalYMD(
                  new Date(Date.now() - 7 * 86_400_000),
                  forecast.timezone,
                ),
                endDateIso: formatLocalYMD(new Date(), forecast.timezone),
                models: ['fieldcast'],
              },
              forecast,
            )
          : null);

      return targetSeries ? analyzeHistoricalSeriesScientifically(targetSeries) : null;
    }

    if (!forecast) {
      return null;
    }
    return analyzeForecastScientifically(forecast, activeLocation.name, selectedModelView);
  }, [activeHistoricalSeries, activeLocation, forecast, selectedModelView, sourceMode]);

  const reportDoc = useMemo(
    () => (analysis ? generateTechnicalReportDocument(analysis) : null),
    [analysis],
  );

  const maxAnomalyEntry = useMemo(() => {
    if (!analysis) {
      return { value: null as number | null, label: 'N/D' };
    }
    let bestVal: number | null = null;
    let bestLabel = 'Estável';
    for (const m of analysis.metrics) {
      if (
        m.anomalyZScoreMax !== null &&
        Number.isFinite(m.anomalyZScoreMax) &&
        (bestVal === null || m.anomalyZScoreMax > bestVal)
      ) {
        bestVal = m.anomalyZScoreMax;
        bestLabel = m.label;
      }
    }
    return { value: bestVal, label: bestLabel };
  }, [analysis]);

  const chartOption: EChartsOption | null = useMemo(() => {
    if (!analysis) {
      return null;
    }

    const textColor = isDark ? '#cbd5e1' : '#334155';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(148, 163, 184, 0.25)';
    const tooltipBg = isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)';

    let labels: string[] = [];
    let temps: Array<number | null> = [];
    let winds: Array<number | null> = [];
    let precips: Array<number | null> = [];
    let et0s: Array<number | null> = [];

    if (sourceMode === 'historical') {
      const series =
        activeHistoricalSeries ??
        buildOfflineHistoricalFallback(
          {
            locationName: activeLocation.name,
            latitude: activeLocation.latitude,
            longitude: activeLocation.longitude,
            startDateIso: analysis.periodStartIso.slice(0, 10),
            endDateIso: analysis.periodEndIso.slice(0, 10),
            models: ['fieldcast'],
          },
          forecast,
        );
      labels = series.hours.map((h) => formatShortChartAxisLabel(h.timestampUnix, series.timezone));
      temps = series.hours.map((h) =>
        h.temperature2mC !== null ? Number(h.temperature2mC.toFixed(1)) : null,
      );
      winds = series.hours.map((h) =>
        h.windSpeed10mKmh !== null ? Number(h.windSpeed10mKmh.toFixed(1)) : null,
      );
      precips = series.hours.map((h) =>
        h.precipitationMm !== null ? Number(h.precipitationMm.toFixed(2)) : null,
      );
      et0s = series.hours.map((h) => {
        const val =
          h.et0FaoEvapotranspirationMm ??
          computePhysicalHourlyEt0FallbackMm(h.temperature2mC, 6);
        return val !== null ? Number(val.toFixed(3)) : null;
      });
    } else if (forecast) {
      labels = forecast.hours.map((h) =>
        formatShortChartAxisLabel(h.timestampUnix, forecast.timezone),
      );
      temps = forecast.hours.map((h) =>
        h.temperature2mC.mean !== null ? Number(h.temperature2mC.mean.toFixed(1)) : null,
      );
      winds = forecast.hours.map((h) =>
        h.windSpeed10m.mean !== null ? Number(h.windSpeed10m.mean.toFixed(1)) : null,
      );
      precips = forecast.hours.map((h) =>
        h.precipitationMm.mean !== null ? Number(h.precipitationMm.mean.toFixed(2)) : null,
      );
      et0s = forecast.hours.map((h) => {
        const val =
          h.et0FaoMm?.mean ??
          computePhysicalHourlyEt0FallbackMm(h.temperature2mC.mean, 6);
        return val !== null ? Number(val.toFixed(3)) : null;
      });
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: isDark ? '#334155' : '#bae6fd',
        textStyle: { color: isDark ? '#f8fafc' : '#0f172a', fontSize: 12 },
      },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        top: 44,
        left: 14,
        right: 18,
        bottom: 24,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: gridColor } },
      },
      yAxis: [
        {
          type: 'value',
          name: '°C / km/h',
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridColor } },
        },
        {
          type: 'value',
          name: 'mm/h',
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Temperatura 2m (°C)',
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2.4, color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: temps,
        },
        {
          name: 'Vento 10m (km/h)',
          type: 'line',
          yAxisIndex: 0,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 1.9, type: 'dashed', color: '#0284c7' },
          itemStyle: { color: '#0284c7' },
          data: winds,
        },
        {
          name: 'Precipitação (mm/h)',
          type: 'bar',
          yAxisIndex: 1,
          itemStyle: { color: 'rgba(14, 165, 233, 0.72)' },
          data: precips,
        },
        {
          name: 'ET0 FAO-56 (mm/h)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: '#10b981' },
          areaStyle: { color: 'rgba(16, 185, 129, 0.14)' },
          itemStyle: { color: '#10b981' },
          data: et0s,
        },
      ],
    };
  }, [activeHistoricalSeries, activeLocation, analysis, forecast, isDark, sourceMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleRefresh = () => {
      try {
        chartRef.current?.getEchartsInstance?.()?.resize?.();
      } catch {
        // Ignora durante desmontagem
      }
    };
    window.addEventListener('resize', handleRefresh);
    window.addEventListener('fieldcast:layout-refresh', handleRefresh);
    return () => {
      window.removeEventListener('resize', handleRefresh);
      window.removeEventListener('fieldcast:layout-refresh', handleRefresh);
    };
  }, []);

  const handleDownloadReport = (kind: 'html' | 'md' | 'csv' | 'json'): void => {
    if (!analysis || !reportDoc) {
      return;
    }
    void safeAction(
      async () => {
        const locSlug = slugifyFilePart(analysis.locationName);
        const dateTag = analysis.periodStartIso.slice(0, 10);
        const base = `fieldcast-relatorio-tecnico-${locSlug}-${dateTag}`;

        if (kind === 'html') {
          const html = formatTechnicalReportHtml(reportDoc);
          triggerBrowserFileDownload(`${base}.html`, html, 'text/html;charset=utf-8');
        } else if (kind === 'md') {
          const md = formatTechnicalReportMarkdown(reportDoc);
          triggerBrowserFileDownload(`${base}.md`, md, 'text/markdown;charset=utf-8');
        } else if (kind === 'csv') {
          const csv = formatScientificStatsCsvBom(analysis);
          triggerBrowserFileDownload(`${base}-estatisticas.csv`, csv, 'text/csv;charset=utf-8');
        } else {
          const json = formatTechnicalReportJson(reportDoc);
          triggerBrowserFileDownload(`${base}.json`, json, 'application/json;charset=utf-8');
        }

        onToast?.({
          type: 'success',
          title: `Relatório exportado (${kind.toUpperCase()})`,
          message: `Arquivo científico gerado localmente para ${analysis.locationName}.`,
        });
      },
      {
        actionKey: `download_technical_report_${kind}`,
        moduleName: 'TechnicalReportsPanel',
        errorTitle: `Erro ao exportar relatório (${kind.toUpperCase()})`,
        onToast,
        onErrorLog,
      },
    );
  };

  const handlePrintPdf = (): void => {
    if (!reportDoc) {
      return;
    }
    void safeAction(
      async () => {
        const html = formatTechnicalReportHtml(reportDoc);
        let printedInPopup = false;

        if (typeof window !== 'undefined' && typeof window.open === 'function') {
          try {
            const printWin = window.open('', '_blank', 'noopener,width=980,height=800');
            if (printWin && printWin.document) {
              printWin.document.open();
              printWin.document.write(html);
              printWin.document.close();
              printWin.focus?.();
              printWin.print?.();
              printedInPopup = true;
            }
          } catch {
            printedInPopup = false;
          }
        }

        if (!printedInPopup && typeof window !== 'undefined') {
          try {
            window.print?.();
          } catch {
            // Ambiente headless/jsdom sem spooler nativo
          }
        }

        onToast?.({
          type: 'info',
          title: 'Impressão / Exportação PDF acionada',
          message: 'Use "Salvar como PDF" na janela de impressão para gerar o laudo A4.',
        });
      },
      {
        actionKey: 'print_technical_report_pdf',
        moduleName: 'TechnicalReportsPanel',
        errorTitle: 'Erro ao preparar impressão PDF',
        onToast,
        onErrorLog,
      },
    );
  };

  const echartsRefProps = CAN_ATTACH_ECHARTS_REF
    ? {
        ref: (instance: ReactECharts | null) => {
          chartRef.current = instance;
        },
      }
    : {};

  return (
    <section
      data-testid="technical-reports-panel"
      aria-label="Estúdio de Análise Estatística ERA5 e Relatórios Técnicos/Acadêmicos"
      className="rounded-2xl border border-slate-200/90 dark:border-sky-800/70 bg-white dark:bg-[#132a47] p-4 sm:p-5 shadow-sm space-y-5"
    >
      {/* Cabeçalho Acadêmico & Seletor de Fonte */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 shrink-0">
            <GraduationCap className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                Estúdio de Análise Estatística ERA5 &amp; Relatório Técnico-Acadêmico
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200">
                FAO-56 • Quantis • OLS • Vetorial R
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              Síntese descritiva auditável, balanço hídrico superficial (P &minus; ET0), graus-dia
              e geração de laudo publicável (HTML5, Markdown, CSV UTF-8 BOM, JSON e PDF/Print)
            </p>
          </div>
        </div>

        {/* Botões de Download / Print 1-Clique */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="download-report-html"
            disabled={!reportDoc}
            onClick={() => handleDownloadReport('html')}
            className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white shadow-sm transition-colors"
          >
            <FileText className="w-4 h-4" aria-hidden="true" />
            <span>HTML5</span>
          </button>

          <button
            type="button"
            data-testid="download-report-md"
            disabled={!reportDoc}
            onClick={() => handleDownloadReport('md')}
            className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border border-slate-300 dark:border-sky-700 bg-slate-50 dark:bg-[#0f243d] hover:bg-sky-50 dark:hover:bg-sky-900/50 disabled:opacity-50 text-slate-800 dark:text-sky-100 transition-colors"
          >
            <BookOpen className="w-4 h-4 text-indigo-500" aria-hidden="true" />
            <span>Markdown</span>
          </button>

          <button
            type="button"
            data-testid="download-report-csv"
            disabled={!analysis}
            onClick={() => handleDownloadReport('csv')}
            className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border border-slate-300 dark:border-sky-700 bg-slate-50 dark:bg-[#0f243d] hover:bg-sky-50 dark:hover:bg-sky-900/50 disabled:opacity-50 text-slate-800 dark:text-sky-100 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" aria-hidden="true" />
            <span>CSV (BOM)</span>
          </button>

          <button
            type="button"
            data-testid="download-report-json"
            disabled={!reportDoc}
            onClick={() => handleDownloadReport('json')}
            className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border border-slate-300 dark:border-sky-700 bg-slate-50 dark:bg-[#0f243d] hover:bg-sky-50 dark:hover:bg-sky-900/50 disabled:opacity-50 text-slate-800 dark:text-sky-100 transition-colors"
          >
            <FileCode className="w-4 h-4 text-amber-500" aria-hidden="true" />
            <span>JSON</span>
          </button>

          <button
            type="button"
            data-testid="print-report-pdf"
            disabled={!reportDoc}
            onClick={handlePrintPdf}
            className="min-h-[44px] min-w-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-sm transition-colors"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            <span>Imprimir / PDF</span>
          </button>
        </div>
      </div>

      {/* Seletor de Fonte: Previsão 168h vs Série Histórica / ERA5 */}
      <div className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/80 dark:bg-[#0f243d] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-testid="report-source-forecast"
            aria-pressed={sourceMode === 'forecast'}
            onClick={() => setSourceMode('forecast')}
            className={`min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 border transition-colors ${
              sourceMode === 'forecast'
                ? 'bg-[#0080cd] text-white border-[#0080cd] shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-sky-50'
            }`}
          >
            <Activity className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Previsão Operacional Ativa (168h Multi-Modelo)</span>
          </button>

          <button
            type="button"
            data-testid="report-source-historical"
            aria-pressed={sourceMode === 'historical'}
            onClick={() => setSourceMode('historical')}
            className={`min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-2 border transition-colors ${
              sourceMode === 'historical'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-indigo-50'
            }`}
          >
            <History className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Série Temporal Histórica / Reanálise ERA5</span>
          </button>
        </div>

        {sourceMode === 'forecast' ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Modelo Analisado:
            </span>
            {(
              [
                { id: 'fieldcast', label: 'Consenso FieldCast' },
                { id: 'ecmwf_ifs025', label: 'ECMWF 0.25°' },
                { id: 'gfs_seamless', label: 'NOAA GFS' },
                { id: 'icon_seamless', label: 'DWD ICON' },
                { id: 'gem_seamless', label: 'CMC GEM' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={selectedModelView === opt.id}
                onClick={() => setSelectedModelView(opt.id)}
                className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                  selectedModelView === opt.id
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <span>Série Salva:</span>
                <select
                  aria-label="Selecionar log histórico salvo"
                  data-testid="report-historical-log-select"
                  value={selectedLogId}
                  onChange={(e) => setSelectedLogId(e.target.value)}
                  className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white"
                >
                  <option value="latest_query">
                    {extractedHistoricalSeries
                      ? `Extração Atual: ${extractedHistoricalSeries.locationName} (${extractedHistoricalSeries.startDateIso} a ${extractedHistoricalSeries.endDateIso})`
                      : 'Extração sob demanda / Síntese ativa'}
                  </option>
                  {historicalLogs.map((log) => (
                    <option key={log.id} value={log.id}>
                      {log.locationName} ({log.startDateIso} a {log.endDateIso} • {log.recordCount}h)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="report-quick-extract-7d"
                disabled={isExtractingHistory}
                onClick={() => handleQuickExtractHistorical(7)}
                className="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white shadow-sm transition-colors"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isExtractingHistory ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>Extrair 7d</span>
              </button>

              <button
                type="button"
                data-testid="report-quick-extract-30d"
                disabled={isExtractingHistory}
                onClick={() => handleQuickExtractHistorical(30)}
                className="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-sm transition-colors"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isExtractingHistory ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>Extrair 30d</span>
              </button>

              <button
                type="button"
                data-testid="report-quick-extract-90d"
                disabled={isExtractingHistory}
                onClick={() => handleQuickExtractHistorical(90)}
                className="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 border border-indigo-400 dark:border-indigo-600 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-200 hover:bg-indigo-50 disabled:opacity-50 transition-colors"
              >
                <span>ERA5 90d</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {!analysis || !reportDoc ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-600 dark:text-slate-300">
          Nenhuma série carregada para análise científica. Selecione um ponto operacional ou
          extraia uma série histórica de 7 ou 30 dias acima.
        </div>
      ) : (
        <>
          {/* 4 KPI Cards Científicos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <div
              data-testid="kpi-water-balance"
              className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/80 dark:bg-[#0f243d] p-3.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                  <Droplets className="w-3.5 h-3.5 text-sky-500" aria-hidden="true" />
                  Balanço Hídrico (P &minus; ET0)
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    STRESS_BADGE_MAP[analysis.waterBalance.waterStressClassification].className
                  }`}
                >
                  {STRESS_BADGE_MAP[analysis.waterBalance.waterStressClassification].label}
                </span>
              </div>
              <div className="text-xl font-black font-mono text-slate-900 dark:text-white">
                {analysis.waterBalance.netWaterBalanceMm >= 0 ? '+' : ''}
                {analysis.waterBalance.netWaterBalanceMm.toFixed(1)} mm
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                P: {analysis.waterBalance.totalPrecipitationMm.toFixed(1)} mm &bull; ET0:{' '}
                {analysis.waterBalance.totalEt0FaoMm.toFixed(1)} mm
              </div>
            </div>

            <div
              data-testid="kpi-gdd"
              className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/80 dark:bg-[#0f243d] p-3.5 space-y-1.5"
            >
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <Flame className="w-3.5 h-3.5 text-orange-500" aria-hidden="true" />
                Graus-Dia (GDD Base 10°C)
              </div>
              <div className="text-xl font-black font-mono text-slate-900 dark:text-white">
                {analysis.waterBalance.growingDegreeDaysBase10C.toFixed(1)} °C·d
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                HI Máx:{' '}
                {analysis.waterBalance.maxHeatIndexC !== null
                  ? `${analysis.waterBalance.maxHeatIndexC.toFixed(1)} °C`
                  : 'N/D'}{' '}
                &bull; UR Média:{' '}
                {analysis.waterBalance.meanRelativeHumidityPct !== null
                  ? `${analysis.waterBalance.meanRelativeHumidityPct.toFixed(0)}%`
                  : 'N/D'}
              </div>
            </div>

            <div
              data-testid="kpi-wind-consistency"
              className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/80 dark:bg-[#0f243d] p-3.5 space-y-1.5"
            >
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <Compass className="w-3.5 h-3.5 text-teal-500" aria-hidden="true" />
                Consistência Vetorial (R)
              </div>
              <div className="text-xl font-black font-mono text-slate-900 dark:text-white">
                {analysis.windDirectionalConsistencyR !== null
                  ? analysis.windDirectionalConsistencyR.toFixed(3)
                  : 'N/D'}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                Rumo Dominante:{' '}
                {analysis.dominantWindDirectionDeg !== null
                  ? `${analysis.dominantWindDirectionDeg.toFixed(0)}° (${formatCardinalDirection(analysis.dominantWindDirectionDeg)})`
                  : 'N/D'}
              </div>
            </div>

            <div
              data-testid="kpi-anomaly-zmax"
              className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/80 dark:bg-[#0f243d] p-3.5 space-y-1.5"
            >
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                Anomalia Máx (|Z|)
              </div>
              <div className="text-xl font-black font-mono text-slate-900 dark:text-white">
                {maxAnomalyEntry.value !== null
                  ? `${maxAnomalyEntry.value.toFixed(2)} σ`
                  : 'N/D'}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                {maxAnomalyEntry.label}
              </div>
            </div>
          </div>

          {/* Gráfico ECharts Interativo com FullscreenViewer (Tela Cheia) */}
          {chartOption && (
            <div className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/60 dark:bg-[#0f243d]/80 p-3.5">
              <FullscreenViewer
                title="Série Científica Integrada — Temperatura, Precipitação vs ET0 e Vento 10m"
                subtitle={`${analysis.locationName} • DEM ${Math.round(analysis.elevationDemM)}m • ${analysis.activeModelLabel}`}
                testId="technical-report-chart-viewer"
              >
                {({ isFullscreen }) => (
                  <ModuleErrorBoundary moduleName="Gráfico Científico Integrado">
                    <div
                      className={
                        isFullscreen
                          ? 'h-[calc(100vh-140px)] min-h-[360px] w-full'
                          : 'h-[300px] sm:h-[340px] w-full'
                      }
                    >
                      <ReactECharts
                        {...echartsRefProps}
                        option={chartOption}
                        opts={{ renderer: 'svg' }}
                        notMerge={true}
                        lazyUpdate={true}
                        style={{ width: '100%', height: '100%' }}
                      />
                    </div>
                  </ModuleErrorBoundary>
                )}
              </FullscreenViewer>
            </div>
          )}

          {/* Tabela Completa de Percentis Estatísticos e Tendência OLS */}
          <div className="space-y-2">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
              Tabela de Percentis Estatísticos, Dispersão (IQR) e Tendência Linear (OLS)
            </h3>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-sky-800/70">
              <table
                data-testid="scientific-stats-table"
                className="w-full text-xs text-left border-collapse"
              >
                <thead className="bg-slate-100 dark:bg-[#0b192c] text-slate-700 dark:text-sky-200 font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Variável</th>
                    <th className="py-2.5 px-2.5 text-right">N</th>
                    <th className="py-2.5 px-2.5 text-right">Média</th>
                    <th className="py-2.5 px-2.5 text-right">Mediana</th>
                    <th className="py-2.5 px-2.5 text-right">DP</th>
                    <th className="py-2.5 px-2.5 text-right">Mín</th>
                    <th className="py-2.5 px-2.5 text-right">P10</th>
                    <th className="py-2.5 px-2.5 text-right">P90</th>
                    <th className="py-2.5 px-2.5 text-right">Máx</th>
                    <th className="py-2.5 px-2.5 text-right">IQR</th>
                    <th className="py-2.5 px-2.5 text-right">Tendência/dia</th>
                    <th className="py-2.5 px-3 text-right">|Z| máx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-sky-900/60 bg-white dark:bg-[#132a47]">
                  {analysis.metrics.map((m) => (
                    <tr
                      key={m.variableKey}
                      className="hover:bg-slate-50/80 dark:hover:bg-sky-900/25"
                    >
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        {m.label}{' '}
                        <span className="text-slate-500 dark:text-slate-400 font-normal">
                          ({m.unit})
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
                        {m.sampleCount}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {m.mean !== null ? m.mean.toFixed(2) : 'N/D'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-slate-700 dark:text-slate-200">
                        {m.median !== null ? m.median.toFixed(2) : 'N/D'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
                        {m.stdDev !== null ? m.stdDev.toFixed(2) : 'N/D'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
                        {m.min !== null ? m.min.toFixed(2) : 'N/D'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-sky-700 dark:text-sky-300">
                        {m.p10 !== null ? m.p10.toFixed(2) : 'N/D'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-sky-700 dark:text-sky-300">
                        {m.p90 !== null ? m.p90.toFixed(2) : 'N/D'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
                        {m.max !== null ? m.max.toFixed(2) : 'N/D'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
                        {m.iqr !== null ? m.iqr.toFixed(2) : 'N/D'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                        {m.linearTrendPerDay !== null
                          ? `${m.linearTrendPerDay >= 0 ? '+' : ''}${m.linearTrendPerDay.toFixed(2)}`
                          : 'N/D'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-amber-700 dark:text-amber-300">
                        {m.anomalyZScoreMax !== null ? m.anomalyZScoreMax.toFixed(2) : 'N/D'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pré-Visualização Estruturada do Relatório Técnico-Científico */}
          <article
            data-testid="technical-report-preview"
            className="rounded-xl border border-slate-200 dark:border-sky-800/70 bg-slate-50/70 dark:bg-[#0f243d] p-4 sm:p-5 space-y-4"
          >
            <header className="border-b border-slate-200 dark:border-sky-800/70 pb-3">
              <div className="text-[11px] font-mono uppercase tracking-wider text-indigo-600 dark:text-indigo-300 font-bold">
                Relatório Técnico-Científico • {reportDoc.reportId}
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">
                {reportDoc.title}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                {reportDoc.subtitle}
              </p>
            </header>

            <div className="space-y-3 text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-sky-200 mb-1">
                  1. Resumo Executivo
                </h4>
                <p>{reportDoc.executiveSummary}</p>
              </div>

              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-sky-200 mb-1">
                  2. Metodologia Físico-Matemática e Disciplina DEM
                </h4>
                <div className="space-y-1.5 whitespace-pre-line">
                  {reportDoc.methodologySection}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-sky-200 mb-1">
                  3. Interpretação Objetiva dos Resultados
                </h4>
                <p>{reportDoc.resultsInterpretation}</p>
              </div>

              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-sky-200 mb-1">
                  4. Discussão Parcimoniosa
                </h4>
                <p>{reportDoc.parcimonicDiscussion}</p>
              </div>

              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-sky-200 mb-1">
                  5. Limitações Técnicas e Avisos Operacionais
                </h4>
                <ul className="list-disc pl-5 space-y-1 text-xs">
                  {reportDoc.limitationsAndDisclaimers.map((item, idx) => (
                    <li
                      key={idx}
                      className={
                        item.includes('DHN / Marinha')
                          ? 'font-semibold text-amber-800 dark:text-amber-200'
                          : ''
                      }
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Citações Acadêmicas Formais */}
            <div className="border-t border-slate-200 dark:border-sky-800/70 pt-3 space-y-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-sky-200">
                6. Referências Bibliográficas e Fontes Primárias ({analysis.citations.length})
              </h4>
              <ol className="list-decimal pl-5 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                {analysis.citations.map((cit) => (
                  <li key={cit.id}>
                    <span className="font-bold text-slate-800 dark:text-white">
                      {cit.datasetName}
                    </span>{' '}
                    ({cit.provider} • {cit.spatialResolution} • {cit.temporalResolution}):{' '}
                    {cit.formalCitation}{' '}
                    <a
                      href={cit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline font-medium"
                    >
                      <span>Fonte oficial</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </article>
        </>
      )}
    </section>
  );
};
