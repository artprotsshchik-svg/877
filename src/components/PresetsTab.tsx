import { useMemo, useState } from 'react';
import {
  MODS_DATABASE,
  MOD_PRESETS,
  type ModItem,
  type ModPreset,
  type PresetCategory,
} from '../data/modsData.ts';
import {
  evaluateAssemblyHealth,
  organizeAssemblyTree,
  summarizeAssemblyImpact,
} from '../utils/modLogic.ts';
import {
  ArrowRight,
  Award,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
} from 'lucide-react';

interface PresetsTabProps {
  onLoadToChecker: (preset: ModPreset) => void;
  onLoadToBuilder: (preset: ModPreset) => void;
  onOpenDetail: (mod: ModItem) => void;
}

const MOD_BY_ID = new Map(MODS_DATABASE.map(m => [m.id, m]));

const CATEGORY_FILTERS: Array<{ id: 'all' | PresetCategory; label: string }> = [
  { id: 'all', label: 'Все сборки' },
  { id: 'max', label: 'Чистый Forge' },
  { id: 'nvidium', label: 'NVIDIA FPS' },
  { id: 'shaders', label: 'Шейдеры' },
  { id: 'create', label: 'Create' },
  { id: 'server', label: 'Сервер / SMP' },
  { id: 'potato', label: 'Слабый ПК' },
];

export function PresetsTab({
  onLoadToChecker,
  onLoadToBuilder,
  onOpenDetail,
}: PresetsTabProps) {
  const [copiedPresetId, setCopiedPresetId] = useState<string | null>(null);
  const [expandedPresetIds, setExpandedPresetIds] = useState<Record<string, boolean>>({});
  const [activeCategory, setActiveCategory] = useState<'all' | PresetCategory>('all');

  const toggleTree = (presetId: string) => {
    setExpandedPresetIds(prev => ({ ...prev, [presetId]: !prev[presetId] }));
  };

  const handleCopyNamesList = (preset: ModPreset) => {
    const treeNodes = organizeAssemblyTree(preset.modIds);
    const orderedNames: string[] = [];
    const seen = new Set<string>();
    for (const node of treeNodes) {
      if (!seen.has(node.parent.id)) {
        seen.add(node.parent.id);
        orderedNames.push(node.parent.name);
      }
      for (const ch of node.children) {
        if (!seen.has(ch.mod.id)) {
          seen.add(ch.mod.id);
          orderedNames.push(ch.mod.name);
        }
      }
    }
    for (const id of preset.modIds) {
      if (!seen.has(id)) {
        const m = MOD_BY_ID.get(id);
        if (m) {
          seen.add(id);
          orderedNames.push(m.name);
        }
      }
    }
    navigator.clipboard?.writeText?.(orderedNames.join('\n'))?.catch(() => {});
    setCopiedPresetId(preset.id);
    setTimeout(() => setCopiedPresetId(prev => (prev === preset.id ? null : prev)), 1800);
  };

  const getEvalPrefs = (preset: ModPreset) =>
    preset.recommendedPrefs
      ? ({
          gpu: 'amd-intel',
          mode: 'singleplayer',
          useShaders: false,
          useCreate: false,
          allowSinytra: false,
          goal: 'max-safe',
          ...preset.recommendedPrefs,
        } as const)
      : undefined;

  const getRenderLabel = (preset: ModPreset) => {
    const set = new Set(preset.modIds);
    if (set.has('emberbium') && set.has('nvidium')) return 'Emberbium + Nvidium';
    if (set.has('oculus') && set.has('flywheel') && set.has('alloyium')) {
      return 'Embeddium + Oculus + Flywheel';
    }
    if (set.has('oculus') && set.has('alloyium')) return 'Embeddium + Oculus + Alloyium';
    if (set.has('oculus')) return 'Embeddium + Oculus';
    if (set.has('amd-fsr-upscaler-render-scale-for-embeddium')) return 'Embeddium + AMD FSR';
    if (set.has('alloyium')) return 'Embeddium + Alloyium';
    return 'Embeddium';
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

  const evaluatedPresets = useMemo(
    () =>
      MOD_PRESETS.map(preset => {
        const evalPrefs = getEvalPrefs(preset);
        const treeNodes = organizeAssemblyTree(preset.modIds);
        const parentWithAddons = treeNodes.filter(n => n.children.length > 0);
        const standaloneRoots = treeNodes.filter(n => n.children.length === 0);
        const health = evaluateAssemblyHealth(preset.modIds);
        const summary = summarizeAssemblyImpact(preset.modIds, health, evalPrefs);
        const redCount =
          health.conflicts.length + health.warnings.filter(w => w.severity === 'red').length;
        const yellowCount = health.warnings.filter(w => w.severity === 'yellow').length;
        const hasSinytra = preset.modIds.includes('sinytra-connector');
        return {
          preset,
          parentWithAddons,
          standaloneRoots,
          summary,
          redCount,
          yellowCount,
          hasSinytra,
        };
      }),
    []
  );

  const filteredPresets = useMemo(
    () =>
      activeCategory === 'all'
        ? evaluatedPresets
        : evaluatedPresets.filter(item => item.preset.category === activeCategory),
    [activeCategory, evaluatedPresets]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#1a1d21] border border-[#2a2e33] rounded-[6px] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Фильтр сборок по сценарию">
          {CATEGORY_FILTERS.map(cat => {
            const count =
              cat.id === 'all'
                ? evaluatedPresets.length
                : evaluatedPresets.filter(e => e.preset.category === cat.id).length;
            if (cat.id !== 'all' && count === 0) return null;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`px-2.5 py-1 rounded-[4px] text-xs font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-[#3ddc84] text-[#0f1411] font-semibold'
                    : 'bg-[#121417] text-[#9aa1aa] border border-[#2a2e33] hover:text-[#e6e8ea] hover:bg-[#22262b]'
                }`}
              >
                {cat.label} ({count})
              </button>
            );
          })}
        </div>
        <span className="text-[11px] text-[#8b9199]">
          Все сборки проверены без наложений куллинга · 0 конфликтов
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredPresets.map(
          ({
            preset,
            parentWithAddons,
            standaloneRoots,
            summary: presetSummary,
            redCount: presetRedCount,
            yellowCount: presetYellowCount,
            hasSinytra,
          }) => {
            const badgeTone = getBadgeTone(preset.badgeColor);
            const isExpanded = Boolean(expandedPresetIds[preset.id]);
            const isTopPick = preset.id === 'user-alloyium-embeddium';
            const breakdown = presetSummary.scoreBreakdown;

            return (
              <div
                key={preset.id}
                className={`bg-[#1a1d21] border rounded-[6px] p-4 flex flex-col justify-between gap-3.5 ${
                  isTopPick ? 'border-[#3ddc84]/55' : 'border-[#2a2e33]'
                }`}
              >
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-base font-semibold text-[#e6e8ea] flex items-center gap-1.5">
                        {isTopPick && (
                          <Award className="w-4 h-4 text-[#3ddc84] shrink-0" aria-label="Лучший выбор" />
                        )}
                        <span>{preset.name}</span>
                      </h3>
                      <span className={`text-xs font-medium ${badgeTone}`}>{preset.badge}</span>
                    </div>
                    <p className="text-xs text-[#9aa1aa] leading-relaxed">{preset.description}</p>
                  </div>

                  {/* Light Inline Telemetry Strip */}
                  <div className="rounded-[4px] bg-[#121417] border border-[#2a2e33] px-3 py-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[#8b9199] tabular-nums">
                    <span>
                      Оценка: <strong className="text-[#3ddc84] font-mono">{presetSummary.assemblyScore}/100</strong>
                    </span>
                    <span className="text-[#2a2e33]">·</span>
                    <span className="font-mono text-[#9aa1aa]">
                      Эфф {breakdown.efficiencyScore} · Стаб {breakdown.stabilityScore} · Чист {breakdown.cleanlinessScore}
                    </span>
                    <span className="text-[#2a2e33]">·</span>
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
                        {presetSummary.artifactRisk.chancePct}%
                      </strong>
                    </span>
                    <span className="text-[#2a2e33]">·</span>
                    <span className="text-[#e6e8ea] font-mono">{getRenderLabel(preset)}</span>
                    <span className="text-[#2a2e33]">·</span>
                    <span className={hasSinytra ? 'text-[#e5a93c]' : 'text-[#8b9199]'}>
                      {hasSinytra ? 'Sinytra' : 'Чистый Forge'}
                    </span>
                    <span className="text-[#2a2e33]">·</span>
                    <span
                      className={`font-mono ${
                        presetRedCount > 0
                          ? 'text-[#e55353]'
                          : presetYellowCount > 0
                            ? 'text-[#e5a93c]'
                            : 'text-[#3ddc84]'
                      }`}
                    >
                      {presetRedCount} конфл. · {preset.modIds.length} мод.
                    </span>
                  </div>

                  <div className="text-[11px] text-[#9aa1aa]">
                    <strong className="text-[#e6e8ea] font-medium">Риск:</strong> {preset.crashRisk}
                  </div>

                  {/* Collapsible Mod List Drawer */}
                  <div className="border border-[#2a2e33] rounded-[4px] bg-[#121417] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleTree(preset.id)}
                      aria-expanded={isExpanded}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-xs text-[#e6e8ea] hover:bg-[#22262b] transition-colors duration-150"
                    >
                      <span className="font-medium">
                        Состав сборки ({preset.modIds.length} модов)
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-[#8b9199]" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-[#8b9199]" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-[#2a2e33] divide-y divide-[#2a2e33] max-h-[300px] overflow-y-auto">
                        {parentWithAddons.map((node, idx) => (
                          <div key={node.parent.id} className="px-3 py-2 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex flex-wrap items-baseline gap-1.5 min-w-0">
                                <span className="text-[11px] font-mono text-[#8b9199] tabular-nums">
                                  {idx + 1}.
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onOpenDetail(node.parent)}
                                  className="text-xs font-semibold text-[#e6e8ea] hover:text-[#3ddc84] text-left transition-colors duration-150"
                                >
                                  {node.parent.name}
                                </button>
                              </div>
                              <a
                                href={node.parent.curseforgeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 text-[#8b9199] hover:text-[#e6e8ea]"
                                title="CurseForge"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pl-4 text-[11px]">
                              {node.children.map(({ mod: ch }) => (
                                <span key={ch.id} className="inline-flex items-center gap-1">
                                  <span className="text-[#8b9199]">↳</span>
                                  <button
                                    type="button"
                                    onClick={() => onOpenDetail(ch)}
                                    className="text-[#b5bcc4] hover:text-[#3ddc84] transition-colors duration-150"
                                  >
                                    {ch.name}
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}

                        {standaloneRoots.length > 0 && (
                          <div className="px-3 py-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                            {standaloneRoots.map(({ parent: m }, sIdx) => {
                              const num = parentWithAddons.length + sIdx + 1;
                              return (
                                <div key={m.id} className="flex items-center justify-between gap-2 text-[11px]">
                                  <button
                                    type="button"
                                    onClick={() => onOpenDetail(m)}
                                    className="text-[#e6e8ea] hover:text-[#3ddc84] transition-colors duration-150 truncate flex items-center gap-1.5 text-left"
                                  >
                                    <span className="text-[10px] font-mono text-[#8b9199] tabular-nums">{num}.</span>
                                    <span className="truncate">{m.name}</span>
                                  </button>
                                  <a
                                    href={m.curseforgeUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#8b9199] hover:text-[#e6e8ea] shrink-0"
                                    title="CurseForge"
                                  >
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-[#2a2e33] flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyNamesList(preset)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] bg-[#3ddc84] hover:bg-[#34c776] text-[#0f1411] text-xs font-semibold transition-colors duration-150 whitespace-nowrap"
                  >
                    {copiedPresetId === preset.id ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Скопировано
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
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
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          }
        )}
      </div>
    </div>
  );
}
