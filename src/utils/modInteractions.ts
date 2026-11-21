import { MODS_DATABASE, MOD_GROUPS, type ModItem } from '../data/modsData.ts';
import type { AssemblyPreferences } from './modTypes.ts';
import {
  EXCLUSIVE_ENGINE_POOLS,
  MOD_ALTERNATIVE_DEPENDENCIES,
  MOD_BY_ID,
  analyzeSelection,
  getDirectDependencies,
  getRuleConflictingIds,
  getTransitiveDependencies,
  isUnsupportedOnForge,
  summarizeAssemblyImpact,
} from './modAnalyzer.ts';
import { toggleModSmart } from './modBuilder.ts';
import { estimateFpsRange } from './fpsEstimator.ts';

export interface ModDependencyIssue {
  missingIds: string[];
  missingNames: string[];
  /** True when the mod itself is currently selected and lacks at least one dependency */
  hasMissingForSelected: boolean;
}

export interface ModConflictIssue {
  conflictingIds: string[];
  conflictingNames: string[];
  /** Can be resolved in 1 click by replacing conflicting selected mods with this mod */
  canReplace: boolean;
}

export interface ModHoverDeltaPreview {
  modId: string;
  modName: string;
  action: 'add' | 'remove';
  currentScore: number;
  nextScore: number;
  scoreDelta: number;
  currentFpsLabel: string;
  nextFpsLabel: string;
  addedDepNames: string[];
  removedConflictNames: string[];
}

export function getMissingDependenciesForMod(
  modId: string,
  selectedSet: Set<string>,
  warnings?: ReturnType<typeof analyzeSelection>['warnings']
): ModDependencyIssue {
  const missingSet = new Set<string>();

  if (selectedSet.has(modId)) {
    for (const depId of getDirectDependencies(modId, selectedSet)) {
      if (!selectedSet.has(depId) && MOD_BY_ID.has(depId)) {
        missingSet.add(depId);
      }
    }
    const altGroups = MOD_ALTERNATIVE_DEPENDENCIES[modId] || [];
    for (const group of altGroups) {
      if (group.length > 0 && !group.some((id: string) => selectedSet.has(id))) {
        const firstNonConflicting = group.find((id: string) => {
          const candidate = MOD_BY_ID.get(id);
          if (!candidate || isUnsupportedOnForge(candidate) || candidate.status === 'danger') return false;
          if (getRuleConflictingIds(id).some(cid => selectedSet.has(cid))) return false;
          const deps = getTransitiveDependencies(id, new Set(), selectedSet);
          return !deps.some(depId => getRuleConflictingIds(depId).some(cid => selectedSet.has(cid)));
        });
        const firstValid = firstNonConflicting ?? group.find((id: string) => MOD_BY_ID.has(id));
        if (firstValid) missingSet.add(firstValid);
      }
    }

    const mod = MOD_BY_ID.get(modId);
    if (mod && mod.platform.includes('Sinytra')) {
      if (!selectedSet.has('sinytra-connector')) missingSet.add('sinytra-connector');
      if (!selectedSet.has('forgified-fabric-api')) missingSet.add('forgified-fabric-api');
    }

    if (warnings) {
      for (const w of warnings) {
        if (w.modId === modId && w.fixModIds) {
          for (const fid of w.fixModIds) {
            if (!selectedSet.has(fid) && MOD_BY_ID.has(fid)) {
              missingSet.add(fid);
            }
          }
        }
      }
    }
  }

  const missingIds = Array.from(missingSet);
  const missingNames = missingIds.map(id => MOD_BY_ID.get(id)?.name || id);
  return {
    missingIds,
    missingNames,
    hasMissingForSelected: missingIds.length > 0,
  };
}

export function getConflictsForMod(
  modId: string,
  selectedSet: Set<string>,
  groupId?: string
): ModConflictIssue {
  const conflictingSet = new Set<string>();

  for (const cid of getRuleConflictingIds(modId)) {
    if (cid !== modId && selectedSet.has(cid)) {
      conflictingSet.add(cid);
    }
  }

  const targetPoolKeys = new Set<string>();
  if (groupId && EXCLUSIVE_ENGINE_POOLS[groupId]) {
    targetPoolKeys.add(groupId);
  }
  const mod = MOD_BY_ID.get(modId);
  if (mod?.groupId && EXCLUSIVE_ENGINE_POOLS[mod.groupId]) {
    targetPoolKeys.add(mod.groupId);
  }
  for (const [k, pool] of Object.entries(EXCLUSIVE_ENGINE_POOLS)) {
    if (pool.includes(modId)) targetPoolKeys.add(k);
  }
  for (const key of targetPoolKeys) {
    const pool = EXCLUSIVE_ENGINE_POOLS[key] || [];
    if (pool.includes(modId)) {
      for (const pid of pool) {
        if (pid !== modId && selectedSet.has(pid)) {
          conflictingSet.add(pid);
        }
      }
    }
  }

  const conflictingIds = Array.from(conflictingSet);
  const conflictingNames = conflictingIds.map(id => MOD_BY_ID.get(id)?.name || id);
  const targetMod = MOD_BY_ID.get(modId);
  const canReplace =
    conflictingIds.length > 0 &&
    Boolean(targetMod && targetMod.status !== 'danger' && !isUnsupportedOnForge(targetMod));

  return {
    conflictingIds,
    conflictingNames,
    canReplace,
  };
}

export function addMissingDependenciesForMod(
  selectedIds: string[],
  modId: string,
  prefs?: AssemblyPreferences
): { nextIds: string[]; addedNames: string[] } {
  const analysis = analyzeSelection(selectedIds);
  const { missingIds } = getMissingDependenciesForMod(modId, new Set(selectedIds), analysis.warnings);
  if (missingIds.length === 0) {
    return { nextIds: selectedIds, addedNames: [] };
  }
  let nextIds = [...selectedIds];
  const addedNames: string[] = [];
  for (const depId of missingIds) {
    if (!nextIds.includes(depId)) {
      const res = toggleModSmart(nextIds, depId, { strict: true, prefs });
      nextIds = res.nextIds;
      const depName = MOD_BY_ID.get(depId)?.name;
      if (depName) addedNames.push(depName);
    }
  }
  return { nextIds, addedNames };
}

export function applyWarningFix(
  selectedIds: string[],
  fixModIds: string[],
  prefs?: AssemblyPreferences
): { nextIds: string[]; addedNames: string[]; removedNames: string[] } {
  if (fixModIds.length === 0) {
    return { nextIds: selectedIds, addedNames: [], removedNames: [] };
  }
  const prevSet = new Set(selectedIds);
  let nextIds = [...selectedIds];
  for (const fid of fixModIds) {
    if (!nextIds.includes(fid)) {
      nextIds = toggleModSmart(nextIds, fid, { strict: true, prefs }).nextIds;
    }
  }
  const nextSet = new Set(nextIds);
  const addedNames = nextIds
    .filter(id => !prevSet.has(id))
    .map(id => MOD_BY_ID.get(id)?.name || id);
  const removedNames = selectedIds
    .filter(id => !nextSet.has(id))
    .map(id => MOD_BY_ID.get(id)?.name || id);
  return { nextIds, addedNames, removedNames };
}

export function getCompatibleAddonsForMod(mod: ModItem, addons: ModItem[]): ModItem[] {
  const modConflicts = new Set(getRuleConflictingIds(mod.id));
  const modDepConflicts = new Set<string>();
  for (const depId of getTransitiveDependencies(mod.id)) {
    for (const cid of getRuleConflictingIds(depId)) {
      modDepConflicts.add(cid);
    }
  }
  const modPoolSet = new Set<string>();
  for (const pool of Object.values(EXCLUSIVE_ENGINE_POOLS)) {
    if (pool.includes(mod.id)) {
      for (const pid of pool) modPoolSet.add(pid);
    }
  }
  const modContext = new Set<string>([mod.id, ...getTransitiveDependencies(mod.id)]);

  return addons.filter(addon => {
    if (addon.id === mod.id) return false;
    if (isUnsupportedOnForge(addon)) return false;
    if (modConflicts.has(addon.id) || getRuleConflictingIds(addon.id).includes(mod.id)) return false;
    if (modDepConflicts.has(addon.id)) return false;
    if (modPoolSet && modPoolSet.has(addon.id)) return false;

    const addonDeps = getTransitiveDependencies(addon.id, new Set(), modContext);
    if (addonDeps.some(dep => modConflicts.has(dep) || modDepConflicts.has(dep))) {
      return false;
    }

    if (mod.id === 'just-enough-items-jei' || mod.recipeEcosystem === 'jei-engine') {
      if (
        addon.id === 'emi' ||
        addon.id === 'tmrv-updated' ||
        addon.recipeEcosystem === 'emi-only' ||
        addon.recipeEcosystem === 'tmrv-bridge'
      ) {
        return false;
      }
    } else if (mod.id === 'emi' || mod.recipeEcosystem === 'emi-only') {
      if (addon.id === 'just-enough-items-jei' || addon.recipeEcosystem === 'jei-engine') {
        return false;
      }
    } else if (mod.id === 'tmrv-updated') {
      if (
        addon.id === 'just-enough-items-jei' ||
        addon.recipeEcosystem === 'jei-engine' ||
        addon.recipeEcosystem === 'emi-only'
      ) {
        return false;
      }
    }

    return true;
  });
}

export function replaceConflictingWithMod(
  selectedIds: string[],
  targetModId: string,
  prefs?: AssemblyPreferences
): { nextIds: string[]; replacedNames: string[]; notice: string | null } {
  const targetMod = MOD_BY_ID.get(targetModId);
  if (!targetMod || targetMod.status === 'danger' || isUnsupportedOnForge(targetMod)) {
    return { nextIds: selectedIds, replacedNames: [], notice: null };
  }
  const { conflictingIds, conflictingNames } = getConflictsForMod(
    targetModId,
    new Set(selectedIds),
    targetMod.groupId
  );
  const withoutConflicts = selectedIds.filter(id => !conflictingIds.includes(id));
  if (withoutConflicts.includes(targetModId)) {
    return {
      nextIds: withoutConflicts,
      replacedNames: conflictingNames,
      notice:
        conflictingNames.length > 0
          ? `Убраны конфликтующие с ${targetMod.name}: ${conflictingNames.join(', ')}.`
          : null,
    };
  }
  const toggled = toggleModSmart(withoutConflicts, targetModId, { strict: true, prefs });
  return {
    nextIds: toggled.nextIds,
    replacedNames: conflictingNames,
    notice:
      conflictingNames.length > 0
        ? `Заменено (${conflictingNames.join(', ')}) → ${targetMod.name}.`
        : toggled.notice,
  };
}

export function previewModToggleDelta(
  mod: ModItem,
  selectedIds: string[],
  currentScore: number,
  currentFpsLabel: string,
  prefs?: AssemblyPreferences
): ModHoverDeltaPreview {
  const isSelected = selectedIds.includes(mod.id);
  const res = toggleModSmart(selectedIds, mod.id, { strict: true, prefs });
  const prevSet = new Set(selectedIds);
  const nextSet = new Set(res.nextIds);

  const nextAnalysis = analyzeSelection(res.nextIds);
  const nextSummary = summarizeAssemblyImpact(res.nextIds, nextAnalysis, prefs);
  const nextFps = estimateFpsRange(res.nextIds, nextSummary, prefs);

  const addedDepNames: string[] = [];
  for (const id of res.nextIds) {
    if (id !== mod.id && !prevSet.has(id)) {
      const m = MOD_BY_ID.get(id);
      if (m) addedDepNames.push(m.name);
    }
  }

  const removedConflictNames: string[] = [];
  for (const id of selectedIds) {
    if (id !== mod.id && !nextSet.has(id)) {
      const m = MOD_BY_ID.get(id);
      if (m) removedConflictNames.push(m.name);
    }
  }

  return {
    modId: mod.id,
    modName: mod.name,
    action: isSelected ? 'remove' : 'add',
    currentScore,
    nextScore: nextSummary.assemblyScore,
    scoreDelta: nextSummary.assemblyScore - currentScore,
    currentFpsLabel,
    nextFpsLabel: nextFps.label,
    addedDepNames,
    removedConflictNames,
  };
}

export function getModGroupTitle(groupId?: string): string {
  if (!groupId) return '';
  return MOD_GROUPS.find(g => g.id === groupId)?.title || '';
}

export function getAllCatalogModIds(): string[] {
  return MODS_DATABASE.map(m => m.id);
}
