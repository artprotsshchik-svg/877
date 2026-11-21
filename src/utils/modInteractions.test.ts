import test from 'node:test';
import assert from 'node:assert/strict';
import { MODS_DATABASE, MOD_GROUPS } from '../data/modsData.ts';
import { INITIAL_BUILDER_PREFS } from './modTypes.ts';
import { analyzeSelection, getGroupMembersByRole, summarizeAssemblyImpact } from './modAnalyzer.ts';
import {
  addMissingDependenciesForMod,
  applyWarningFix,
  getCompatibleAddonsForMod,
  getConflictsForMod,
  getMissingDependenciesForMod,
  previewModToggleDelta,
  replaceConflictingWithMod,
} from './modInteractions.ts';

const BY_ID = new Map(MODS_DATABASE.map(m => [m.id, m]));

test('getMissingDependenciesForMod and addMissingDependenciesForMod resolve Sinytra/Forge dependencies', () => {
  const selected = new Set(['nvidium']);
  const issue = getMissingDependenciesForMod('nvidium', selected);
  assert.equal(issue.hasMissingForSelected, true);
  assert.ok(issue.missingIds.includes('embeddium') || issue.missingIds.includes('sinytra-connector'));

  const applied = addMissingDependenciesForMod(['nvidium'], 'nvidium', INITIAL_BUILDER_PREFS);
  assert.ok(applied.nextIds.length > 1);
  assert.ok(applied.addedNames.length > 0);
});

test('getConflictsForMod and replaceConflictingWithMod swap mutually exclusive mods in one action', () => {
  const conflicts = getConflictsForMod('xenon', new Set(['embeddium']), 'core-renderer');
  assert.equal(conflicts.canReplace, true);
  assert.ok(conflicts.conflictingIds.includes('embeddium'));

  const replaced = replaceConflictingWithMod(['embeddium', 'modernfix'], 'xenon', INITIAL_BUILDER_PREFS);
  assert.ok(replaced.nextIds.includes('xenon'));
  assert.ok(!replaced.nextIds.includes('embeddium'));
  assert.ok(replaced.nextIds.includes('modernfix'));
  assert.ok(replaced.replacedNames.includes('Embeddium'));
});

test('previewModToggleDelta forecasts score delta and FPS range change', () => {
  const modernfix = BY_ID.get('modernfix')!;
  const baseIds = ['embeddium'];
  const baseSummary = summarizeAssemblyImpact(baseIds, analyzeSelection(baseIds), INITIAL_BUILDER_PREFS);
  const preview = previewModToggleDelta(
    modernfix,
    baseIds,
    baseSummary.assemblyScore,
    '+20–35% FPS (оценка)',
    INITIAL_BUILDER_PREFS
  );
  assert.equal(preview.action, 'add');
  assert.equal(preview.scoreDelta, preview.nextScore - baseSummary.assemblyScore);
  assert.ok(preview.scoreDelta > 0, `expected positive scoreDelta adding modernfix, got ${preview.scoreDelta}`);
  assert.match(preview.nextFpsLabel, /оценка/);
});

test('getMissingDependenciesForMod respects already-selected Emberbium/EMI equivalents in context', () => {
  const nvidiumWithEmberbium = new Set(['emberbium', 'nvidium', 'sinytra-connector', 'forgified-fabric-api']);
  const nvidiumIssue = getMissingDependenciesForMod('nvidium', nvidiumWithEmberbium);
  assert.equal(nvidiumIssue.hasMissingForSelected, false);
  assert.deepEqual(nvidiumIssue.missingIds, []);

  const jerWithEmiTmrv = new Set(['emi', 'tmrv-updated', 'just-enough-resources-jer']);
  const jerIssue = getMissingDependenciesForMod('just-enough-resources-jer', jerWithEmiTmrv);
  assert.equal(jerIssue.hasMissingForSelected, false);
  assert.deepEqual(jerIssue.missingIds, []);
});

test('applyWarningFix resolves replacement warnings (Canary+C2ME) and transitive dependency warnings cleanly without conflicts', () => {
  const canaryWithC2me = ['canary', 'concurrent-chunk-management-engine-forge-c2me'];
  const fixedCanary = applyWarningFix(canaryWithC2me, ['radium-re-reforged'], INITIAL_BUILDER_PREFS);
  assert.ok(fixedCanary.nextIds.includes('radium-re-reforged'));
  assert.ok(!fixedCanary.nextIds.includes('canary'));
  const canaryAnalysis = analyzeSelection(fixedCanary.nextIds);
  assert.equal(canaryAnalysis.conflicts.length, 0);
  assert.equal(canaryAnalysis.warnings.length, 0);

  const particleMissingFzzy = ['embeddium', 'particle-core'];
  const fixedParticle = applyWarningFix(particleMissingFzzy, ['fzzy-config'], INITIAL_BUILDER_PREFS);
  assert.ok(fixedParticle.nextIds.includes('fzzy-config'));
  assert.ok(fixedParticle.nextIds.includes('kotlin-for-forge'));
  assert.equal(analyzeSelection(fixedParticle.nextIds).warnings.length, 0);
});

test('getCompatibleAddonsForMod excludes incompatible/unsupported group addons for every mod and leader', () => {
  for (const g of MOD_GROUPS) {
    const roleInfo = getGroupMembersByRole(g.id)!;
    const leader = roleInfo.leader!;
    const leaderCompat = getCompatibleAddonsForMod(leader, roleInfo.addons);
    assert.ok(!leaderCompat.some(a => a.id === 'voxy'), 'Voxy must not appear as compatible Forge addon');
    assert.ok(!leaderCompat.some(a => a.id === 'drd-dynamic-render-distance'), 'DRD must not appear as addon under DynamicRenderDistance');
  }

  const jeiGroup = getGroupMembersByRole('recipes-jei')!;
  const jeiCompat = getCompatibleAddonsForMod(BY_ID.get('just-enough-items-jei')!, jeiGroup.addons).map(a => a.id);
  assert.ok(!jeiCompat.includes('tmrv-updated'));
  assert.ok(!jeiCompat.includes('emi'));
  assert.ok(!jeiCompat.includes('emi-loot'));
  assert.ok(jeiCompat.includes('fast-recipe-search'));

  const emiCompat = getCompatibleAddonsForMod(BY_ID.get('emi')!, jeiGroup.addons).map(a => a.id);
  assert.ok(emiCompat.includes('tmrv-updated'));
  assert.ok(emiCompat.includes('emi-loot'));
  assert.ok(!emiCompat.includes('jeioptimizer'));

  const coreGroup = getGroupMembersByRole('core-renderer')!;
  const emberbiumCompat = getCompatibleAddonsForMod(BY_ID.get('emberbium')!, coreGroup.addons).map(a => a.id);
  assert.ok(!emberbiumCompat.includes('alloyium'));
  assert.ok(!emberbiumCompat.includes('maple-mesh-render'));
  assert.ok(emberbiumCompat.includes('flerovium'));

  const entityGroup = getGroupMembersByRole('block-culling')!;
  const entityCompat = getCompatibleAddonsForMod(BY_ID.get('entity-culling')!, entityGroup.addons).map(a => a.id);
  assert.ok(!entityCompat.includes('jem-adaptive-culling'));
  assert.ok(!entityCompat.includes('sodium-sightline'));

  const particleGroup = getGroupMembersByRole('particles-audio')!;
  const particleCompat = getCompatibleAddonsForMod(BY_ID.get('particle-core')!, particleGroup.addons).map(a => a.id);
  assert.ok(!particleCompat.includes('particull'));
  assert.ok(!particleCompat.includes('asyncparticles'));

  const dynamicGroup = getGroupMembersByRole('upscaling-bg')!;
  const dynamicCompat = getCompatibleAddonsForMod(BY_ID.get('dynamic-fps')!, dynamicGroup.addons).map(a => a.id);
  assert.ok(!dynamicCompat.includes('restmode'));

  const animGroup = getGroupMembersByRole('animations-compat')!;
  const geckoCompat = getCompatibleAddonsForMod(BY_ID.get('geckolib-animation-optimizer')!, animGroup.addons).map(a => a.id);
  assert.ok(!geckoCompat.includes('geckolibbetterfps'));
});
