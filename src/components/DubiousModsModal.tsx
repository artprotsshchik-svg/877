import { useEffect, useMemo, useState } from 'react';
import type { ModItem } from '../data/modsData.ts';
import type { ArtifactRiskProfile, DubiousModEntry } from '../utils/modTypes.ts';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Info,
  Trash2,
  X,
} from 'lucide-react';

interface DubiousModsModalProps {
  isOpen: boolean;
  onClose: () => void;
  dubiousMods: DubiousModEntry[];
  artifactRisk: ArtifactRiskProfile;
  totalModsCount: number;
  onRemoveMod: (modId: string) => void;
  onReplaceMod: (oldModId: string, newModId: string) => void;
  onRemoveAllRisky: (modIds: string[]) => void;
  onAutoFix?: () => void;
  onInspectMod: (mod: ModItem) => void;
}

type SeverityFilter = 'all' | 'high' | 'medium' | 'low';

export function DubiousModsModal({
  isOpen,
  onClose,
  dubiousMods,
  artifactRisk,
  totalModsCount,
  onRemoveMod,
  onReplaceMod,
  onRemoveAllRisky,
  onAutoFix,
  onInspectMod,
}: DubiousModsModalProps) {
  const [filter, setFilter] = useState<SeverityFilter>('all');

  const counts = useMemo(() => {
    let high = 0;
    let medium = 0;
    let low = 0;
    for (const d of dubiousMods) {
      if (d.severity === 'high') high++;
      else if (d.severity === 'medium') medium++;
      else low++;
    }
    return { high, medium, low, total: dubiousMods.length };
  }, [dubiousMods]);

  const visibleEntries = useMemo(() => {
    if (filter === 'all') return dubiousMods;
    return dubiousMods.filter(d => d.severity === filter);
  }, [dubiousMods, filter]);

  const removableRiskyIds = useMemo(
    () =>
      dubiousMods
        .filter(d => d.canRemoveSafely && (d.severity === 'high' || d.severity === 'medium'))
        .map(d => d.modId),
    [dubiousMods]
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const riskToneCls =
    artifactRisk.level === 'critical'
      ? 'text-[#e55353]'
      : artifactRisk.level === 'high' || artifactRisk.level === 'moderate'
        ? 'text-[#e5a93c]'
        : 'text-[#3ddc84]';

  const severityMeta = (sev: DubiousModEntry['severity']) => {
    if (sev === 'high') {
      return {
        label: 'Критический',
        textCls: 'text-[#ff7070]',
        stripeCls: 'bg-[#e55353]',
        rowCls: 'bg-[#e55353]/[0.09] border-[#e55353]/55',
      };
    }
    if (sev === 'medium') {
      return {
        label: 'Сомнительный',
        textCls: 'text-[#f2bc52]',
        stripeCls: 'bg-[#e5a93c]',
        rowCls: 'bg-[#e5a93c]/[0.08] border-[#e5a93c]/50',
      };
    }
    return {
      label: 'Нюанс',
      textCls: 'text-[#6ec1ff]',
      stripeCls: 'bg-[#5cb3ff]',
      rowCls: 'bg-[#5cb3ff]/[0.07] border-[#5cb3ff]/45',
    };
  };

  const onlyNuances = counts.total > 0 && counts.high === 0 && counts.medium === 0;
  const topBarColor =
    counts.high > 0
      ? 'bg-[#e55353]'
      : counts.medium > 0
        ? 'bg-[#e5a93c]'
        : counts.low > 0
          ? 'bg-[#5cb3ff]'
          : 'bg-[#3ddc84]';
  const modalBorderColor =
    counts.high > 0
      ? 'border-[#e55353]/60'
      : counts.medium > 0
        ? 'border-[#e5a93c]/60'
        : counts.low > 0
          ? 'border-[#5cb3ff]/55'
          : 'border-[#3ddc84]/50';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={onlyNuances ? 'Нюансы сборки' : 'Сомнительные моды и нюансы'}
    >
      <div
        className={`w-full max-w-2xl bg-[#1a1d21] border ${modalBorderColor} rounded-[6px] overflow-hidden flex flex-col max-h-[86vh] shadow-2xl`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`h-1 w-full ${topBarColor}`} aria-hidden="true" />

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#2a2e33] flex items-start justify-between gap-4 bg-[#121417]">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-base sm:text-lg font-semibold text-[#e6e8ea] flex items-center gap-2">
                {onlyNuances ? (
                  <Info className="w-4 h-4 text-[#6ec1ff] shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-[#f2bc52] shrink-0" />
                )}
                {onlyNuances
                  ? `Нюансы сборки (${counts.total})`
                  : `Нюансы и сомнительные моды (${counts.total})`}
              </h2>
              <span className="text-xs font-mono tabular-nums text-[#9aa1aa]">
                из {totalModsCount} в сборке
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
              <span className="text-[#b5bcc4]">
                Шанс артефактов:{' '}
                <strong className={`font-mono ${riskToneCls}`}>
                  {artifactRisk.chancePct}% · {artifactRisk.label}
                </strong>
              </span>
              {counts.high > 0 && (
                <span className="font-mono font-semibold text-[#ff7070]">
                  Критических: {counts.high}
                </span>
              )}
              {counts.medium > 0 && (
                <span className="font-mono font-semibold text-[#f2bc52]">
                  Сомнительных: {counts.medium}
                </span>
              )}
              {counts.low > 0 && (
                <span className="font-mono font-semibold text-[#6ec1ff]">
                  Нюансов: {counts.low}
                </span>
              )}
            </div>

            {counts.total > 0 && (
              <p className="text-xs text-[#9aa1aa]">
                {onlyNuances
                  ? 'Важные особенности работы выбранных модов: на что обратить внимание в игре или при настройке.'
                  : 'Замена или удаление позиций ниже снижает риск визуальных глитчей, балласта и падений.'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-[4px] text-[#9aa1aa] hover:text-[#e6e8ea] hover:bg-[#22262b] transition-colors duration-150 shrink-0"
            aria-label="Закрыть окно нюансов и сомнительных модов"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter & Bulk Actions Bar */}
        {counts.total > 0 && (
          <div className="px-5 py-2.5 border-b border-[#2a2e33] flex flex-wrap items-center justify-between gap-2 bg-[#14171b]">
            <div className="flex flex-wrap items-center gap-1 text-xs">
              {[
                { k: 'all' as const, label: `Все (${counts.total})` },
                { k: 'high' as const, label: `Критические (${counts.high})` },
                { k: 'medium' as const, label: `Сомнительные (${counts.medium})` },
                { k: 'low' as const, label: `Нюансы (${counts.low})` },
              ]
                .filter(tab => tab.k === 'all' || counts[tab.k] > 0)
                .map(tab => (
                  <button
                    key={tab.k}
                    type="button"
                    onClick={() => setFilter(tab.k)}
                    className={`px-2.5 py-1 rounded-[4px] font-medium transition-colors duration-150 whitespace-nowrap tabular-nums ${
                      filter === tab.k
                        ? 'bg-[#22262b] text-[#3ddc84] font-semibold border border-[#3ddc84]/40'
                        : 'text-[#9aa1aa] hover:text-[#e6e8ea] border border-transparent'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {removableRiskyIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onRemoveAllRisky(removableRiskyIds)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#1a1d21] hover:bg-[#22262b] border border-[#e55353]/50 text-[#ff7070] text-xs font-medium transition-colors duration-150 whitespace-nowrap tabular-nums"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Убрать рискованные ({removableRiskyIds.length})
                </button>
              )}
              {onAutoFix && (counts.high > 0 || counts.medium > 0) && (
                <button
                  type="button"
                  onClick={onAutoFix}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#3ddc84] hover:bg-[#34c776] text-[#121417] text-xs font-semibold transition-colors duration-150 whitespace-nowrap"
                >
                  Исправить сборку
                </button>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
          {counts.total === 0 ? (
            <div className="py-10 text-center space-y-2">
              <CheckCircle2 className="w-7 h-7 text-[#3ddc84] mx-auto" />
              <div className="text-sm font-semibold text-[#e6e8ea]">Нюансов и сомнительных модов нет</div>
              <p className="text-xs text-[#9aa1aa] max-w-md mx-auto">
                Выбранные моды совместимы и не содержат лишних дублей, конфликтов или спорных компромиссов.
              </p>
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#9aa1aa]">
              В выбранном фильтре модов нет.
            </div>
          ) : (
            visibleEntries.map(entry => {
              const meta = severityMeta(entry.severity);
              return (
                <div
                  key={entry.modId}
                  className={`border rounded-[6px] overflow-hidden flex ${meta.rowCls}`}
                >
                  <div className={`w-1 shrink-0 ${meta.stripeCls}`} aria-hidden="true" />
                  <div className="p-3.5 flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                        <span className={`font-semibold ${meta.textCls}`}>{meta.label}</span>
                        <span className="text-[#8b9199]" aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={() => onInspectMod(entry.mod)}
                          className="text-sm font-semibold text-[#e6e8ea] hover:text-[#3ddc84] text-left transition-colors duration-150"
                        >
                          {entry.mod.name}
                        </button>
                        {entry.artifactContributionPct > 0 && (
                          <span className="text-[11px] font-mono text-[#f2bc52] tabular-nums">
                            +{entry.artifactContributionPct}% к артефактам
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#d0d5dc] leading-relaxed">{entry.reason}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {entry.replacementId && entry.replacementName && (
                        <button
                          type="button"
                          onClick={() => onReplaceMod(entry.modId, entry.replacementId!)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[4px] bg-[#3ddc84] hover:bg-[#34c776] text-[#121417] text-[11px] font-semibold transition-colors duration-150 whitespace-nowrap"
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          Заменить на {entry.replacementName}
                        </button>
                      )}
                      {entry.canRemoveSafely && (
                        <button
                          type="button"
                          onClick={() => onRemoveMod(entry.modId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[4px] bg-[#1a1d21] hover:bg-[#22262b] border border-[#2a2e33] hover:border-[#e55353]/50 text-[#e6e8ea] hover:text-[#ff7070] text-[11px] font-medium transition-colors duration-150 whitespace-nowrap"
                        >
                          <Trash2 className="w-3 h-3" />
                          Убрать
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
