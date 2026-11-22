import React from 'react';

export interface SkeletonProps {
  className?: string;
}

export const PulseBlock: React.FC<SkeletonProps> = ({ className = '' }) => (
  <div
    aria-hidden="true"
    className={`animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800/80 ${className}`}
  />
);

export const SummaryCardSkeleton: React.FC = () => (
  <div
    role="status"
    aria-label="Carregando resumo meteorológico..."
    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-sm"
  >
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="space-y-2">
        <PulseBlock className="h-6 w-52" />
        <PulseBlock className="h-4 w-72" />
      </div>
      <div className="flex items-center gap-3">
        <PulseBlock className="h-11 w-32" />
        <PulseBlock className="h-11 w-36" />
      </div>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-2">
      <PulseBlock className="h-24 w-full" />
      <PulseBlock className="h-24 w-full" />
      <PulseBlock className="h-24 w-full" />
      <PulseBlock className="h-24 w-full" />
      <PulseBlock className="h-24 w-full" />
    </div>
  </div>
);

export const ChartSkeleton: React.FC<{ title?: string }> = ({ title }) => (
  <div
    role="status"
    aria-label={title ? `Carregando gráfico ${title}` : 'Carregando gráficos horários...'}
    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-sm"
  >
    <div className="flex items-center justify-between">
      <PulseBlock className="h-5 w-48" />
      <PulseBlock className="h-8 w-28" />
    </div>
    <PulseBlock className="h-64 w-full" />
  </div>
);

export const TableSkeleton: React.FC = () => (
  <div
    role="status"
    aria-label="Carregando tabela horária 168h..."
    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 shadow-sm"
  >
    <PulseBlock className="h-6 w-64" />
    <div className="space-y-2">
      <PulseBlock className="h-8 w-full" />
      <PulseBlock className="h-8 w-full" />
      <PulseBlock className="h-8 w-full" />
      <PulseBlock className="h-8 w-full" />
      <PulseBlock className="h-8 w-full" />
      <PulseBlock className="h-8 w-full" />
    </div>
  </div>
);

export const ForecastSkeleton: React.FC = () => (
  <div className="space-y-6" aria-busy="true" aria-live="polite">
    <SummaryCardSkeleton />
    <PulseBlock className="h-14 w-full" />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartSkeleton title="Vento e Perfil Vertical" />
      <ChartSkeleton title="Ondas e Precipitação" />
    </div>
    <TableSkeleton />
  </div>
);
