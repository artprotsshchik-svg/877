import { useEffect, useMemo, useState } from 'react';
import type { ModItem } from '../data/modsData.ts';
import type {
  AssemblyImpactSummary,
  AssemblyPreferences,
  ContextualModImpact,
} from '../utils/modTypes.ts';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ExternalLink,
  Trash2,
  X,
} from 'lucide-react';

export interface AnalyzedAssemblyModRow {
  mod: ModItem;
  impact: ContextualModImpact;
  artifactDeltaPct: number;
  groupTitle: string;
}

interface AssemblyDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: AssemblyImpactSummary;
  prefs: AssemblyPreferences;
  analyzedMods: AnalyzedAssemblyModRow[];
  onInspectMod: (mod: ModItem) => void;
  onRemoveMod: (modId: string) => void;
  onReplaceMod: (oldId: string, newId: string) => void;
  onAutoFix?: () => void;
  onOpenDubiousModal: () => void;
}

type ModalFilter = 'all' | 'core' | 'conditional' | 'issues';

export function AssemblyDetailModal({
  isOpen,
  onClose,
  summary,
  analyzedMods,
  onInspectMod,
  onRemoveMod,
  onReplaceMod,
  onAutoFix,
  onOpenDubiousModal,
}: AssemblyDetailModalProps) {
  const [modFilter, setModFilter] = useState<ModalFilter>('all');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const filteredMods = useMemo(() => {
    const list = analyzedMods.filter(row => {
      if (modFilter === 'core') {
        return row.impact.level === 'core' || row.impact.level === 'high';
      }
      if (modFilter === 'conditional') {
        return row.impact.level === 'conditional' || row.impact.level === 'support' || row.impact.level === 'diagnostic';
      }
      if (modFilter === 'issues') {
        return (
          row.impact.level === 'negative' ||
          row.impact.level === 'zero' ||
          Boolean(row.impact.betterAnalogId) ||
          row.artifactDeltaPct >= 4
        );
      }
      return true;
    });
    return [...list].sort((a, b) => {
      if (modFilter === 'issues') {
        return (
          (b.impact.betterAnalogDeltaPoints ?? 0) - (a.impact.betterAnalogDeltaPoints ?? 0) ||
          b.artifactDeltaPct - a.artifactDeltaPct ||
          a.impact.impactPoints - b.impact.impactPoints
        );
      }
      return (
        b.impact.impactPoints - a.impact.impactPoints ||
        b.impact.relativeImpactPct - a.impact.relativeImpactPct ||
        a.mod.name.localeCompare(b.mod.name, 'ru')
      );
    });
  }, [analyzedMods, modFilter]);

  if (!isOpen) return null;

  const { scoreBreakdown, artifactRisk, resourceBalance, synergies, overlaps } = summary;
  const swapCount = analyzedMods.filter(r => Boolean(r.impact.betterAnalogId)).length;
  const issueCount = resourceBalance.redundantCount + resourceBalance.conflictCount + swapCount;

  const factors = [
    { label: 'Эффективность', weight: '38%', value: scoreBreakdown.efficiencyScore },
    { label: 'Стабильность', weight: '30%', value: scoreBreakdown.stabilityScore },
    { label: 'Чистота связки', weight: '18%', value: scoreBreakdown.cleanlinessScore },
    { label: 'Визуальная безопасность', weight: '14%', value: scoreBreakdown.visualSafetyScore },
  ];

  const hasRiskyDubious = summary.dubiousMods.some(d => d.severity === 'high' || d.severity === 'medium');

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Детальный разбор сборки"
    >
      <div
        className="w-full max-w-4xl max-h-[88vh] bg-[#1a1d21] border border-[#2a2e33] rounded-[6px] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#2a2e33] bg-[#121417] flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0 flex items-baseline gap-2.5">
            <h2 className="text-base font-semibold text-[#e6e8ea] tracking-tight">
              Разбор сборки
            </h2>
            <span className="text-xs font-mono text-[#8b9199] tabular-nums">
              {analyzedMods.length} модов · {resourceBalance.effectiveCount} активных
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {summary.dubiousMods.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenDubiousModal();
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] border text-xs font-semibold transition-colors duration-150 whitespace-nowrap tabular-nums ${
                  hasRiskyDubious
                    ? 'bg-[#e5a93c]/15 hover:bg-[#e5a93c]/25 border-[#e5a93c]/60 text-[#f2bc52]'
                    : 'bg-[#5cb3ff]/15 hover:bg-[#5cb3ff]/25 border-[#5cb3ff]/55 text-[#6ec1ff]'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {hasRiskyDubious ? `Сомнительные (${summary.dubiousMods.length})` : `Нюансы (${summary.dubiousMods.length})`}
              </button>
            )}
            {onAutoFix && (resourceBalance.conflictCount > 0 || resourceBalance.redundantCount > 0) && (
              <button
                type="button"
                onClick={onAutoFix}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#3ddc84] hover:bg-[#34c776] text-[#121417] text-xs font-semibold transition-colors duration-150 whitespace-nowrap"
              >
                Оптимизировать
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-[4px] text-[#8b9199] hover:text-[#e6e8ea] hover:bg-[#22262b] transition-colors duration-150"
              aria-label="Закрыть детальный разбор"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Compact Top Summary: Multifactorial Average + Risks & Synergies */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 1. Multifactorial Average Score */}
            <div className="rounded-[6px] bg-[#121417] border border-[#2a2e33] p-3.5 space-y-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-[#e6e8ea]">Мультифакторная оценка</div>
                  <div className="text-[11px] text-[#8b9199]">Среднее по 4 ключевым факторам</div>
                </div>
                <span className="text-2xl font-semibold font-mono tabular-nums text-[#3ddc84]">
                  {summary.assemblyScore}
                  <span className="text-xs text-[#8b9199] font-normal">/100</span>
                </span>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-[#2a2e33] text-[11px] tabular-nums">
                {factors.map(f => {
                  const valCls =
                    f.value >= 80 ? 'text-[#3ddc84]' : f.value >= 55 ? 'text-[#e6e8ea]' : 'text-[#e5a93c]';
                  const barCls =
                    f.value >= 80 ? 'bg-[#3ddc84]' : f.value >= 55 ? 'bg-[#6ec1ff]' : 'bg-[#e5a93c]';
                  return (
                    <div key={f.label} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#b5bcc4]">
                          {f.label} <span className="text-[#8b9199] font-mono">({f.weight})</span>
                        </span>
                        <span className={`font-mono font-semibold ${valCls}`}>{f.value}/100</span>
                      </div>
                      <div className="h-1 rounded-[2px] bg-[#2a2e33] overflow-hidden">
                        <div className={`h-full ${barCls}`} style={{ width: `${Math.max(f.value, 2)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. Artifact Risk + Synergies & Overlaps */}
            <div className="rounded-[6px] bg-[#121417] border border-[#2a2e33] p-3.5 space-y-2.5 flex flex-col justify-between">
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-[#e6e8ea]">Шанс артефактов</span>
                  <span
                    className={`text-sm font-semibold font-mono tabular-nums ${
                      artifactRisk.level === 'critical'
                        ? 'text-[#e55353]'
                        : artifactRisk.level === 'high' || artifactRisk.level === 'moderate'
                          ? 'text-[#e5a93c]'
                          : 'text-[#3ddc84]'
                    }`}
                  >
                    {artifactRisk.chancePct}% · {artifactRisk.label}
                  </span>
                </div>
                <p className="text-[11px] text-[#8b9199] leading-snug">{artifactRisk.summary}</p>
              </div>

              <div className="pt-2 border-t border-[#2a2e33] space-y-1.5 max-h-28 overflow-y-auto pr-1 text-[11px]">
                {overlaps.map((ov, idx) => (
                  <div key={`ov-${idx}`} className="text-[#e5a93c] leading-snug">
                    <strong className="font-semibold">Пересечение ({ov.targetNames.join(' + ')}):</strong>{' '}
                    <span className="text-[#b5bcc4]">{ov.summary}</span>
                  </div>
                ))}
                {synergies.slice(0, 4).map((syn, idx) => (
                  <div key={`syn-${idx}`} className="text-[#3ddc84] leading-snug">
                    <strong className="font-semibold">{syn.targetNames.join(' + ')}:</strong>{' '}
                    <span className="text-[#9aa1aa]">{syn.summary}</span>
                  </div>
                ))}
                {synergies.length > 4 && (
                  <div className="text-[#8b9199] font-mono">+{synergies.length - 4} связок</div>
                )}
                {synergies.length === 0 && overlaps.length === 0 && (
                  <div className="text-[#8b9199]">Активных синергий и пересечений нет.</div>
                )}
              </div>
            </div>
          </div>

          {/* Compact Per-Mod Impact List */}
          <div className="rounded-[6px] bg-[#121417] border border-[#2a2e33] overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-[#2a2e33] flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#e6e8ea]">
                Импакт каждого мода ({filteredMods.length})
              </span>
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                {[
                  { k: 'all' as const, label: `Все (${analyzedMods.length})` },
                  { k: 'core' as const, label: 'Ядро / сильные' },
                  { k: 'conditional' as const, label: 'Условные' },
                  { k: 'issues' as const, label: `Замены / риск (${issueCount})` },
                ].map(f => (
                  <button
                    key={f.k}
                    type="button"
                    onClick={() => setModFilter(f.k)}
                    className={`px-2 py-1 rounded-[4px] transition-colors duration-150 whitespace-nowrap tabular-nums ${
                      modFilter === f.k ? 'bg-[#22262b] text-[#3ddc84] font-semibold' : 'text-[#8b9199] hover:text-[#e6e8ea]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-[#2a2e33] max-h-80 overflow-y-auto">
              {filteredMods.map(({ mod, impact, artifactDeltaPct }) => {
                const levelCls =
                  impact.level === 'negative'
                    ? 'text-[#e55353]'
                    : impact.level === 'zero' || impact.level === 'conditional'
                      ? 'text-[#e5a93c]'
                      : impact.level === 'core' || impact.level === 'high'
                        ? 'text-[#3ddc84]'
                        : 'text-[#8b9199]';

                return (
                  <div key={mod.id} className="px-3.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#22262b]">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onInspectMod(mod);
                          }}
                          className="font-semibold text-[#e6e8ea] hover:text-[#3ddc84] text-left"
                        >
                          {mod.name}
                        </button>
                        <span className={`font-mono font-semibold tabular-nums ${levelCls}`}>
                          {impact.impactPoints}/100
                        </span>
                        <span className="text-[11px] text-[#9aa1aa]">· {impact.label}</span>
                        {artifactDeltaPct > 0 && (
                          <span className="text-[11px] font-mono text-[#e5a93c] tabular-nums">
                            · +{artifactDeltaPct}% арт.
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#8b9199] truncate">{impact.summary}</p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {impact.betterAnalogId && impact.betterAnalogName && (
                        <button
                          type="button"
                          onClick={() => onReplaceMod(mod.id, impact.betterAnalogId!)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-[4px] bg-[#3ddc84] hover:bg-[#34c776] text-[#121417] text-[11px] font-semibold whitespace-nowrap"
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          {impact.betterAnalogName}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveMod(mod.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-[4px] bg-[#1a1d21] hover:bg-[#22262b] border border-[#2a2e33] hover:border-[#e55353]/50 text-[#8b9199] hover:text-[#e55353] text-[11px] whitespace-nowrap"
                        title="Убрать из сборки"
                      >
                        <Trash2 className="w-3 h-3" />
                        Убрать
                      </button>
                      <a
                        href={mod.curseforgeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded-[4px] text-[#8b9199] hover:text-[#e6e8ea]"
                        aria-label={`${mod.name} на CurseForge`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
              {filteredMods.length === 0 && (
                <div className="py-8 text-center text-xs text-[#8b9199] flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#3ddc84]" />
                  В этом фильтре модов нет.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
