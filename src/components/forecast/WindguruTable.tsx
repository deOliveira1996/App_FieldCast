import React, { useMemo } from 'react';
import { Navigation, Table } from 'lucide-react';
import type {
  EnsembleHour,
  ForecastViewMode,
  NativeModelHour,
  NormalizedForecast,
  SafeWindowStatus,
} from '../../types/weather';
import { HelpPopover } from '../common/HelpPopover';

export interface WindguruTableProps {
  forecast: NormalizedForecast;
  viewMode: ForecastViewMode;
  showInterpolatedProfile: boolean;
  selectedHourIndex: number;
  onSelectHourIndex: (index: number) => void;
}

const SEMAPHORE_CELL_CLASS: Record<SafeWindowStatus, string> = {
  green: 'bg-emerald-500 text-slate-950 font-extrabold',
  amber: 'bg-amber-400 text-slate-950 font-extrabold',
  red: 'bg-red-600 text-white font-extrabold',
};

function getWindSpeedBgClass(speedKmh: number | null): string {
  if (speedKmh === null || Number.isNaN(speedKmh)) {
    return 'bg-transparent text-slate-400';
  }
  if (speedKmh < 12) {
    return 'bg-sky-500/10 text-sky-900 dark:text-sky-200';
  }
  if (speedKmh < 22) {
    return 'bg-emerald-500/20 text-emerald-950 dark:text-emerald-200 font-bold';
  }
  if (speedKmh < 35) {
    return 'bg-amber-500/25 text-amber-950 dark:text-amber-200 font-bold';
  }
  if (speedKmh < 50) {
    return 'bg-orange-500/30 text-orange-950 dark:text-orange-200 font-extrabold';
  }
  return 'bg-red-600/35 text-red-950 dark:text-red-100 font-extrabold';
}

function getRainBgClass(mm: number | null): string {
  if (!mm || mm <= 0.05) {
    return 'text-slate-400 dark:text-slate-600';
  }
  if (mm < 1.5) {
    return 'bg-sky-500/15 text-sky-900 dark:text-sky-200 font-semibold';
  }
  if (mm < 5) {
    return 'bg-sky-500/30 text-sky-950 dark:text-sky-100 font-bold';
  }
  return 'bg-indigo-600/40 text-indigo-950 dark:text-indigo-100 font-extrabold';
}

function formatDayGroupHeader(timestampUnix: number, timezone: string): string {
  try {
    const d = new Date(timestampUnix * 1000);
    return d.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return new Date(timestampUnix * 1000).toISOString().slice(0, 10);
  }
}

function formatHourOnly(timestampUnix: number, timezone: string): string {
  try {
    const d = new Date(timestampUnix * 1000);
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      timeZone: timezone || undefined,
    });
  } catch {
    return '00';
  }
}

const DirectionArrow: React.FC<{ degree: number | null | undefined; label?: string }> = ({
  degree,
  label,
}) => {
  if (degree === null || degree === undefined || Number.isNaN(degree)) {
    return <span className="text-slate-400">—</span>;
  }
  // Meteorological direction is where wind/wave comes FROM; arrow points where it blows TO (+180 deg)
  const blowToRotation = (degree + 180) % 360;
  return (
    <span
      title={`${label ?? 'Direção'}: ${Math.round(degree)}°`}
      className="inline-flex flex-col items-center justify-center leading-none"
    >
      <Navigation
        className="w-3.5 h-3.5 text-slate-700 dark:text-slate-200"
        style={{ transform: `rotate(${blowToRotation}deg)` }}
        aria-hidden="true"
      />
      <span className="text-[9px] font-mono opacity-75 mt-0.5">{Math.round(degree)}°</span>
    </span>
  );
};

export const WindguruTable: React.FC<WindguruTableProps> = ({
  forecast,
  viewMode,
  showInterpolatedProfile,
  selectedHourIndex,
  onSelectHourIndex,
}) => {
  const hours: EnsembleHour[] = forecast.hours;
  const isNative =
    viewMode === 'ecmwf_ifs025' || viewMode === 'gfs_seamless' || viewMode === 'icon_seamless';
  const nativeList: NativeModelHour[] = isNative ? forecast.nativeByModel[viewMode] ?? [] : [];

  // Group hours by day label for spanning top headers
  const dayGroups = useMemo(() => {
    const groups: Array<{ dayLabel: string; count: number }> = [];
    for (const h of hours) {
      const lbl = formatDayGroupHeader(h.timestampUnix, forecast.timezone);
      const last = groups[groups.length - 1];
      if (last && last.dayLabel === lbl) {
        last.count += 1;
      } else {
        groups.push({ dayLabel: lbl, count: 1 });
      }
    }
    return groups;
  }, [hours, forecast.timezone]);

  const getInterpolatedSpeed = (h: EnsembleHour, targetHeight: number): number | null => {
    if (!showInterpolatedProfile) {
      return null;
    }
    const found = h.verticalProfile.interpolatedLevels.find(
      (lvl) => lvl.heightM === targetHeight,
    );
    return found?.speedKmh ?? null;
  };

  return (
    <section
      aria-label="Tabela Horária Compacta Estilo Windguru (168h)"
      className="rounded-2xl border border-slate-300/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
    >
      {/* Header bar */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900/90">
        <div className="flex items-center gap-2">
          <Table className="w-5 h-5 text-sky-500" aria-hidden="true" />
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
              Grade Horária Compacta Windguru ({hours.length}h • Resolução 1h)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Role horizontalmente para inspecionar todas as {hours.length} horas ou clique em uma
              coluna para ver seu perfil vertical
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-900 dark:text-emerald-300 font-bold">
            Verde: Seguro
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 text-amber-900 dark:text-amber-300 font-bold">
            Amarelo: Atenção
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/20 text-red-900 dark:text-red-300 font-bold">
            Vermelho: Limite Excedido
          </span>
          <HelpPopover topic="safe_window" />
        </div>
      </div>

      {/* Scrollable Table Container */}
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse text-center text-[11px] font-mono select-none">
          <thead>
            {/* Day Header Row */}
            <tr className="bg-slate-100 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200 border-b border-slate-300 dark:border-slate-700">
              <th className="sticky left-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-left font-sans font-extrabold min-w-[148px] border-r border-slate-300 dark:border-slate-700">
                Dia / Parâmetro
              </th>
              {dayGroups.map((g, idx) => (
                <th
                  key={`${g.dayLabel}_${idx}`}
                  colSpan={g.count}
                  className="px-2 py-1.5 font-sans font-extrabold text-xs uppercase tracking-wider border-r border-slate-300 dark:border-slate-700 whitespace-nowrap"
                >
                  {g.dayLabel}
                </th>
              ))}
            </tr>

            {/* Hour Row */}
            <tr className="bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
              <th className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold border-r border-slate-300 dark:border-slate-700">
                Hora Local (h)
              </th>
              {hours.map((h, idx) => {
                const isSelected = idx === selectedHourIndex;
                return (
                  <th
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    className={`min-w-[42px] px-1 py-1.5 cursor-pointer transition-colors border-r border-slate-200/70 dark:border-slate-800/70 ${
                      isSelected
                        ? 'bg-sky-600 text-white font-extrabold'
                        : 'hover:bg-sky-500/15'
                    }`}
                  >
                    {formatHourOnly(h.timestampUnix, forecast.timezone)}h
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
            {/* 1. Safe Window Semaphore Row */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700">
                Semáforo Janela
              </th>
              {hours.map((h, idx) => (
                <td
                  key={h.timestampUnix}
                  onClick={() => onSelectHourIndex(idx)}
                  title={
                    h.safeWindowReasons.length > 0
                      ? h.safeWindowReasons.join(' | ')
                      : 'Dentro dos limites operacionais'
                  }
                  className={`px-1 py-1 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 ${
                    SEMAPHORE_CELL_CLASS[h.safeWindow]
                  }`}
                >
                  {h.safeWindow === 'green' ? 'OK' : h.safeWindow === 'amber' ? 'ATN' : 'LIM'}
                </td>
              ))}
            </tr>

            {/* 2. Confidence Score Row */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700">
                Confiança (0–100)
              </th>
              {hours.map((h, idx) => (
                <td
                  key={h.timestampUnix}
                  onClick={() => onSelectHourIndex(idx)}
                  className={`px-1 py-1 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 font-bold ${
                    h.confidence.badge === 'green'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : h.confidence.badge === 'amber'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {Math.round(h.confidence.total)}
                </td>
              ))}
            </tr>

            {/* 3. Wind Speed 10m */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-slate-800 dark:text-slate-200 border-r border-slate-300 dark:border-slate-700">
                Vento 10m (km/h)
              </th>
              {hours.map((h, idx) => {
                const val = isNative
                  ? nativeList[idx]?.windSpeed10m ?? null
                  : h.windSpeed10m.mean;
                return (
                  <td
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    className={`px-1 py-1.5 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 ${getWindSpeedBgClass(
                      val,
                    )}`}
                  >
                    {val !== null ? Math.round(val) : '—'}
                  </td>
                );
              })}
            </tr>

            {/* 4. Wind Direction 10m Arrow */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700">
                Direção 10m (°)
              </th>
              {hours.map((h, idx) => {
                const deg = isNative
                  ? nativeList[idx]?.windDirection10m ?? null
                  : h.windDirection10m.degree;
                return (
                  <td
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    className="px-1 py-1 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50"
                  >
                    <DirectionArrow degree={deg} label="Direção do Vento 10m" />
                  </td>
                );
              })}
            </tr>

            {/* 5. Wind Gusts 10m (Strictly at 10m) */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-amber-800 dark:text-amber-300 border-r border-slate-300 dark:border-slate-700">
                Rajadas 10m (km/h)
              </th>
              {hours.map((h, idx) => {
                const val = isNative
                  ? nativeList[idx]?.windGusts10m ?? null
                  : h.windGusts10m.mean;
                return (
                  <td
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    className={`px-1 py-1.5 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 ${getWindSpeedBgClass(
                      val,
                    )}`}
                  >
                    {val !== null ? Math.round(val) : '—'}
                  </td>
                );
              })}
            </tr>

            {/* 6. Wind 80m */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700">
                Vento 80m (km/h)
              </th>
              {hours.map((h, idx) => {
                const nativeVal = isNative
                  ? nativeList[idx]?.windSpeed80m ?? null
                  : h.windSpeed80m.mean;
                const interpVal = nativeVal === null ? getInterpolatedSpeed(h, 80) : null;
                const finalVal = nativeVal ?? interpVal;
                return (
                  <td
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    title={interpVal !== null ? 'Estimado por Lei de Potência α' : undefined}
                    className={`px-1 py-1.5 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 ${getWindSpeedBgClass(
                      finalVal,
                    )}`}
                  >
                    {finalVal !== null ? (
                      <span>
                        {Math.round(finalVal)}
                        {interpVal !== null ? '*' : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                );
              })}
            </tr>

            {/* 7. Wind 100m */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700">
                Vento 100m (km/h)
              </th>
              {hours.map((h, idx) => {
                const nativeVal = isNative
                  ? nativeList[idx]?.windSpeed100m ?? null
                  : h.windSpeed100m.mean;
                const interpVal = nativeVal === null ? getInterpolatedSpeed(h, 100) : null;
                const finalVal = nativeVal ?? interpVal;
                return (
                  <td
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    title={interpVal !== null ? 'Estimado por Lei de Potência α' : undefined}
                    className={`px-1 py-1.5 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 ${getWindSpeedBgClass(
                      finalVal,
                    )}`}
                  >
                    {finalVal !== null ? (
                      <span>
                        {Math.round(finalVal)}
                        {interpVal !== null ? '*' : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                );
              })}
            </tr>

            {/* 8. Wind 120m */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700">
                Vento 120m (km/h)
              </th>
              {hours.map((h, idx) => {
                const nativeVal = isNative
                  ? nativeList[idx]?.windSpeed120m ?? null
                  : h.windSpeed120m.mean;
                const interpVal = nativeVal === null ? getInterpolatedSpeed(h, 120) : null;
                const finalVal = nativeVal ?? interpVal;
                return (
                  <td
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    title={interpVal !== null ? 'Estimado por Lei de Potência α' : undefined}
                    className={`px-1 py-1.5 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 ${getWindSpeedBgClass(
                      finalVal,
                    )}`}
                  >
                    {finalVal !== null ? (
                      <span>
                        {Math.round(finalVal)}
                        {interpVal !== null ? '*' : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                );
              })}
            </tr>

            {/* 9 & 10. Marine Waves & Direction (Only if marineAvailable) */}
            {forecast.marineAvailable && (
              <>
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-teal-700 dark:text-teal-300 border-r border-slate-300 dark:border-slate-700">
                    Ondas (m / s)
                  </th>
                  {hours.map((h, idx) => (
                    <td
                      key={h.timestampUnix}
                      onClick={() => onSelectHourIndex(idx)}
                      className="px-1 py-1.5 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 text-teal-800 dark:text-teal-300 font-bold"
                    >
                      {h.marine?.waveHeight !== null && h.marine?.waveHeight !== undefined ? (
                        <div className="leading-tight">
                          <span>{h.marine.waveHeight.toFixed(1)}</span>
                          {h.marine.wavePeriod !== null && (
                            <span className="block text-[9px] font-normal opacity-75">
                              {Math.round(h.marine.wavePeriod)}s
                            </span>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-teal-700 dark:text-teal-300 border-r border-slate-300 dark:border-slate-700">
                    Direção Onda (°)
                  </th>
                  {hours.map((h, idx) => (
                    <td
                      key={h.timestampUnix}
                      onClick={() => onSelectHourIndex(idx)}
                      className="px-1 py-1 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50"
                    >
                      <DirectionArrow degree={h.marine?.waveDirection} label="Direção da Onda" />
                    </td>
                  ))}
                </tr>
              </>
            )}

            {/* 11. Precipitation (mm/h) */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-sky-700 dark:text-sky-300 border-r border-slate-300 dark:border-slate-700">
                Chuva (mm/h)
              </th>
              {hours.map((h, idx) => {
                const val = isNative
                  ? nativeList[idx]?.precipitation ?? null
                  : h.precipitationMm.mean;
                return (
                  <td
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    className={`px-1 py-1.5 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 ${getRainBgClass(
                      val,
                    )}`}
                  >
                    {val !== null && val > 0 ? val.toFixed(1) : '0'}
                  </td>
                );
              })}
            </tr>

            {/* 12. Temperature 2m (°C) */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700">
                Temp 2m (°C)
              </th>
              {hours.map((h, idx) => {
                const val = isNative
                  ? nativeList[idx]?.temperature2m ?? null
                  : h.temperature2mC.mean;
                return (
                  <td
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    className="px-1 py-1.5 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 text-slate-800 dark:text-slate-200 font-semibold"
                  >
                    {val !== null ? Math.round(val) : '—'}
                  </td>
                );
              })}
            </tr>

            {/* 13. Surface Pressure (hPa) */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700">
                Pressão (hPa)
              </th>
              {hours.map((h, idx) => {
                const val = isNative
                  ? nativeList[idx]?.surfacePressure ?? null
                  : h.surfacePressureHpa.mean;
                return (
                  <td
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    className={`px-1 py-1.5 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 ${
                      h.barometricSquallRisk
                        ? 'bg-red-500/25 text-red-900 dark:text-red-200 font-extrabold'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {val !== null ? Math.round(val) : '—'}
                  </td>
                );
              })}
            </tr>

            {/* 14. Stratified Clouds Low / Mid / High (%) */}
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5 text-left font-sans font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700">
                Nuvens B/M/A (%)
              </th>
              {hours.map((h, idx) => {
                const low = isNative
                  ? nativeList[idx]?.cloudCoverLow ?? 0
                  : h.cloudCover.lowPct.mean ?? 0;
                const mid = isNative
                  ? nativeList[idx]?.cloudCoverMid ?? 0
                  : h.cloudCover.midPct.mean ?? 0;
                const high = isNative
                  ? nativeList[idx]?.cloudCoverHigh ?? 0
                  : h.cloudCover.highPct.mean ?? 0;
                return (
                  <td
                    key={h.timestampUnix}
                    onClick={() => onSelectHourIndex(idx)}
                    title={`Baixa: ${Math.round(low)}% | Média: ${Math.round(mid)}% | Alta: ${Math.round(high)}%`}
                    className="px-1 py-1 cursor-pointer border-r border-slate-200/50 dark:border-slate-800/50 text-[9px] leading-tight text-slate-600 dark:text-slate-400"
                  >
                    <div>{Math.round(high)}</div>
                    <div>{Math.round(mid)}</div>
                    <div className="font-bold text-slate-900 dark:text-slate-200">
                      {Math.round(low)}
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
};
