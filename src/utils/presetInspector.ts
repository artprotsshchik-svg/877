import { MODS_DATABASE, type ModItem, type ModPreset } from '../data/modsData.ts';
import type { ModConfigEntry } from '../data/modConfigs.ts';
import {
  cleanStatusLabel,
  getModEnvBadge,
  getModLoaderBadge,
  getRecommendedConfigForMod,
  type ModEnvBadge,
  type ModLoaderBadge,
} from './displayFormatters.ts';
import {
  evaluateAssemblyHealth,
  evaluateModImpactInPack,
  getBaseHealthTier,
  organizeAssemblyTree,
  type AssemblyPreferences,
  type CheckerTier,
  type ContextualModImpact,
  type ModInteractionNote,
} from './modLogic.ts';

export type PresetReactionFilter = 'all' | 'core' | 'synergy' | 'support' | 'moderate' | 'caution';

export interface PresetModRow {
  index: number;
  mod: ModItem;
  parentMod: ModItem | null;
  relationLabel: string | null;
  loader: ModLoaderBadge;
  env: ModEnvBadge;
  healthTier: CheckerTier;
  statusLabel: string;
  impact: ContextualModImpact;
  reactionBadge: {
    label: string;
    textCls: string;
  };
  config: ModConfigEntry | null;
}

export interface PresetDiffSummary {
  onlyInReference: ModItem[];
  onlyInCounterpart: ModItem[];
  sharedCount: number;
}

const MOD_BY_ID = new Map<string, ModItem>(MODS_DATABASE.map(m => [m.id, m]));

export function getEvalPrefsForPreset(preset: ModPreset): AssemblyPreferences | undefined {
  if (!preset.recommendedPrefs) return undefined;
  return {
    gpu: 'amd-intel',
    mode: 'singleplayer',
    useShaders: false,
    useCreate: false,
    allowSinytra: false,
    goal: 'max-safe',
    ...preset.recommendedPrefs,
  };
}

export function getReactionBadgeMeta(impact: ContextualModImpact): {
  label: string;
  textCls: string;
} {
  if (impact.level === 'negative') {
    return { label: impact.label, textCls: 'text-[#e55353]' };
  }
  if (impact.coUsageVerdict === 'overlap' || impact.level === 'zero') {
    return { label: impact.label, textCls: 'text-[#e5a93c]' };
  }
  if (impact.level === 'core' || impact.level === 'high') {
    return { label: impact.label, textCls: 'text-[#3ddc84]' };
  }
  if (impact.level === 'support') {
    return { label: impact.label, textCls: 'text-[#5cb3ff]' };
  }
  if (impact.level === 'diagnostic') {
    return { label: impact.label, textCls: 'text-[#8b9199]' };
  }
  return { label: impact.label, textCls: 'text-[#3ddc84]' };
}

export function getInteractionKindMeta(kind: ModInteractionNote['kind']): {
  label: string;
  textCls: string;
  borderCls: string;
} {
  switch (kind) {
    case 'synergy':
      return {
        label: 'Синергия',
        textCls: 'text-[#3ddc84]',
        borderCls: 'border-[#3ddc84]/40 bg-[#3ddc84]/[0.06]',
      };
    case 'dependency':
      return {
        label: 'Зависимость / Опора',
        textCls: 'text-[#5cb3ff]',
        borderCls: 'border-[#5cb3ff]/40 bg-[#5cb3ff]/[0.06]',
      };
    case 'overlap':
      return {
        label: 'Пересечение',
        textCls: 'text-[#e5a93c]',
        borderCls: 'border-[#e5a93c]/40 bg-[#e5a93c]/[0.06]',
      };
    case 'conflict':
      return {
        label: 'Конфликт',
        textCls: 'text-[#e55353]',
        borderCls: 'border-[#e55353]/40 bg-[#e55353]/[0.06]',
      };
    case 'context':
    default:
      return {
        label: 'Реакция в сборке',
        textCls: 'text-[#e6e8ea]',
        borderCls: 'border-[#2a2e33] bg-[#1a1d21]',
      };
  }
}

export function buildPresetModRows(preset: ModPreset): PresetModRow[] {
  const evalPrefs = getEvalPrefsForPreset(preset);
  const presetSet = new Set(preset.modIds);
  const health = evaluateAssemblyHealth(preset.modIds);
  const treeNodes = organizeAssemblyTree(preset.modIds);

  const orderedEntries: Array<{
    mod: ModItem;
    parentMod: ModItem | null;
    relationLabel: string | null;
  }> = [];
  const seen = new Set<string>();

  for (const node of treeNodes) {
    if (!seen.has(node.parent.id)) {
      seen.add(node.parent.id);
      orderedEntries.push({
        mod: node.parent,
        parentMod: null,
        relationLabel: null,
      });
    }
    for (const child of node.children) {
      if (!seen.has(child.mod.id)) {
        seen.add(child.mod.id);
        orderedEntries.push({
          mod: child.mod,
          parentMod: node.parent,
          relationLabel: child.relationLabel,
        });
      }
    }
  }

  for (const id of preset.modIds) {
    if (seen.has(id)) continue;
    const mod = MOD_BY_ID.get(id);
    if (mod) {
      seen.add(id);
      orderedEntries.push({
        mod,
        parentMod: null,
        relationLabel: null,
      });
    }
  }

  return orderedEntries.map((entry, idx) => {
    const impact = evaluateModImpactInPack(entry.mod, presetSet, health, evalPrefs);
    return {
      index: idx + 1,
      mod: entry.mod,
      parentMod: entry.parentMod,
      relationLabel: entry.relationLabel,
      loader: getModLoaderBadge(entry.mod),
      env: getModEnvBadge(entry.mod),
      healthTier: getBaseHealthTier(entry.mod),
      statusLabel: cleanStatusLabel(entry.mod.statusLabel),
      impact,
      reactionBadge: getReactionBadgeMeta(impact),
      config: getRecommendedConfigForMod(entry.mod.id),
    };
  });
}

export function filterPresetModRows(
  rows: PresetModRow[],
  options: {
    query?: string;
    category?: string;
    reaction?: PresetReactionFilter;
  }
): PresetModRow[] {
  const q = (options.query || '').trim().toLowerCase();
  const category = options.category || 'Все';
  const reaction = options.reaction || 'all';

  return rows.filter(row => {
    if (category !== 'Все' && row.mod.category !== category) {
      return false;
    }

    if (reaction === 'core') {
      if (row.impact.level !== 'core' && row.impact.level !== 'high') return false;
    } else if (reaction === 'synergy') {
      if (row.impact.coUsageVerdict !== 'synergy' && !row.impact.interactions.some(i => i.kind === 'synergy')) {
        return false;
      }
    } else if (reaction === 'support') {
      if (row.impact.level !== 'support') return false;
    } else if (reaction === 'moderate') {
      if (row.impact.level !== 'medium' && row.impact.level !== 'diagnostic') return false;
    } else if (reaction === 'caution') {
      const hasCaution =
        row.impact.level === 'negative' ||
        row.impact.level === 'zero' ||
        row.impact.level === 'conditional' ||
        row.impact.interactions.some(i => i.kind === 'overlap' || i.kind === 'conflict' || i.kind === 'context');
      if (!hasCaution) return false;
    }

    if (!q) return true;

    const haystacks = [
      row.mod.name,
      row.mod.id,
      row.mod.description,
      row.mod.category,
      row.mod.platform,
      row.impact.label,
      row.impact.summary,
      row.impact.resourceProfile.shortTag,
      row.impact.resourceProfile.tradeoffNote,
      ...(row.mod.tags || []),
      ...row.impact.interactions.map(i => `${i.summary} ${i.targetNames.join(' ')}`),
    ];
    return haystacks.some(text => text.toLowerCase().includes(q));
  });
}

export function getPresetDiffSummary(
  reference: ModPreset,
  counterpart: ModPreset
): PresetDiffSummary {
  const refSet = new Set(reference.modIds);
  const cpSet = new Set(counterpart.modIds);

  const onlyInReference = reference.modIds
    .filter(id => !cpSet.has(id))
    .map(id => MOD_BY_ID.get(id))
    .filter((m): m is ModItem => Boolean(m));

  const onlyInCounterpart = counterpart.modIds
    .filter(id => !refSet.has(id))
    .map(id => MOD_BY_ID.get(id))
    .filter((m): m is ModItem => Boolean(m));

  let sharedCount = 0;
  for (const id of refSet) {
    if (cpSet.has(id)) sharedCount++;
  }

  return {
    onlyInReference,
    onlyInCounterpart,
    sharedCount,
  };
}
