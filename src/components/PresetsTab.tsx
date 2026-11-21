import { useMemo, useState } from 'react';
import {
  MODS_DATABASE,
  MOD_PRESETS,
  type ModItem,
  type ModPreset,
} from '../data/modsData.ts';
import {
  evaluateAssemblyHealth,
  organizeAssemblyTree,
  summarizeAssemblyImpact,
} from '../utils/modLogic.ts';
import { estimateFpsRange } from '../utils/fpsEstimator.ts';
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
} from 'lucide-react';

interface PresetsTabProps {
  onLoadToChecker: (preset: ModPreset) => void;
  onLoadToBuilder: (preset: ModPreset) => void;
  onOpenDetail: (mod: ModItem) => void;
}

const MOD_BY_ID = new Map(MODS_DATABASE.map(m => [m.id, m]));

export function PresetsTab({
  onLoadToChecker,
  onLoadToBuilder,
  onOpenDetail,
}: PresetsTabProps) {
  const [copiedPresetId, setCopiedPresetId] = useState<string | null>(null);

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
    if (set.has('oculus') && set.has('alloyium')) return 'Embeddium + Oculus + Alloyium';
    if (set.has('oculus')) return 'Embeddium + Oculus';
    if (set.has('amd-fsr-upscaler-render-scale-for-embeddium')) return 'Embeddium + AMD FSR';
    if (set.has('alloyium')) return 'Embeddium + Alloyium';
    return 'Embeddium';
  };

  const getSinytraLabel = (preset: ModPreset) => {
    const set = new Set(preset.modIds);
    return set.has('sinytra-connector') ? 'Да (FFAPI + Extras)' : 'Нет (чистый Forge)';
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
        const fps = estimateFpsRange(preset.modIds, summary, evalPrefs);
        const redCount =
          health.conflicts.length + health.warnings.filter(w => w.severity === 'red').length;
        const yellowCount = health.warnings.filter(w => w.severity === 'yellow').length;
        return {
          preset,
          treeNodes,
          parentWithAddons,
          standaloneRoots,
          health,
          summary,
          fps,
          redCount,
          yellowCount,
        };
      }),
    []
  );

  return (
    <div className="space-y-4">
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
            label: 'Итог (Оценка · Моды)',
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
                  {evaluatedPresets.map(({ preset }, idx) => (
                    <th
                      key={preset.id}
                      className={`py-2 px-3.5 font-semibold whitespace-nowrap ${
                        idx === 0 ? 'text-[#3ddc84]' : 'text-[#e6e8ea]'
                      }`}
                    >
                      {preset.name.split('(')[0].trim()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2e33]">
                {rows.map(r => (
                  <tr key={r.label} className="hover:bg-[#22262b] transition-colors duration-150">
                    <td className="py-2 px-3.5 text-[#8b9199] font-medium whitespace-nowrap">{r.label}</td>
                    {r.values.map((val, idx) => (
                      <td key={`${r.label}-${idx}`} className="py-2 px-3.5 text-[#e6e8ea] font-mono tabular-nums whitespace-nowrap">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {evaluatedPresets.map(
          ({
            preset,
            parentWithAddons,
            standaloneRoots,
            summary: presetSummary,
            fps: presetFps,
            redCount: presetRedCount,
            yellowCount: presetYellowCount,
          }) => {
          const badgeTone = getBadgeTone(preset.badgeColor);

          return (
            <div
              key={preset.id}
              className="bg-[#1a1d21] border border-[#2a2e33] rounded-[6px] p-4 flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold text-[#e6e8ea]">{preset.name}</h3>
                  <span className={`text-xs font-medium ${badgeTone}`}>{preset.badge}</span>
                </div>
                <p className="text-xs text-[#8b9199] leading-relaxed">{preset.description}</p>

                <div className="rounded-[4px] bg-[#121417] border border-[#2a2e33] px-3 py-2.5 space-y-1.5 text-[11px]">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#8b9199] tabular-nums">
                    <span>
                      Оценка: <strong className="text-[#3ddc84] font-mono">{presetSummary.assemblyScore}/100</strong>
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
                        {presetSummary.artifactRisk.chancePct}% · {presetSummary.artifactRisk.label}
                      </strong>
                    </span>
                    <span className="text-[#2a2e33]">·</span>
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
                    <span className="text-[#2a2e33]">·</span>
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
                </div>

                <div className="divide-y divide-[#2a2e33] border border-[#2a2e33] rounded-[4px] bg-[#121417] max-h-[380px] overflow-y-auto">
                  {parentWithAddons.map((node, idx) => (
                    <div key={node.parent.id} className="px-3.5 py-2.5 space-y-1.5">
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
                          className="shrink-0 inline-flex items-center gap-1 text-[#8b9199] hover:text-[#e6e8ea] text-[10px] font-mono transition-colors duration-150"
                          title="CurseForge"
                        >
                          CF
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-[11px]">
                        {node.children.map(({ mod: ch, relationLabel }) => (
                          <span key={ch.id} className="inline-flex items-center gap-1">
                            <span className="text-[#8b9199]">↳</span>
                            <button
                              type="button"
                              onClick={() => onOpenDetail(ch)}
                              className="text-[#e6e8ea] hover:text-[#3ddc84] transition-colors duration-150"
                            >
                              {ch.name}
                            </button>
                            <span className="text-[10px] text-[#8b9199]">({relationLabel})</span>
                            <a
                              href={ch.curseforgeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#8b9199] hover:text-[#e6e8ea] transition-colors duration-150"
                              title="CurseForge"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}

                  {standaloneRoots.length > 0 && (
                    <div className="px-3.5 py-2.5 space-y-1.5">
                      <div className="text-[11px] font-medium text-[#8b9199]">
                        Остальные моды сборки ({standaloneRoots.length}):
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                        {standaloneRoots.map(({ parent: m }, sIdx) => {
                          const num = parentWithAddons.length + sIdx + 1;
                          return (
                            <div
                              key={m.id}
                              className="flex items-center justify-between gap-2 text-[11px]"
                            >
                              <button
                                type="button"
                                onClick={() => onOpenDetail(m)}
                                className="text-[#e6e8ea] hover:text-[#3ddc84] transition-colors duration-150 truncate flex items-center gap-1.5 text-left"
                              >
                                <span className="text-[10px] font-mono text-[#8b9199] tabular-nums">
                                  {num}.
                                </span>
                                <span className="truncate">{m.name}</span>
                              </button>
                              <a
                                href={m.curseforgeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#8b9199] hover:text-[#e6e8ea] transition-colors duration-150 shrink-0"
                                title="CurseForge"
                              >
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            </div>
                          );
                        })}
                      </div>
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
                      <Check className="w-3.5 h-3.5" />
                      Список скопирован
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
