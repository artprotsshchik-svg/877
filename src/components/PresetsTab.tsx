import { useMemo, useState } from 'react';
import {
  MODS_DATABASE,
  MOD_PRESETS,
  type ModItem,
  type ModPreset,
} from '../data/modsData.ts';
import {
  cleanModDescription,
  formatShortOneLineDescription,
} from '../utils/displayFormatters.ts';
import {
  evaluateAssemblyHealth,
  summarizeAssemblyImpact,
} from '../utils/modLogic.ts';
import { estimateFpsRange } from '../utils/fpsEstimator.ts';
import {
  buildPresetModRows,
  filterPresetModRows,
  getEvalPrefsForPreset,
  getInteractionKindMeta,
  getPresetDiffSummary,
  type PresetReactionFilter,
} from '../utils/presetInspector.ts';
import { StatusBadge } from './StatusBadge.tsx';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  GitCompareArrows,
  Info,
  RotateCcw,
  Search,
} from 'lucide-react';

interface PresetsTabProps {
  onLoadToChecker: (preset: ModPreset) => void;
  onLoadToBuilder: (preset: ModPreset) => void;
  onOpenDetail: (mod: ModItem) => void;
}

const MOD_BY_ID = new Map(MODS_DATABASE.map(m => [m.id, m]));

const REACTION_FILTER_OPTIONS: Array<{ value: PresetReactionFilter; label: string }> = [
  { value: 'all', label: 'Все реакции в сборке' },
  { value: 'core', label: 'Ядро / Сильный буст' },
  { value: 'synergy', label: 'Синергии связки' },
  { value: 'support', label: 'Опора / Библиотеки / QoL' },
  { value: 'moderate', label: 'Умеренный эффект / Диагностика' },
  { value: 'caution', label: 'Нюансы / Контекст' },
];

export function PresetsTab({
  onLoadToChecker,
  onLoadToBuilder,
  onOpenDetail,
}: PresetsTabProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    () => MOD_PRESETS[0]?.id ?? 'user-nvidium-emberbium'
  );
  const [copiedPresetId, setCopiedPresetId] = useState<string | null>(null);
  const [copiedConfigId, setCopiedConfigId] = useState<string | null>(null);

  // Catalog-style inspector filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Все');
  const [reactionFilter, setReactionFilter] = useState<PresetReactionFilter>('all');
  const [onlyDiffFromPair, setOnlyDiffFromPair] = useState(false);
  const [expandedModIds, setExpandedModIds] = useState<Record<string, boolean>>({});

  const evaluatedPresets = useMemo(
    () =>
      MOD_PRESETS.map(preset => {
        const evalPrefs = getEvalPrefsForPreset(preset);
        const health = evaluateAssemblyHealth(preset.modIds);
        const summary = summarizeAssemblyImpact(preset.modIds, health, evalPrefs);
        const fps = estimateFpsRange(preset.modIds, summary, evalPrefs);
        const redCount =
          health.conflicts.length + health.warnings.filter(w => w.severity === 'red').length;
        const yellowCount = health.warnings.filter(w => w.severity === 'yellow').length;
        return {
          preset,
          health,
          summary,
          fps,
          redCount,
          yellowCount,
        };
      }),
    []
  );

  const activePreset = useMemo(
    () => MOD_PRESETS.find(p => p.id === selectedPresetId) ?? MOD_PRESETS[0],
    [selectedPresetId]
  );

  const counterpartPreset = useMemo(
    () => MOD_PRESETS.find(p => p.id !== activePreset?.id) ?? null,
    [activePreset]
  );

  const diffFromCounterpart = useMemo(() => {
    if (!activePreset || !counterpartPreset) return null;
    return getPresetDiffSummary(activePreset, counterpartPreset);
  }, [activePreset, counterpartPreset]);

  const activeRows = useMemo(
    () => (activePreset ? buildPresetModRows(activePreset) : []),
    [activePreset]
  );

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const row of activeRows) {
      seen.add(row.mod.category);
    }
    return ['Все', ...Array.from(seen)];
  }, [activeRows]);

  const counterpartIdSet = useMemo(
    () => new Set(counterpartPreset?.modIds ?? []),
    [counterpartPreset]
  );

  const filteredRows = useMemo(() => {
    const base = filterPresetModRows(activeRows, {
      query: searchQuery,
      category: selectedCategory,
      reaction: reactionFilter,
    });
    if (!onlyDiffFromPair || !counterpartPreset) return base;
    return base.filter(row => !counterpartIdSet.has(row.mod.id));
  }, [activeRows, searchQuery, selectedCategory, reactionFilter, onlyDiffFromPair, counterpartPreset, counterpartIdSet]);

  const allFilteredExpanded =
    filteredRows.length > 0 && filteredRows.every(row => Boolean(expandedModIds[row.mod.id]));

  const handleToggleExpandAll = () => {
    if (allFilteredExpanded) {
      setExpandedModIds(prev => {
        const next = { ...prev };
        for (const row of filteredRows) {
          delete next[row.mod.id];
        }
        return next;
      });
    } else {
      setExpandedModIds(prev => {
        const next = { ...prev };
        for (const row of filteredRows) {
          next[row.mod.id] = true;
        }
        return next;
      });
    }
  };

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    setSelectedCategory('Все');
  };

  const resetInspectorFilters = () => {
    setSearchQuery('');
    setSelectedCategory('Все');
    setReactionFilter('all');
    setOnlyDiffFromPair(false);
  };

  const handleCopyNamesList = (preset: ModPreset) => {
    const rows = buildPresetModRows(preset);
    const orderedNames = rows.map(r => r.mod.name);
    if (preset.id === 'user-nvidium-emberbium') {
      orderedNames.unshift('.connector (авто-кэш Sinytra Connector для Nvidium)');
    }
    navigator.clipboard?.writeText?.(orderedNames.join('\n'))?.catch(() => {});
    setCopiedPresetId(preset.id);
    setTimeout(() => setCopiedPresetId(prev => (prev === preset.id ? null : prev)), 1800);
  };

  const getRenderLabel = (preset: ModPreset) => {
    const set = new Set(preset.modIds);
    if (set.has('emberbium') && set.has('nvidium')) return 'Emberbium + Nvidium';
    if (set.has('oculus') && set.has('alloyium')) return 'Embeddium + Oculus + Alloyium';
    if (set.has('oculus')) return 'Embeddium + Oculus';
    if (set.has('alloyium')) return 'Embeddium + Alloyium';
    return 'Embeddium';
  };

  const getSinytraLabel = (preset: ModPreset) => {
    const set = new Set(preset.modIds);
    return set.has('sinytra-connector') ? 'Да (FFAPI + Extras + .connector)' : 'Нет (чистый Forge)';
  };

  const getBadgeTone = (color: ModPreset['badgeColor']) => {
    switch (color) {
      case 'emerald':
        return 'text-[#3ddc84]';
      case 'sky':
        return 'text-[#5cb3ff]';
      case 'violet':
        return 'text-[#b794f4]';
      case 'amber':
        return 'text-[#e5a93c]';
      case 'rose':
        return 'text-[#f0758c]';
      default:
        return 'text-[#8b9199]';
    }
  };

  if (!activePreset) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Compact Comparison Matrix */}
      {evaluatedPresets.length >= 2 && (() => {
        const rows = [
          {
            label: 'Рендер-связка',
            values: evaluatedPresets.map(e => getRenderLabel(e.preset)),
          },
          {
            label: 'Sinytra Connector',
            values: evaluatedPresets.map(e => getSinytraLabel(e.preset)),
          },
          {
            label: 'Прогноз FPS / ОЗУ',
            values: evaluatedPresets.map(
              e => `${e.fps.shortLabel.replace(' (оценка)', '')} · ${e.summary.resourceBalance.ramDeltaLabel}`
            ),
          },
          {
            label: 'Шанс артефактов',
            values: evaluatedPresets.map(
              e => `${e.summary.artifactRisk.chancePct}% · ${e.summary.artifactRisk.label}`
            ),
          },
          {
            label: 'Итог (Оценка · Моды · Подсистемы)',
            values: evaluatedPresets.map(
              e =>
                `${e.summary.assemblyScore}/100 · ${e.preset.modIds.length} м. · ${e.summary.coveredSubsystems.length}/7`
            ),
          },
        ];

        return (
          <div className="bg-[#1a1d21] border border-[#2a2e33] rounded-[6px] overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#2a2e33] bg-[#121417] text-[#8b9199]">
                  <th className="py-2 px-3.5 font-semibold whitespace-nowrap">Критерий</th>
                  {evaluatedPresets.map(({ preset }) => {
                    const isSelected = preset.id === activePreset.id;
                    return (
                      <th
                        key={preset.id}
                        className={`py-2 px-3.5 font-semibold whitespace-nowrap ${
                          isSelected ? 'text-[#3ddc84]' : 'text-[#e6e8ea]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectPreset(preset.id)}
                          className="hover:text-[#3ddc84] transition-colors duration-150 text-left"
                        >
                          {preset.name.split('(')[0].trim()}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2e33]">
                {rows.map(r => (
                  <tr key={r.label} className="hover:bg-[#22262b] transition-colors duration-150">
                    <td className="py-2 px-3.5 text-[#8b9199] font-medium whitespace-nowrap">{r.label}</td>
                    {r.values.map((val, idx) => (
                      <td
                        key={`${r.label}-${idx}`}
                        className="py-2 px-3.5 text-[#e6e8ea] font-mono tabular-nums whitespace-nowrap"
                      >
                        {val}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Two Curated Preset Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {evaluatedPresets.map(
          ({
            preset,
            summary: presetSummary,
            fps: presetFps,
            redCount: presetRedCount,
            yellowCount: presetYellowCount,
          }) => {
            const isSelected = preset.id === activePreset.id;
            const otherPreset = evaluatedPresets.find(e => e.preset.id !== preset.id)?.preset ?? null;
            const cardDiff = otherPreset ? getPresetDiffSummary(preset, otherPreset) : null;
            const badgeTone = getBadgeTone(preset.badgeColor);

            return (
              <div
                key={preset.id}
                data-preset-card={preset.id}
                className={`bg-[#1a1d21] border rounded-[6px] p-4 flex flex-col justify-between gap-3.5 transition-colors duration-150 ${
                  isSelected ? 'border-[#3ddc84]' : 'border-[#2a2e33] hover:border-[#3a4047]'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-0.5 min-w-0">
                      <span className={`text-[11px] font-medium block ${badgeTone}`}>
                        {preset.badge}
                      </span>
                      <h2 className="text-base font-semibold text-[#e6e8ea] leading-snug">
                        {preset.name}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectPreset(preset.id)}
                      className={`shrink-0 px-2.5 py-1 rounded-[4px] text-[11px] font-semibold border transition-colors duration-150 whitespace-nowrap ${
                        isSelected
                          ? 'bg-[#3ddc84]/15 border-[#3ddc84] text-[#3ddc84]'
                          : 'bg-[#121417] border-[#2a2e33] text-[#e6e8ea] hover:bg-[#22262b]'
                      }`}
                    >
                      {isSelected ? 'Открыта в списке' : 'Смотреть состав'}
                    </button>
                  </div>

                  <p className="text-xs text-[#8b9199] leading-relaxed">{preset.description}</p>

                  <div className="rounded-[4px] bg-[#121417] border border-[#2a2e33] px-3 py-2.5 space-y-1.5 text-[11px]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#8b9199] tabular-nums">
                      <span>
                        Оценка: <strong className="text-[#3ddc84] font-mono">{presetSummary.assemblyScore}/100</strong>
                      </span>
                      <span>
                        Артефакты:{' '}
                        <strong
                          className={`font-mono ${
                            presetSummary.artifactRisk.level === 'critical'
                              ? 'text-[#e55353]'
                              : presetSummary.artifactRisk.level === 'high' || presetSummary.artifactRisk.level === 'moderate'
                                ? 'text-[#e5a93c]'
                                : 'text-[#3ddc84]'
                          }`}
                        >
                          {presetSummary.artifactRisk.chancePct}% · {presetSummary.artifactRisk.label}
                        </strong>
                      </span>
                      <span>
                        Прогноз:{' '}
                        <strong className="text-[#3ddc84] font-mono">
                          {presetFps.label}
                        </strong>{' '}
                        <span className="text-[#8b9199]">/</span>{' '}
                        <strong className="text-[#e6e8ea] font-mono">
                          {presetSummary.resourceBalance.ramDeltaLabel}
                        </strong>
                      </span>
                      <span
                        className={`font-mono font-medium ${
                          presetRedCount > 0
                            ? 'text-[#e55353]'
                            : presetYellowCount > 0
                              ? 'text-[#e5a93c]'
                              : 'text-[#3ddc84]'
                        }`}
                      >
                        {presetRedCount} конфл. / {presetYellowCount} замеч. ({preset.modIds.length} модов)
                      </span>
                    </div>
                    <div className="text-[#8b9199]">
                      <strong className="text-[#e6e8ea]">Риск:</strong> {preset.crashRisk}
                    </div>
                    {cardDiff && (
                      <div className="text-[#8b9199] pt-1 border-t border-[#2a2e33]/70">
                        <strong className="text-[#e6e8ea]">Отличие от второй сборки:</strong>{' '}
                        <span className="text-[#e6e8ea]">
                          {cardDiff.onlyInReference.map(m => m.name).join(', ')}
                        </span>{' '}
                        <span className="font-mono text-[#8b9199]">
                          (+ {cardDiff.sharedCount} общих модов)
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-[#2a2e33] flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyNamesList(preset)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] bg-[#3ddc84] hover:bg-[#34c776] text-[#0f1411] text-xs font-semibold transition-colors duration-150 whitespace-nowrap"
                  >
                    {copiedPresetId === preset.id ? (
                      <>
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        Список скопирован
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        Копировать список
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadToBuilder(preset)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] bg-[#121417] hover:bg-[#22262b] border border-[#2a2e33] text-[#e6e8ea] text-xs font-medium transition-colors duration-150 whitespace-nowrap"
                  >
                    В Подбор
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadToChecker(preset)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] bg-[#121417] hover:bg-[#22262b] border border-[#2a2e33] text-[#e6e8ea] text-xs font-medium transition-colors duration-150 whitespace-nowrap ml-auto"
                  >
                    В Чекер
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          }
        )}
      </div>

      {/* Catalog-Style Filter Bar for Active Preset */}
      <div className="bg-[#1a1d21] border border-[#2a2e33] rounded-[6px] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#2a2e33]">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[#8b9199]">Разбор сборки:</span>
            <span className="font-semibold text-[#e6e8ea]">{activePreset.name}</span>
            {activePreset.id === 'user-nvidium-emberbium' && (
              <span className="px-2 py-0.5 rounded-[4px] bg-[#121417] border border-[#2a2e33] text-[11px] font-mono text-[#5cb3ff]">
                + .connector (кэш Sinytra)
              </span>
            )}
          </div>
          <span className="text-[11px] text-[#8b9199]">
            Нажмите на строку мода, чтобы увидеть для чего он и как реагирует с остальными
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
          <div className="md:col-span-6 relative">
            <Search
              className="w-3.5 h-3.5 text-[#8b9199] absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              data-search-input="true"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по моду, назначению или реакции в сборке… (/)"
              aria-label="Поиск модов в выбранной сборке"
              className="w-full pl-9 pr-3 py-1.5 bg-[#121417] border border-[#2a2e33] rounded-[4px] text-xs text-[#e6e8ea] placeholder-[#8b9199] focus:border-[#3ddc84] transition-colors duration-150"
            />
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Категория модов в сборке"
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#121417] border border-[#2a2e33] rounded-[4px] text-xs text-[#e6e8ea] focus:border-[#3ddc84] transition-colors duration-150"
            >
              {categories.map(c => (
                <option key={c} value={c}>
                  {c === 'Все' ? 'Все категории' : c}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Фильтр по реакции мода в сборке"
              value={reactionFilter}
              onChange={e => setReactionFilter(e.target.value as PresetReactionFilter)}
              className="w-full px-3 py-1.5 bg-[#121417] border border-[#2a2e33] rounded-[4px] text-xs text-[#e6e8ea] focus:border-[#3ddc84] transition-colors duration-150"
            >
              {REACTION_FILTER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#2a2e33]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleToggleExpandAll}
              disabled={filteredRows.length === 0}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-xs font-medium border transition-colors duration-150 whitespace-nowrap disabled:opacity-40 ${
                allFilteredExpanded
                  ? 'bg-[#22262b] border-[#3ddc84] text-[#e6e8ea]'
                  : 'bg-[#121417] border-[#2a2e33] text-[#8b9199] hover:text-[#e6e8ea] hover:bg-[#22262b]'
              }`}
            >
              {allFilteredExpanded ? (
                <>
                  <ChevronsDownUp className="w-3.5 h-3.5 text-[#3ddc84]" aria-hidden="true" />
                  Свернуть все
                </>
              ) : (
                <>
                  <ChevronsUpDown className="w-3.5 h-3.5" aria-hidden="true" />
                  Раскрыть все
                </>
              )}
            </button>

            {diffFromCounterpart && (
              <button
                type="button"
                onClick={() => setOnlyDiffFromPair(v => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-xs font-medium border transition-colors duration-150 whitespace-nowrap ${
                  onlyDiffFromPair
                    ? 'bg-[#22262b] border-[#3ddc84] text-[#e6e8ea]'
                    : 'bg-[#121417] border-[#2a2e33] text-[#8b9199] hover:text-[#e6e8ea] hover:bg-[#22262b]'
                }`}
              >
                <GitCompareArrows
                  className={`w-3.5 h-3.5 ${onlyDiffFromPair ? 'text-[#3ddc84]' : ''}`}
                  aria-hidden="true"
                />
                Только отличия ({diffFromCounterpart.onlyInReference.length})
              </button>
            )}
          </div>

          <span className="text-xs text-[#8b9199] font-mono tabular-nums">
            {filteredRows.length} из {activeRows.length} модов
          </span>
        </div>
      </div>

      {/* Catalog-Style Mod Rows List */}
      {filteredRows.length === 0 ? (
        <div className="bg-[#1a1d21] border border-[#2a2e33] rounded-[6px] p-10 text-center space-y-3">
          <p className="text-sm font-medium text-[#e6e8ea]">
            По текущим фильтрам моды в сборке не найдены
          </p>
          <p className="text-xs text-[#8b9199]">
            Попробуйте сбросить категорию, фильтр реакции или очистить строку поиска.
          </p>
          <button
            type="button"
            onClick={resetInspectorFilters}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] bg-[#3ddc84] hover:bg-[#34c776] text-[#0f1411] text-xs font-semibold transition-colors duration-150 whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <div className="bg-[#1a1d21] border border-[#2a2e33] rounded-[6px] divide-y divide-[#2a2e33] overflow-hidden">
          {filteredRows.map(row => {
            const isExpanded = Boolean(expandedModIds[row.mod.id]);
            const relPctStr =
              row.impact.relativeImpactPct > 0
                ? `+${row.impact.relativeImpactPct}%`
                : `${row.impact.relativeImpactPct}%`;
            const isUniqueToActive = counterpartPreset && !counterpartIdSet.has(row.mod.id);

            const rowTint =
              row.impact.level === 'negative'
                ? 'bg-[#e55353]/[0.04] hover:bg-[#22262b]'
                : row.impact.coUsageVerdict === 'overlap' || row.impact.level === 'zero'
                  ? 'bg-[#e5a93c]/[0.03] hover:bg-[#22262b]'
                  : 'hover:bg-[#22262b]';

            return (
              <div
                key={row.mod.id}
                data-mod-row="true"
                data-mod-id={row.mod.id}
                tabIndex={0}
                className={`px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 transition-colors duration-150 focus:bg-[#22262b] ${rowTint}`}
              >
                <div className="min-w-0 flex-1">
                  {/* Top meta line (Catalog style) */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="text-[11px] font-mono text-[#8b9199] tabular-nums">
                      #{row.index}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenDetail(row.mod)}
                      className="text-sm font-semibold text-[#e6e8ea] hover:text-[#3ddc84] text-left transition-colors duration-150"
                    >
                      {row.mod.name}
                    </button>
                    {row.parentMod && (
                      <span className="px-1.5 py-0.5 rounded-[4px] border border-[#2a2e33] bg-[#121417] text-[10px] text-[#8b9199]">
                        ↳ к {row.parentMod.name}
                      </span>
                    )}
                    {isUniqueToActive && (
                      <span className="px-1.5 py-0.5 rounded-[4px] border border-[#3ddc84]/40 bg-[#3ddc84]/10 text-[10px] font-medium text-[#3ddc84]">
                        Отличие сборки
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded-[4px] border border-[#2a2e33] bg-[#121417] text-[10px] font-mono text-[#8b9199]">
                      {row.loader}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-[4px] border border-[#2a2e33] bg-[#121417] text-[10px] text-[#8b9199]">
                      {row.env}
                    </span>
                    <StatusBadge
                      tier={row.healthTier}
                      label={row.statusLabel}
                      className="text-[11px]"
                    />
                    <span className={`text-[11px] font-medium ${row.reactionBadge.textCls}`}>
                      · {row.reactionBadge.label}
                    </span>
                    <span
                      className={`font-mono font-semibold text-[11px] tabular-nums ${
                        row.impact.relativeImpactPct > 0
                          ? 'text-[#3ddc84]'
                          : row.impact.relativeImpactPct < 0
                            ? 'text-[#e55353]'
                            : 'text-[#8b9199]'
                      }`}
                    >
                      {relPctStr}
                    </span>
                    <span className="text-[11px] font-mono text-[#8b9199]">
                      {row.impact.resourceProfile.shortTag}
                    </span>
                  </div>

                  {/* Clickable summary / toggle line */}
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedModIds(prev => ({
                        ...prev,
                        [row.mod.id]: !prev[row.mod.id],
                      }))
                    }
                    aria-expanded={isExpanded}
                    className="mt-1.5 w-full text-left flex items-start gap-1.5 text-xs text-[#8b9199] hover:text-[#e6e8ea] transition-colors duration-150"
                  >
                    <span className={isExpanded ? 'text-[#e6e8ea] font-medium' : 'truncate flex-1'}>
                      {isExpanded
                        ? 'Скрыть подробный разбор и взаимодействие в сборке'
                        : `${formatShortOneLineDescription(row.mod.description)} · Реакция: ${row.impact.summary}`}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#3ddc84]" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#8b9199]" aria-hidden="true" />
                    )}
                  </button>

                  {/* Expanded drawer: Purpose + Contextual Interactions + Config */}
                  {isExpanded && (
                    <div className="mt-2.5 rounded-[4px] bg-[#121417] border border-[#2a2e33] p-3 space-y-3 text-xs">
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8b9199]">
                          Для чего нужен мод
                        </div>
                        <p className="text-[#e6e8ea] leading-relaxed">
                          {cleanModDescription(row.mod.description)}
                        </p>
                      </div>

                      <div className="pt-2.5 border-t border-[#2a2e33] space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8b9199]">
                            Как реагирует в этой сборке
                          </span>
                          <span className="text-[11px] font-mono text-[#8b9199]">
                            {row.impact.resourceProfile.tradeoffNote
                              ? `${row.impact.resourceProfile.shortTag} · ${row.impact.resourceProfile.tradeoffNote}`
                              : row.impact.resourceProfile.shortTag}
                          </span>
                        </div>

                        {!row.impact.interactions.some(
                          note => note.summary.trim() === row.impact.summary.trim()
                        ) && (
                          <p className="text-[#e6e8ea] leading-relaxed">{row.impact.summary}</p>
                        )}

                        {row.mod.id === 'sinytra-connector' && (
                          <div className="rounded-[4px] border border-[#5cb3ff]/40 bg-[#5cb3ff]/[0.06] px-2.5 py-2 text-[11px] text-[#e6e8ea] leading-relaxed">
                            <strong className="text-[#5cb3ff]">Про .connector:</strong> запись{' '}
                            <code className="font-mono text-[#e6e8ea]">.connector</code> в папке модов — это
                            генерируемый кэш ремаппинга Sinytra Connector (для запуска{' '}
                            <span className="font-medium">Nvidium</span>), а не отдельный JAR.
                          </div>
                        )}

                        {row.impact.interactions.length > 0 && (
                          <div className="space-y-1.5">
                            {row.impact.interactions.map((note, idx) => {
                              const kindMeta = getInteractionKindMeta(note.kind);
                              const peerMods = note.targetIds
                                .map(id => MOD_BY_ID.get(id))
                                .filter((m): m is ModItem => Boolean(m));

                              return (
                                <div
                                  key={`${row.mod.id}-int-${idx}`}
                                  className={`rounded-[4px] border px-2.5 py-2 space-y-1 ${kindMeta.borderCls}`}
                                >
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className={`font-semibold ${kindMeta.textCls}`}>
                                      {kindMeta.label}
                                    </span>
                                    {peerMods.length > 0 && (
                                      <>
                                        <span className="text-[#8b9199]">· с</span>
                                        {peerMods.map((peer, pIdx) => (
                                          <span key={peer.id} className="inline-flex items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => onOpenDetail(peer)}
                                              className="font-medium text-[#e6e8ea] hover:text-[#3ddc84] underline decoration-[#2a2e33] underline-offset-2 transition-colors duration-150"
                                            >
                                              {peer.name}
                                            </button>
                                            {pIdx < peerMods.length - 1 && (
                                              <span className="text-[#8b9199]">,</span>
                                            )}
                                          </span>
                                        ))}
                                      </>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-[#e6e8ea]/90 leading-relaxed">
                                    {note.summary}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {row.config && (
                        <div className="pt-2.5 border-t border-[#2a2e33]">
                          <div className="rounded-[4px] bg-[#1a1d21] border border-[#2a2e33] overflow-hidden">
                            <div className="px-2.5 py-1 bg-[#1a1d21] border-b border-[#2a2e33] flex items-center justify-between gap-2">
                              <span className="font-mono text-[11px] text-[#8b9199]">
                                {row.mod.id === 'nvidium' ? 'config/nvidium.json' : row.config.filePath}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText?.(row.config!.content)?.catch(() => {});
                                  setCopiedConfigId(row.mod.id);
                                  setTimeout(
                                    () => setCopiedConfigId(prev => (prev === row.mod.id ? null : prev)),
                                    1800
                                  );
                                }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#121417] hover:bg-[#22262b] border border-[#2a2e33] text-[11px] text-[#e6e8ea] transition-colors duration-150"
                              >
                                {copiedConfigId === row.mod.id ? (
                                  <Check className="w-3 h-3 text-[#3ddc84]" aria-hidden="true" />
                                ) : (
                                  <Copy className="w-3 h-3" aria-hidden="true" />
                                )}
                                <span>{copiedConfigId === row.mod.id ? 'Скопировано' : 'Копировать'}</span>
                              </button>
                            </div>
                            <pre className="p-2 font-mono text-xs text-[#e6e8ea] overflow-x-auto select-all">
                              {row.config.content}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right actions (Catalog style) */}
                <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedModIds(prev => ({
                        ...prev,
                        [row.mod.id]: !prev[row.mod.id],
                      }))
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-[4px] text-[11px] font-medium border transition-colors duration-150 whitespace-nowrap shrink-0 ${
                      isExpanded
                        ? 'bg-[#3ddc84]/15 border-[#3ddc84] text-[#e6e8ea]'
                        : 'bg-[#121417] border-[#2a2e33] text-[#8b9199] hover:text-[#e6e8ea] hover:bg-[#22262b]'
                    }`}
                  >
                    {isExpanded ? 'Скрыть' : 'Реакция'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenDetail(row.mod)}
                    className="p-1.5 rounded-[4px] bg-[#121417] hover:bg-[#22262b] border border-[#2a2e33] text-[#8b9199] hover:text-[#e6e8ea] transition-colors duration-150 shrink-0"
                    title="Подробнее о моде"
                    aria-label={`Подробнее о ${row.mod.name}`}
                  >
                    <Info className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <a
                    href={row.mod.curseforgeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-[4px] bg-[#121417] hover:bg-[#22262b] border border-[#2a2e33] text-[#8b9199] hover:text-[#e6e8ea] text-[11px] font-mono transition-colors duration-150 whitespace-nowrap shrink-0"
                    title="CurseForge"
                  >
                    CF
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
