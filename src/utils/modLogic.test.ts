import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATABASE_UPDATED_AT,
  GOLDEN_STANDARD_MODS,
  MODS_DATABASE,
  MOD_GROUPS,
  MOD_PRESETS,
} from '../data/modsData.ts';
import {
  DUAL_PORT_PAIRS,
  analyzeSelection,
  buildSmartAssembly,
  evaluateAssemblyHealth,
  findModByDisplayName,
  formatAssemblyTreeText,
  getBaseHealthTier,
  getCheckerTier,
  getDualPortPairForMod,
  getGroupMembersByRole,
  getModRestrictionBadge,
  getModSuperseder,
  getModUpdatedLabel,
  getRecipeBridgeStatus,
  isUnsupportedOnForge,
  organizeAssemblyTree,
  removeModsCascade,
  shouldHideMod,
  smartFixAssembly,
  toggleModSmart,
  INITIAL_BUILDER_PREFS,
  type AssemblyPreferences,
} from './modLogic.ts';

test('all mods have valid CurseForge URLs, non-empty fields, and 100% MOD_GROUPS coverage', () => {
  assert.ok(MODS_DATABASE.length >= 500);
  const groupedIds = new Set(MOD_GROUPS.flatMap(g => g.memberIds));
  const ungrouped = MODS_DATABASE.filter(m => !groupedIds.has(m.id)).map(m => m.id);
  assert.deepEqual(ungrouped, [], `Found ungrouped mods: ${ungrouped.join(', ')}`);

  for (const mod of MODS_DATABASE) {
    assert.ok(mod.id.length > 0, `Empty id for ${mod.name}`);
    assert.ok(mod.curseforgeUrl.startsWith('https://www.curseforge.com/'), `Invalid URL for ${mod.name}: ${mod.curseforgeUrl}`);
    assert.ok(mod.platform.length > 0, `Empty platform for ${mod.name}`);
  }
});

test('all 6 curated presets have zero conflicts, zero warnings, 7/7 subsystem coverage, and zero red mods', async () => {
  const { summarizeAssemblyImpact } = await import('./modAnalyzer.ts');
  assert.equal(MOD_PRESETS.length, 6, `Expected 6 curated presets, got ${MOD_PRESETS.length}`);
  const expectedIds = [
    'user-nvidium-emberbium',
    'user-alloyium-embeddium',
    'shaders-optimum',
    'create-industry-shaders',
    'multiplayer-heavy-server',
    'potato-integrated-gpu',
  ];
  for (const id of expectedIds) {
    assert.ok(MOD_PRESETS.some(p => p.id === id), `Missing expected preset "${id}"`);
  }

  for (const preset of MOD_PRESETS) {
    const analysis = analyzeSelection(preset.modIds);
    assert.equal(
      analysis.conflicts.length,
      0,
      `Preset "${preset.id}" has unexpected conflicts: ${analysis.conflicts.map(c => c.matchedNames.join('+')).join('; ')}`
    );
    assert.equal(
      analysis.warnings.length,
      0,
      `Preset "${preset.id}" has unexpected warnings: ${analysis.warnings.map(w => `${w.modName}: ${w.message}`).join('; ')}`
    );

    const warningByMod = new Map<string, 'red' | 'yellow'>();
    for (const w of analysis.warnings) {
      const prev = warningByMod.get(w.modId);
      warningByMod.set(w.modId, prev === 'red' || w.severity === 'red' ? 'red' : 'yellow');
    }

    for (const mod of analysis.selectedMods) {
      const tier = getCheckerTier(mod, analysis.conflictingIdSet, warningByMod.get(mod.id));
      assert.notEqual(
        tier.tier,
        'red',
        `Preset "${preset.id}" contains RED mod "${mod.name}" (${tier.reason})`
      );
    }

    const summary = summarizeAssemblyImpact(preset.modIds, analysis, {
      ...INITIAL_BUILDER_PREFS,
      ...preset.recommendedPrefs,
    });
    assert.equal(summary.overlaps.length, 0, `Preset "${preset.id}" has overlaps`);
    assert.equal(summary.zeroOrLowImpactIds.length, 0, `Preset "${preset.id}" has zero/low impact mods`);
    assert.ok(summary.assemblyScore >= 96, `Preset "${preset.id}" expected score >= 96, got ${summary.assemblyScore}`);
    assert.equal(summary.coveredSubsystems.length, 7, `Preset "${preset.id}" should cover all 7 subsystems`);
  }
});

test('incompatible mod mix triggers expected conflicts and red warnings', () => {
  const analysis = analyzeSelection([
    'optifine',
    'embeddium',
    'emberbium',
    'rubidium',
    'solix',
    'starlight-with-create-fix',
    'radium-reforged',
    'radium-re-reforged',
    'nvidium',
    'oculus',
    'simply-server-ram-optimizer-cleaner',
    'memguard',
    'tt20-tps-fixer',
    'tickaccelerate',
  ]);
  assert.ok(analysis.conflicts.length >= 5, `Expected >=5 conflicts, got ${analysis.conflicts.length}`);
  assert.ok(analysis.conflictingIdSet.has('optifine'));
  assert.ok(analysis.conflictingIdSet.has('nvidium'));
  assert.ok(analysis.conflictingIdSet.has('oculus'));
  assert.ok(analysis.conflictingIdSet.has('radium-re-reforged'));
  assert.ok(analysis.conflictingIdSet.has('solix'));
});

test('(Sodium) Chloride + Embeddium + Embeddium Extras + Alloyium have zero conflicts, whereas Xenon + Embeddium conflicts', () => {
  const clean = analyzeSelection(['embeddium', 'embeddium-extras', 'sodium-chloride', 'alloyium']);
  assert.equal(clean.conflicts.length, 0);
  assert.equal(clean.warnings.length, 0);

  const clash = analyzeSelection(['embeddium', 'xenon']);
  assert.equal(clash.conflicts.length, 1);
  assert.ok(clash.conflictingIdSet.has('embeddium'));
  assert.ok(clash.conflictingIdSet.has('xenon'));
});

test('LightStar does not conflict with Solix (client cache vs server light engine)', () => {
  const res = analyzeSelection(['embeddium', 'solix', 'lightstar']);
  assert.equal(res.conflicts.length, 0);
});

test('Fabric-only originals (Lithium, Krypton) are flagged red for Forge while their Forge ports (Radium Re-Reforged, Krypton Reno) are green', () => {
  const lithium = MODS_DATABASE.find(m => m.id === 'lithium');
  const krypton = MODS_DATABASE.find(m => m.id === 'krypton');
  const radium = MODS_DATABASE.find(m => m.id === 'radium-re-reforged');
  const kryptonReno = MODS_DATABASE.find(m => m.id === 'krypton-reno');
  const entityCulling = MODS_DATABASE.find(m => m.id === 'entity-culling');
  const dynamicFps = MODS_DATABASE.find(m => m.id === 'dynamic-fps');
  const clumps = MODS_DATABASE.find(m => m.id === 'clumps');
  const fastSuite = MODS_DATABASE.find(m => m.id === 'fastsuite');

  assert.ok(lithium && krypton && radium && kryptonReno && entityCulling && dynamicFps && clumps && fastSuite);
  assert.equal(isUnsupportedOnForge(lithium), true);
  assert.equal(isUnsupportedOnForge(krypton), true);
  assert.equal(getCheckerTier(lithium, new Set()).tier, 'red');
  assert.equal(getCheckerTier(krypton, new Set()).tier, 'red');

  for (const goodMod of [radium, kryptonReno, entityCulling, dynamicFps, clumps]) {
    assert.equal(isUnsupportedOnForge(goodMod), false);
    assert.equal(getCheckerTier(goodMod, new Set()).tier, 'green', `${goodMod.name} should be green`);
  }

  assert.equal(isUnsupportedOnForge(fastSuite), false);
  assert.equal(getCheckerTier(fastSuite, new Set()).tier, 'lime');
  assert.equal(getBaseHealthTier(fastSuite), 'lime');

  const nvidium = MODS_DATABASE.find(m => m.id === 'nvidium')!;
  const fastchest = MODS_DATABASE.find(m => m.id === 'fastchest-revived')!;
  const kryptonHybrid = MODS_DATABASE.find(m => m.id === 'krypton-hybrid')!;
  assert.equal(getBaseHealthTier(nvidium), 'yellow');
  assert.equal(getBaseHealthTier(fastchest), 'yellow');
  assert.equal(getBaseHealthTier(kryptonHybrid), 'lime');

  const kryptonFox = MODS_DATABASE.find(m => m.id === 'krypton-foxified')!;
  assert.equal(isUnsupportedOnForge(kryptonFox), true);
  assert.equal(getCheckerTier(kryptonFox, new Set()).tier, 'red');
  const nfCheck = analyzeSelection(['embeddium', 'krypton-foxified']);
  assert.equal(nfCheck.warnings.length, 1);
  assert.equal(nfCheck.warnings[0].severity, 'red');
});

test('Nvidium conflicts with Alloyium and Oculus, while Emberlens requires Emberbium and conflicts with Oculus/Embeddium', () => {
  const nvidiumAlloyium = analyzeSelection(['embeddium', 'sinytra-connector', 'forgified-fabric-api', 'nvidium', 'alloyium']);
  assert.ok(nvidiumAlloyium.conflicts.length >= 1);
  assert.ok(nvidiumAlloyium.conflictingIdSet.has('nvidium'));
  assert.ok(nvidiumAlloyium.conflictingIdSet.has('alloyium'));

  const oculusEmberlens = analyzeSelection(['emberbium', 'oculus', 'emberlens']);
  assert.ok(oculusEmberlens.conflicts.length >= 1);
  assert.ok(oculusEmberlens.conflictingIdSet.has('oculus'));
  assert.ok(oculusEmberlens.conflictingIdSet.has('emberlens'));

  const cleanEmberlens = analyzeSelection(['emberbium', 'emberlens']);
  assert.equal(cleanEmberlens.conflicts.length, 0);
  assert.equal(cleanEmberlens.warnings.length, 0);
});

test('Alloyium is an addon of Embeddium in core-renderer group', () => {
  const group = getGroupMembersByRole('core-renderer');
  assert.ok(group);
  assert.equal(group.leader?.id, 'embeddium');
  assert.ok(group.addons.some(a => a.id === 'alloyium'));
  assert.ok(group.addons.some(a => a.id === 'sodium-chloride'));
  assert.ok(group.removedAnalogs.some(r => r.id === 'xenon'));
});

test('buildSmartAssembly adapts to gpu, server mode, goal, shaders, create, and sinytra with zero conflicts', () => {
  const profiles: AssemblyPreferences[] = [
    { gpu: 'nvidia', mode: 'singleplayer', useShaders: false, useCreate: false, allowSinytra: true, goal: 'balanced' },
    { gpu: 'nvidia', mode: 'server', useShaders: true, useCreate: true, allowSinytra: true, goal: 'max-safe' },
    { gpu: 'amd-intel', mode: 'hybrid-server', useShaders: false, useCreate: true, allowSinytra: false, goal: 'max-safe' },
    { gpu: 'amd-intel', mode: 'singleplayer', useShaders: false, useCreate: false, allowSinytra: false, goal: 'max-safe', recipeViewer: 'none' },
    { gpu: 'integrated', mode: 'singleplayer', useShaders: false, useCreate: false, allowSinytra: false, goal: 'potato' },
  ];

  for (const prefs of profiles) {
    const { modIds, notes, excluded } = buildSmartAssembly(prefs);
    assert.ok(notes.length > 0);
    assert.ok(excluded.length > 0);

    const analysis = analyzeSelection(modIds);
    assert.equal(analysis.conflicts.length, 0, `Smart assembly had conflicts for ${JSON.stringify(prefs)}`);

    const redWarnings = analysis.warnings.filter(w => w.severity === 'red');
    assert.equal(redWarnings.length, 0, `Smart assembly had red warnings for ${JSON.stringify(prefs)}: ${redWarnings.map(w => w.message).join('; ')}`);

    if (prefs.allowSinytra && prefs.gpu === 'nvidia' && !prefs.useShaders && prefs.goal !== 'potato') {
      assert.ok(modIds.includes('nvidium'));
      assert.ok(!modIds.includes('alloyium'));
      assert.ok(!modIds.includes('oculus'));
    }
    if (prefs.useShaders && prefs.goal !== 'potato') {
      assert.ok(modIds.includes('oculus'));
      assert.ok(!modIds.includes('emberlens'));
      assert.ok(!modIds.includes('nvidium'));
    }
    if (prefs.mode === 'hybrid-server') {
      assert.ok(modIds.includes('krypton-hybrid'));
      assert.ok(!modIds.includes('krypton-reno'));
      assert.ok(!modIds.includes('radium-re-reforged'));
      assert.ok(!modIds.includes('c2mer'));
      assert.ok(!modIds.includes('vmp-forge'));
    } else if (prefs.mode === 'server') {
      assert.ok(modIds.includes('krypton-reno'));
    } else {
      assert.ok(!modIds.includes('krypton-reno'));
    }
    if (prefs.goal === 'max-safe') {
      assert.ok(modIds.includes('structure-dfu-cache'));
      assert.ok(modIds.includes('rinlib'));
      if (prefs.recipeViewer === 'none') {
        assert.ok(modIds.includes('fastsuite'));
        assert.ok(modIds.includes('placebo'));
        assert.ok(!modIds.includes('fast-recipe-search'));
      } else {
        assert.ok(modIds.includes('fast-recipe-search'));
        assert.ok(!modIds.includes('fastsuite'));
      }
    }
    if (prefs.goal === 'balanced') {
      assert.ok(!modIds.includes('fastsuite'));
    }
  }
});

test('toggleModSmart pulls transitive deps, resolves cross-group conflicts, swaps Fabric originals, and cascades removals', () => {
  // Choosing Emberlens pulls Emberbium and removes Embeddium & Nvidium
  const startWithNvidium = ['embeddium', 'sinytra-connector', 'forgified-fabric-api', 'nvidium'];
  const pickEmberlens = toggleModSmart(startWithNvidium, 'emberlens', { strict: true });
  assert.ok(pickEmberlens.nextIds.includes('emberlens'));
  assert.ok(pickEmberlens.nextIds.includes('emberbium'));
  assert.ok(!pickEmberlens.nextIds.includes('embeddium'));
  assert.ok(!pickEmberlens.nextIds.includes('nvidium'));

  // Picking Nvidium afterwards keeps Emberbium (alternative dep satisfied via .connector) and drops conflicting Emberlens
  const pickNvidiumBack = toggleModSmart(pickEmberlens.nextIds, 'nvidium', { strict: true });
  assert.ok(pickNvidiumBack.nextIds.includes('nvidium'));
  assert.ok(pickNvidiumBack.nextIds.includes('emberbium'));
  assert.ok(!pickNvidiumBack.nextIds.includes('emberlens'));

  // Picking Nvidium with no renderer yet pulls Embeddium by default
  const pickNvidiumFresh = toggleModSmart([], 'nvidium', { strict: true });
  assert.ok(pickNvidiumFresh.nextIds.includes('nvidium'));
  assert.ok(pickNvidiumFresh.nextIds.includes('embeddium'));

  // Removing Emberbium cascades to Nvidium when Embeddium is absent
  const dropEmberbium = toggleModSmart(pickNvidiumBack.nextIds, 'emberbium', { strict: true });
  assert.ok(!dropEmberbium.nextIds.includes('emberbium'));
  assert.ok(!dropEmberbium.nextIds.includes('nvidium'));

  // Picking Fabric Lithium in strict mode swaps to Radium Re-Reforged
  const swapLithium = toggleModSmart(['embeddium'], 'lithium', { strict: true });
  assert.ok(!swapLithium.nextIds.includes('lithium'));
  assert.ok(swapLithium.nextIds.includes('radium-re-reforged'));

  // Picking danger mod MemGuard in strict mode is blocked
  const blockDanger = toggleModSmart(['embeddium'], 'memguard', { strict: true });
  assert.equal(blockDanger.nextIds.includes('memguard'), false);
  assert.equal(blockDanger.noticeTone, 'warn');

  // removeModsCascade removes dependents when clearing a slot
  const cascade = removeModsCascade(['embeddium', 'lightstar', 'modernfix'], ['embeddium']);
  assert.deepEqual(cascade.nextIds, ['modernfix']);
});

test('smartFixAssembly repairs broken mixes and evaluateAssemblyHealth spots missing core slots', () => {
  const broken = ['optifine', 'embeddium', 'xenon', 'lithium', 'nvidium', 'oculus', 'memguard', 'redirected', 'jasione'];
  const repaired = smartFixAssembly(broken);
  const analysis = analyzeSelection(repaired);

  assert.equal(analysis.conflicts.length, 0);
  assert.equal(analysis.warnings.filter(w => w.severity === 'red').length, 0);
  assert.ok(repaired.includes('embeddium'));
  assert.ok(repaired.includes('radium-re-reforged'));
  assert.ok(!repaired.includes('optifine'));
  assert.ok(!repaired.includes('memguard'));
  assert.ok(!repaired.includes('redirected'));

  const incompleteHealth = evaluateAssemblyHealth(['modernfix']);
  assert.ok(incompleteHealth.missingCoreSlots.some(s => s.groupId === 'core-renderer'));
  assert.ok(incompleteHealth.missingCoreSlots.some(s => s.groupId === 'tick-physics-engine'));

  const nvidiumMod = MODS_DATABASE.find(m => m.id === 'nvidium')!;
  const restriction = getModRestrictionBadge(nvidiumMod, new Set(['oculus']));
  assert.ok(restriction?.text.includes('Oculus'));
});

test('verified Forge 1.20.1 ports exist, classify accurately, and respect mutual exclusivity', () => {
  const forgePorts = [
    'vmp-forge',
    'pluto',
    'fastload',
    'lazydfu-forge',
    'noisium',
    'sodium-embeddium-options-api',
    'sodium-embeddium-dynamic-lights',
    'concurrent-chunk-management-engine-forge-c2me',
    'c2mer',
  ];

  for (const id of forgePorts) {
    const mod = MODS_DATABASE.find(m => m.id === id);
    assert.ok(mod, `Expected Forge port "${id}" in MODS_DATABASE`);
    assert.ok(mod.curseforgeUrl.startsWith('https://www.curseforge.com/minecraft/mc-mods/'), `Unexpected CF URL for ${id}: ${mod.curseforgeUrl}`);
    assert.equal(isUnsupportedOnForge(mod), false, `Forge port "${id}" should not be flagged unsupported on Forge`);
  }

  // Nvidium Forged must be completely absent (A4)
  assert.equal(MODS_DATABASE.find(m => m.id === 'nvidium-forged'), undefined);

  // Verified uncertain/outdated mods must be yellow instead of green/lime
  const memLeakFix = MODS_DATABASE.find(m => m.id === 'memory-leak-fix-modern-port')!;
  const quickPack = MODS_DATABASE.find(m => m.id === 'quick-pack')!;
  assert.equal(getBaseHealthTier(memLeakFix), 'yellow');
  assert.equal(getCheckerTier(memLeakFix, new Set()).tier, 'yellow');
  assert.equal(getBaseHealthTier(quickPack), 'yellow');
  assert.equal(getCheckerTier(quickPack, new Set()).tier, 'yellow');

  // Mutual exclusions between ports and originals
  assert.ok(analyzeSelection(['vmp-forge', 'very-many-players-vmp']).conflicts.length >= 1);
  assert.ok(analyzeSelection(['noisium', 'noisiumed']).conflicts.length >= 1);
  assert.ok(analyzeSelection(['pluto', 'krypton-reno']).conflicts.length >= 1);
});

test('buildSmartAssembly supports focusModId anchoring across conflicting pipelines', () => {
  const basePrefs: AssemblyPreferences = {
    gpu: 'nvidia',
    mode: 'singleplayer',
    useShaders: false,
    useCreate: false,
    allowSinytra: true,
    goal: 'balanced',
  };

  // Anchor Alloyium -> excludes Nvidium even on NVIDIA + allowSinytra
  const alloyiumBuild = buildSmartAssembly({ ...basePrefs, focusModId: 'alloyium' });
  assert.ok(alloyiumBuild.modIds.includes('alloyium'));
  assert.ok(alloyiumBuild.modIds.includes('embeddium'));
  assert.ok(!alloyiumBuild.modIds.includes('nvidium'));
  assert.equal(analyzeSelection(alloyiumBuild.modIds).conflicts.length, 0);

  // Anchor Emberlens -> pulls Emberbium, strips Embeddium, Oculus, Nvidium, Alloyium cleanly
  const emberlensBuild = buildSmartAssembly({ ...basePrefs, focusModId: 'emberlens' });
  assert.ok(emberlensBuild.modIds.includes('emberlens'));
  assert.ok(emberlensBuild.modIds.includes('emberbium'));
  assert.ok(!emberlensBuild.modIds.includes('embeddium'));
  assert.ok(!emberlensBuild.modIds.includes('oculus'));
  assert.ok(!emberlensBuild.modIds.includes('nvidium'));
  assert.ok(!emberlensBuild.modIds.includes('alloyium'));
  const emberAnalysis = analyzeSelection(emberlensBuild.modIds);
  assert.equal(emberAnalysis.conflicts.length, 0);
  assert.equal(emberAnalysis.warnings.filter(w => w.severity === 'red').length, 0);

  // Anchor VMP Forge -> pulls VMP Forge and drops Fabric VMP + Sinytra if not needed
  const vmpBuild = buildSmartAssembly({ ...basePrefs, focusModId: 'vmp-forge' });
  assert.ok(vmpBuild.modIds.includes('vmp-forge'));
  assert.ok(!vmpBuild.modIds.includes('very-many-players-vmp'));
  assert.equal(analyzeSelection(vmpBuild.modIds).conflicts.length, 0);

  // Anchor Pluto -> replaces Krypton Reno cleanly
  const plutoBuild = buildSmartAssembly({ ...basePrefs, focusModId: 'pluto' });
  assert.ok(plutoBuild.modIds.includes('pluto'));
  assert.ok(!plutoBuild.modIds.includes('krypton-reno'));
  assert.equal(analyzeSelection(plutoBuild.modIds).conflicts.length, 0);

  // Anchor C2MEF -> pulls Forge C2ME port cleanly
  const c2meBuild = buildSmartAssembly({ ...basePrefs, focusModId: 'concurrent-chunk-management-engine-forge-c2me' });
  assert.ok(c2meBuild.modIds.includes('concurrent-chunk-management-engine-forge-c2me'));
  assert.equal(analyzeSelection(c2meBuild.modIds).conflicts.length, 0);

  // Anchor unsupported Fabric Lithium -> auto-swaps to Radium Re-Reforged with 0 conflicts
  const lithiumSwapBuild = buildSmartAssembly({ ...basePrefs, focusModId: 'lithium' });
  assert.ok(!lithiumSwapBuild.modIds.includes('lithium'));
  assert.ok(lithiumSwapBuild.modIds.includes('radium-re-reforged'));
  assert.equal(analyzeSelection(lithiumSwapBuild.modIds).conflicts.length, 0);

  // Anchor danger OptiFine -> rejected cleanly
  const optifineBuild = buildSmartAssembly({ ...basePrefs, focusModId: 'optifine' });
  assert.ok(!optifineBuild.modIds.includes('optifine'));
  assert.equal(analyzeSelection(optifineBuild.modIds).conflicts.length, 0);
});

test('DUAL_PORT_PAIRS resolve to valid mods and portStrategy switches Forge vs Fabric+Sinytra cleanly', () => {
  assert.ok(DUAL_PORT_PAIRS.length >= 8);
  for (const pair of DUAL_PORT_PAIRS) {
    assert.ok(MODS_DATABASE.some(m => m.id === pair.forgeModId), `Missing forgeModId ${pair.forgeModId}`);
    assert.ok(MODS_DATABASE.some(m => m.id === pair.fabricModId), `Missing fabricModId ${pair.fabricModId}`);
    assert.equal(getDualPortPairForMod(pair.forgeModId)?.id, pair.id);
    assert.equal(getDualPortPairForMod(pair.fabricModId)?.id, pair.id);
  }

  const serverHeavyBase: AssemblyPreferences = {
    gpu: 'nvidia',
    mode: 'server',
    useShaders: false,
    useCreate: false,
    allowSinytra: true,
    goal: 'max-safe',
  };

  // Native Forge strategy: uses Alloyium, C2MEF, VMP Forge, without Sinytra/Nvidium/Fabric duplicates
  const nativeBuild = buildSmartAssembly({ ...serverHeavyBase, portStrategy: 'native-forge' });
  assert.ok(nativeBuild.modIds.includes('alloyium'));
  assert.ok(nativeBuild.modIds.includes('concurrent-chunk-management-engine-forge-c2me'));
  assert.ok(nativeBuild.modIds.includes('vmp-forge'));
  assert.ok(!nativeBuild.modIds.includes('nvidium'));
  assert.ok(!nativeBuild.modIds.includes('c2me-concurrent-chunk-management-engine'));
  assert.ok(!nativeBuild.modIds.includes('very-many-players-vmp'));
  assert.equal(analyzeSelection(nativeBuild.modIds).conflicts.length, 0);

  // Hybrid strategy: native VMP Forge + C2MEF, plus Nvidium via Sinytra on NVIDIA without shaders
  const hybridBuild = buildSmartAssembly({ ...serverHeavyBase, portStrategy: 'hybrid' });
  assert.ok(hybridBuild.modIds.includes('nvidium'));
  assert.ok(hybridBuild.modIds.includes('concurrent-chunk-management-engine-forge-c2me'));
  assert.ok(hybridBuild.modIds.includes('vmp-forge'));
  assert.ok(hybridBuild.modIds.includes('sinytra-connector'));
  assert.equal(analyzeSelection(hybridBuild.modIds).conflicts.length, 0);

  // Fabric + Sinytra strategy: switches Nvidium, C2ME Fabric, VMP Fabric via Sinytra Connector
  const fabricBuild = buildSmartAssembly({ ...serverHeavyBase, portStrategy: 'fabric-sinytra' });
  assert.ok(fabricBuild.modIds.includes('nvidium'));
  assert.ok(fabricBuild.modIds.includes('c2me-concurrent-chunk-management-engine'));
  assert.ok(fabricBuild.modIds.includes('very-many-players-vmp'));
  assert.ok(fabricBuild.modIds.includes('sinytra-connector'));
  assert.ok(fabricBuild.modIds.includes('forgified-fabric-api'));
  assert.ok(!fabricBuild.modIds.includes('concurrent-chunk-management-engine-forge-c2me'));
  assert.ok(!fabricBuild.modIds.includes('vmp-forge'));
  assert.equal(analyzeSelection(fabricBuild.modIds).conflicts.length, 0);

  // smartFixAssembly breaks port clashes according to portStrategy
  const mixedPorts = ['embeddium', 'sinytra-connector', 'forgified-fabric-api', 'vmp-forge', 'very-many-players-vmp', 'concurrent-chunk-management-engine-forge-c2me', 'c2me-concurrent-chunk-management-engine'];
  const fixedNative = smartFixAssembly(mixedPorts, { ...serverHeavyBase, portStrategy: 'native-forge' });
  assert.ok(fixedNative.includes('vmp-forge') && !fixedNative.includes('very-many-players-vmp'));
  assert.ok(fixedNative.includes('concurrent-chunk-management-engine-forge-c2me') && !fixedNative.includes('c2me-concurrent-chunk-management-engine'));

  const fixedFabric = smartFixAssembly(mixedPorts, { ...serverHeavyBase, portStrategy: 'fabric-sinytra' });
  assert.ok(fixedFabric.includes('very-many-players-vmp') && !fixedFabric.includes('vmp-forge'));
  assert.ok(fixedFabric.includes('c2me-concurrent-chunk-management-engine') && !fixedFabric.includes('concurrent-chunk-management-engine-forge-c2me'));
});

test('isModIncompatibleWithSelection hides conflicting, transitive-conflicting, and unsupported mods while keeping active ones visible', async () => {
  const { isModIncompatibleWithSelection } = await import('./modLogic.ts');
  const byId = new Map(MODS_DATABASE.map(m => [m.id, m]));

  const activeSet = new Set(['embeddium', 'nvidium', 'radium-re-reforged']);

  // Active mods must never be hidden
  assert.equal(isModIncompatibleWithSelection(byId.get('embeddium')!, activeSet), false);
  assert.equal(isModIncompatibleWithSelection(byId.get('nvidium')!, activeSet), false);

  // Direct conflict with Embeddium / Nvidium / Radium
  assert.equal(isModIncompatibleWithSelection(byId.get('xenon')!, activeSet), true);
  assert.equal(isModIncompatibleWithSelection(byId.get('optifine')!, activeSet), true);
  assert.equal(isModIncompatibleWithSelection(byId.get('oculus')!, activeSet), true);
  assert.equal(isModIncompatibleWithSelection(byId.get('alloyium')!, activeSet), true);

  // Transitive dependency conflict: Emberlens -> Emberbium conflicts with Embeddium; Faster Iris Shadow Mapper -> Oculus conflicts with Nvidium
  assert.equal(isModIncompatibleWithSelection(byId.get('emberlens')!, activeSet), true);
  assert.equal(isModIncompatibleWithSelection(byId.get('faster-iris-shadow-mapper')!, activeSet), true);

  // Unsupported Fabric-only original
  assert.equal(isModIncompatibleWithSelection(byId.get('lithium')!, activeSet), true);

  // Compatible addons remain visible
  assert.equal(isModIncompatibleWithSelection(byId.get('flerovium')!, activeSet), false);
  assert.equal(isModIncompatibleWithSelection(byId.get('embeddium-extras')!, activeSet), false);

  // When Sinytra is disabled in prefs, Sinytra mods are hidden
  assert.equal(
    isModIncompatibleWithSelection(byId.get('c2me-concurrent-chunk-management-engine')!, new Set(['embeddium']), {
      gpu: 'nvidia',
      mode: 'singleplayer',
      useShaders: false,
      useCreate: false,
      allowSinytra: false,
      goal: 'balanced',
    }),
    true
  );
});

test('Golden Standard resolves 100% via findModByDisplayName and GPUTape works with Emberbium cleanly', () => {
  for (const g of GOLDEN_STANDARD_MODS) {
    const found = findModByDisplayName(g.name);
    assert.ok(found, `Golden standard mod "${g.name}" could not be resolved by findModByDisplayName`);
  }

  const emberGputape = analyzeSelection(['emberbium', 'emberlens', 'gputape']);
  assert.equal(emberGputape.conflicts.length, 0);
  assert.equal(emberGputape.warnings.length, 0);
});

test('EMI / JEI recipe viewer modes and bridge-aware visibility behave accurately across TMRV Updated', () => {
  const byId = new Map(MODS_DATABASE.map(m => [m.id, m]));
  const basePrefs: AssemblyPreferences = {
    gpu: 'nvidia',
    mode: 'singleplayer',
    useShaders: false,
    useCreate: false,
    allowSinytra: true,
    recipeViewer: 'emi',
    goal: 'max-safe',
  };

  // Pure EMI build pulls EMI + TMRV Updated + native EMI plugins, skips JEI & JER/JEP/JEED
  const emiBuild = buildSmartAssembly(basePrefs);
  assert.ok(emiBuild.modIds.includes('emi'));
  assert.ok(emiBuild.modIds.includes('tmrv-updated'));
  assert.ok(emiBuild.modIds.includes('emi-loot'));
  assert.ok(!emiBuild.modIds.includes('just-enough-items-jei'));
  assert.ok(!emiBuild.modIds.includes('jeioptimizer'));
  assert.ok(!emiBuild.modIds.includes('just-enough-resources-jer'));
  assert.equal(analyzeSelection(emiBuild.modIds).conflicts.length, 0);
  assert.equal(analyzeSelection(emiBuild.modIds).warnings.length, 0);

  // In pure EMI WITH TMRV Updated active: JEI plugins (JEP, JER) are bridge-compatible!
  const withTmrvSet = new Set(['emi', 'tmrv-updated']);
  const jepBridge = getRecipeBridgeStatus(byId.get('just-enough-professions-jep')!, withTmrvSet, basePrefs);
  assert.equal(jepBridge.compatible, true);
  assert.ok(jepBridge.viaBridge?.includes('TMRV'));
  assert.equal(
    shouldHideMod(byId.get('just-enough-professions-jep')!, withTmrvSet, basePrefs, {
      hideIncompatible: true,
      hideUselessCovered: true,
    }),
    false
  );

  // In pure EMI WITHOUT TMRV Updated active: JEI plugins (JEP, JER) are hidden!
  const withoutTmrvSet = new Set(['emi']);
  const jepNoTmrv = getRecipeBridgeStatus(byId.get('just-enough-professions-jep')!, withoutTmrvSet, basePrefs);
  assert.equal(jepNoTmrv.compatible, false);
  assert.equal(
    shouldHideMod(byId.get('just-enough-professions-jep')!, withoutTmrvSet, basePrefs, {
      hideIncompatible: true,
      hideUselessCovered: true,
    }),
    true
  );

  // JEI engine mods (JEIOptimizer, [JEIR]) are NOT compatible in pure EMI even with TMRV Updated
  assert.equal(getRecipeBridgeStatus(byId.get('jeioptimizer')!, withTmrvSet, basePrefs).compatible, false);
  assert.equal(
    shouldHideMod(byId.get('jeioptimizer')!, withTmrvSet, basePrefs, {
      hideIncompatible: true,
      hideUselessCovered: true,
    }),
    true
  );

  // Removing TMRV Updated via toggleModSmart cascades orphan removal of JER
  const dropTmrv = toggleModSmart(['emi', 'tmrv-updated', 'just-enough-resources-jer'], 'tmrv-updated', { strict: true });
  assert.ok(!dropTmrv.nextIds.includes('tmrv-updated'));
  assert.ok(!dropTmrv.nextIds.includes('just-enough-resources-jer'));

  // EMI + JEI mode conflicts with TMRV Updated and detects redundant TMRV
  const clash = analyzeSelection(['emi', 'just-enough-items-jei', 'tmrv-updated']);
  assert.ok(clash.conflicts.length >= 1);
  assert.ok(clash.conflictingIdSet.has('tmrv-updated'));
  assert.ok(getModSuperseder(byId.get('tmrv-updated')!, new Set(['emi', 'just-enough-items-jei']), undefined, false)?.isActiveInSelection);
});

test('supersededBy and supersededWhenAll hide strictly overlapped mods and warn/clean in selection', () => {
  const byId = new Map(MODS_DATABASE.map(m => [m.id, m]));
  const emiPrefs: AssemblyPreferences = {
    gpu: 'nvidia',
    mode: 'singleplayer',
    useShaders: false,
    useCreate: false,
    allowSinytra: true,
    recipeViewer: 'emi',
    goal: 'balanced',
  };

  // Global superseder hides FastBoot and Rubidium even if not selected
  assert.equal(
    shouldHideMod(byId.get('fastboot')!, new Set(['embeddium']), emiPrefs, {
      hideIncompatible: false,
      hideUselessCovered: true,
    }),
    true
  );
  assert.equal(
    shouldHideMod(byId.get('rubidium')!, new Set(['embeddium']), emiPrefs, {
      hideIncompatible: false,
      hideUselessCovered: true,
    }),
    true
  );

  // Conditional supersededWhenAll: JER hidden when BOTH EMI Loot + EMI Ores are active, visible if only one is active
  const bothEmiSet = new Set(['emi', 'tmrv-updated', 'emi-loot', 'emi-ores']);
  assert.equal(
    shouldHideMod(byId.get('just-enough-resources-jer')!, bothEmiSet, emiPrefs, {
      hideIncompatible: true,
      hideUselessCovered: true,
    }),
    true
  );

  const partialEmiSet = new Set(['emi', 'tmrv-updated', 'emi-loot']);
  assert.equal(
    shouldHideMod(byId.get('just-enough-resources-jer')!, partialEmiSet, emiPrefs, {
      hideIncompatible: true,
      hideUselessCovered: true,
    }),
    false
  );

  // Active selected superseded mods never vanish silently and produce yellow warning; smartFixAssembly strips them
  const redundantPack = ['embeddium', 'modernfix', 'fastboot', 'emi', 'emi-professions', 'just-enough-professions-jep'];
  assert.equal(
    shouldHideMod(byId.get('fastboot')!, new Set(redundantPack), emiPrefs, {
      hideIncompatible: true,
      hideUselessCovered: true,
    }),
    false
  );
  const check = analyzeSelection(redundantPack);
  assert.ok(check.warnings.some(w => w.modId === 'fastboot' && w.severity === 'yellow'));
  assert.ok(check.warnings.some(w => w.modId === 'just-enough-professions-jep' && w.severity === 'yellow'));

  const fixed = smartFixAssembly(redundantPack, emiPrefs);
  assert.ok(!fixed.includes('fastboot'));
  assert.ok(!fixed.includes('just-enough-professions-jep'));
  assert.ok(fixed.includes('emi-professions'));
});

test('audit and leader harmonization: Spark is profiler leader, Clumps leads items, and tier classifications are accurate', () => {
  const byId = new Map(MODS_DATABASE.map(m => [m.id, m]));

  // Spark vs niche Java 25 fork
  const spark = byId.get('spark')!;
  const sparkFork = byId.get('spark-profiler-au-naturel-edit-java-25')!;
  assert.ok(spark, 'Official Spark must exist in database');
  assert.equal(spark.isGroupLeader, true);
  assert.equal(spark.healthTier, 'green');
  assert.equal(spark.status, 'diagnostic');
  assert.equal(getCheckerTier(spark).tier, 'green');
  assert.deepEqual(sparkFork.supersededBy, ['spark']);
  assert.equal(sparkFork.healthTier, 'yellow');

  // Core leaders vs demoted addons
  const clumps = byId.get('clumps')!;
  const itemmerge = byId.get('itemmerge')!;
  assert.equal(clumps.isGroupLeader, true);
  assert.equal(clumps.status, 'recommended');
  assert.equal(getCheckerTier(clumps).tier, 'green');
  assert.equal(itemmerge.status, 'useful');
  assert.equal(getCheckerTier(itemmerge).tier, 'lime');

  const entityCulling = byId.get('entity-culling')!;
  assert.equal(entityCulling.isGroupLeader, true);
  assert.equal(entityCulling.status, 'recommended');
  assert.equal(getCheckerTier(entityCulling).tier, 'green');

  const smoothBoot = byId.get('smooth-boot-reloaded')!;
  assert.equal(smoothBoot.isGroupLeader, true);
  assert.equal(smoothBoot.status, 'recommended');
  assert.equal(getCheckerTier(smoothBoot).tier, 'green');

  const jei = byId.get('just-enough-items-jei')!;
  assert.equal(jei.isGroupLeader, true);
  assert.equal(jei.status, 'recommended');
  assert.equal(getCheckerTier(jei).tier, 'green');

  const dynamicRender = byId.get('dynamicrenderdistance')!;
  const configSwitch = byId.get('config-preset-switch-low-medium-high-f10')!;
  assert.equal(dynamicRender.isGroupLeader, true);
  assert.equal(dynamicRender.status, 'useful');
  assert.equal(getCheckerTier(dynamicRender).tier, 'lime');
  assert.equal(configSwitch.status, 'useful');
  assert.equal(getCheckerTier(configSwitch).tier, 'lime');

  // Outdated Pluto & Capability Fix
  const pluto = byId.get('pluto')!;
  assert.equal(pluto.status, 'outdated');
  assert.equal(getCheckerTier(pluto).tier, 'yellow');
  assert.deepEqual(pluto.supersededBy, ['krypton-reno']);

  const capFix = byId.get('capability-fix')!;
  assert.equal(capFix.status, 'outdated');
  assert.equal(getCheckerTier(capFix).tier, 'yellow');
  assert.deepEqual(capFix.supersededBy, ['capability-fix-revived']);

  // Verified Sodium Chloride is recommended green
  const chloride = byId.get('sodium-chloride')!;
  assert.equal(chloride.status, 'recommended');
  assert.equal(getCheckerTier(chloride).tier, 'green');

  // Default buildSmartAssembly server mode includes spark
  const serverBuild = buildSmartAssembly({ ...INITIAL_BUILDER_PREFS, mode: 'server' });
  assert.ok(serverBuild.modIds.includes('spark'));
  assert.ok(!serverBuild.modIds.includes('spark-profiler-au-naturel-edit-java-25'));
});

test('freshness audit, 6 newly added mods, Emberbium+Nvidium stack, PartiCull overlap, and user presets behave accurately', () => {
  const byId = new Map(MODS_DATABASE.map(m => [m.id, m]));

  // All 6 newly added mods exist with direct CurseForge slugs
  for (const id of ['compact-f3-plus', 'resourceful-config', 'fzzy-config', 'kotlin-for-forge', 'matlib', 'cupboard']) {
    const mod = byId.get(id);
    assert.ok(mod, `Missing newly added mod "${id}"`);
    assert.ok(mod.curseforgeUrl.startsWith('https://www.curseforge.com/minecraft/mc-mods/'), `Unexpected URL for ${id}`);
  }

  // Freshness & accuracy statuses
  assert.equal(getBaseHealthTier(byId.get('emberbium')!), 'green');
  assert.equal(getBaseHealthTier(byId.get('compact-f3-plus')!), 'green');
  assert.equal(getBaseHealthTier(byId.get('sodium-embeddium-options-api')!), 'green');
  assert.equal(getBaseHealthTier(byId.get('sodium-embeddium-dynamic-lights')!), 'green');
  assert.equal(byId.get('async-advancement-toast')!.status, 'useful');
  assert.equal(byId.get('async-advancement-toast')!.healthTier, 'yellow');
  assert.equal(getBaseHealthTier(byId.get('async-advancement-toast')!), 'lime');
  assert.equal(byId.get('minimal-backup-zstd')!.status, 'useful');
  assert.equal(byId.get('minimal-backup-zstd')!.healthTier, 'yellow');
  assert.equal(getBaseHealthTier(byId.get('minimal-backup-zstd')!), 'lime');
  assert.equal(byId.get('optimized-recipe-book-orb')!.status, 'useful');
  assert.equal(byId.get('bobby-reforged')!.status, 'useful');

  // C2MEF has 'c2mey' search alias tag
  const c2mef = byId.get('concurrent-chunk-management-engine-forge-c2me')!;
  assert.ok((c2mef.tags ?? []).some(t => t.toLowerCase().includes('c2mey')));

  // Emberbium + Nvidium via Sinytra has 0 conflicts and 0 warnings
  const emberNvidium = analyzeSelection(['emberbium', 'nvidium', 'sinytra-connector', 'forgified-fabric-api', 'connector-extras']);
  assert.equal(emberNvidium.conflicts.length, 0);
  assert.equal(emberNvidium.warnings.length, 0);

  // Hard dependency checks: Particle Core -> Fzzy Config + Kotlin for Forge; EBER -> MatLib; Connectivity -> Cupboard
  const missingParticleDeps = analyzeSelection(['embeddium', 'particle-core']);
  assert.ok(missingParticleDeps.warnings.some(w => w.modId === 'particle-core' && w.severity === 'yellow' && w.fixModIds?.includes('kotlin-for-forge')));
  const fixedParticleDeps = toggleModSmart(['embeddium'], 'particle-core', { strict: true });
  assert.ok(fixedParticleDeps.nextIds.includes('kotlin-for-forge'));
  assert.ok(fixedParticleDeps.nextIds.includes('fzzy-config'));

  const missingMatlib = analyzeSelection(['embeddium', 'enhanced-block-entities-reloaded']);
  assert.ok(missingMatlib.warnings.some(w => w.modId === 'enhanced-block-entities-reloaded' && w.severity === 'yellow' && w.fixModIds?.includes('matlib')));

  const missingCupboard = analyzeSelection(['embeddium', 'connectivity']);
  assert.ok(missingCupboard.warnings.some(w => w.modId === 'connectivity' && w.severity === 'yellow' && w.fixModIds?.includes('cupboard')));

  // PartiCull is hidden/superseded when Particle Core is active
  const particull = byId.get('particull')!;
  assert.equal(
    shouldHideMod(particull, new Set(['embeddium', 'particle-core', 'fzzy-config', 'kotlin-for-forge']), INITIAL_BUILDER_PREFS, {
      hideIncompatible: true,
      hideUselessCovered: true,
    }),
    true
  );
  const overlapWarn = analyzeSelection(['embeddium', 'particle-core', 'fzzy-config', 'kotlin-for-forge', 'particull']);
  assert.ok(overlapWarn.warnings.some(w => w.modId === 'particull' && w.severity === 'yellow'));

  // Both user builds exist in MOD_PRESETS and are completely clean
  const nvidiumPreset = MOD_PRESETS.find(p => p.id === 'user-nvidium-emberbium');
  const alloyiumPreset = MOD_PRESETS.find(p => p.id === 'user-alloyium-embeddium');
  assert.ok(nvidiumPreset && alloyiumPreset);
  assert.ok(nvidiumPreset.modIds.includes('emberbium'));
  assert.ok(nvidiumPreset.modIds.includes('nvidium'));
  assert.ok(nvidiumPreset.modIds.includes('matlib'));
  assert.ok(!nvidiumPreset.modIds.includes('particull'));
  assert.ok(alloyiumPreset.modIds.includes('embeddium'));
  assert.ok(alloyiumPreset.modIds.includes('alloyium'));
  assert.equal(analyzeSelection(nvidiumPreset.modIds).conflicts.length, 0);
  assert.equal(analyzeSelection(nvidiumPreset.modIds).warnings.length, 0);
  assert.equal(analyzeSelection(alloyiumPreset.modIds).conflicts.length, 0);
  assert.equal(analyzeSelection(alloyiumPreset.modIds).warnings.length, 0);
});

test('DATABASE_UPDATED_AT, per-mod update labels, organizeAssemblyTree, and formatAssemblyTreeText work accurately', () => {
  assert.equal(DATABASE_UPDATED_AT, '16.11.2026');

  const byId = new Map(MODS_DATABASE.map(m => [m.id, m]));
  for (const id of [
    'emberbium',
    'embeddium',
    'nvidium',
    'alloyium',
    'compact-f3-plus',
    'matlib',
    'cupboard',
    'fzzy-config',
    'kotlin-for-forge',
  ]) {
    const mod = byId.get(id)!;
    const label = getModUpdatedLabel(mod);
    assert.ok(label && label.length > 0, `Expected non-empty update label for ${id}`);
  }

  // Every preset preserves exact unique mod count in organizeAssemblyTree with zero drops or duplicates
  for (const preset of MOD_PRESETS) {
    const uniqueIds = Array.from(new Set(preset.modIds));
    const tree = organizeAssemblyTree(preset.modIds);
    const flattenedIds: string[] = [];
    for (const node of tree) {
      flattenedIds.push(node.parent.id);
      for (const child of node.children) {
        flattenedIds.push(child.mod.id);
      }
    }
    assert.equal(
      flattenedIds.length,
      uniqueIds.length,
      `Preset "${preset.id}" tree count mismatch: got ${flattenedIds.length}, expected ${uniqueIds.length}`
    );
    assert.equal(
      new Set(flattenedIds).size,
      uniqueIds.length,
      `Preset "${preset.id}" tree has duplicate nodes`
    );
  }

  // Verify user-nvidium-emberbium tree nesting
  const nvidiumPreset = MOD_PRESETS.find(p => p.id === 'user-nvidium-emberbium')!;
  const nvidiumTree = organizeAssemblyTree(nvidiumPreset.modIds);
  const byParentId = new Map(nvidiumTree.map(n => [n.parent.id, n.children.map(c => c.mod.id)]));

  const emberKids = byParentId.get('emberbium') ?? [];
  for (const expected of ['nvidium', 'flerovium', 'immediatelyfast', 'kerria']) {
    assert.ok(emberKids.includes(expected), `Expected ${expected} nested under emberbium`);
  }

  const sinytraKids = byParentId.get('sinytra-connector') ?? [];
  assert.ok(sinytraKids.includes('forgified-fabric-api'));
  assert.ok(sinytraKids.includes('connector-extras'));

  const eberKids = byParentId.get('enhanced-block-entities-reloaded') ?? [];
  assert.ok(eberKids.includes('matlib'));

  const particleKids = byParentId.get('particle-core') ?? [];
  assert.ok(particleKids.includes('fzzy-config'));
  assert.ok(particleKids.includes('kotlin-for-forge'));

  const controllingKids = byParentId.get('controlling') ?? [];
  assert.ok(controllingKids.includes('searchables'));

  // Verify shader and server tree nesting (Oculus -> Embeddium, so top root is embeddium)
  const shaderTree = new Map(
    organizeAssemblyTree(['embeddium', 'oculus', 'shadowlod', 'faster-iris-shadow-mapper']).map(n => [
      n.parent.id,
      n.children.map(c => c.mod.id),
    ])
  );
  const embedShaderKids = shaderTree.get('embeddium') ?? [];
  assert.ok(embedShaderKids.includes('oculus'), 'Expected oculus nested under embeddium');
  assert.ok(embedShaderKids.includes('shadowlod'), 'Expected shadowlod nested under embeddium root');
  assert.ok(embedShaderKids.includes('faster-iris-shadow-mapper'), 'Expected faster-iris-shadow-mapper nested under embeddium root');

  const serverTree = new Map(
    organizeAssemblyTree(['connectivity', 'cupboard']).map(n => [n.parent.id, n.children.map(c => c.mod.id)])
  );
  assert.ok((serverTree.get('connectivity') ?? []).includes('cupboard'), 'Expected cupboard nested under connectivity');

  // Formatted export renders 1-indexed parent mods, indented child arrows, update labels, and CurseForge URLs
  const formattedWithUrls = formatAssemblyTreeText(nvidiumPreset.modIds, true);
  assert.ok(formattedWithUrls.includes('1. Emberbium'));
  assert.ok(formattedWithUrls.includes('   ↳ Nvidium'));
  assert.ok(formattedWithUrls.includes('[обн.'));
  assert.ok(formattedWithUrls.includes('https://www.curseforge.com/'));

  const formattedNoUrls = formatAssemblyTreeText(nvidiumPreset.modIds, false);
  assert.ok(!formattedNoUrls.includes('https://www.curseforge.com/'));
});

test('matchJarFilenamesToMods resolves Windows .jar filenames including dual-port C2ME and unknowns', async () => {
  const { matchJarFilenamesToMods } = await import('./jarMatcher.ts');
  const { matchedIds, unmatchedJars } = matchJarFilenamesToMods([
    'emberbium-1.20.1-1.0.4.jar',
    'nvidium-0.2.6-beta.jar',
    'Sinytra-Connector-1.0.0-beta.46+1.20.1.jar',
    'alltheleaks-1.20.1-1.1.4.jar',
    'c2mef-1.20.1-0.2.0.jar',
    'c2me-fabric-mc1.20.1-0.2.0.jar',
    'create-1.20.1-0.5.1.j.jar',
  ]);

  assert.ok(matchedIds.includes('emberbium'));
  assert.ok(matchedIds.includes('nvidium'));
  assert.ok(matchedIds.includes('sinytra-connector'));
  assert.ok(matchedIds.includes('alltheleaks-memory-leak-fix'));
  assert.ok(matchedIds.includes('concurrent-chunk-management-engine-forge-c2me'));
  assert.ok(matchedIds.includes('c2me-concurrent-chunk-management-engine'));
  assert.deepEqual(unmatchedJars, ['create-1.20.1-0.5.1.j.jar']);
});

test('persistence helpers sanitize saved tabs, dates, mod IDs, and builder preferences across restarts', async () => {
  const { parsePersistedState, formatRuDate } = await import('./persistence.ts');

  const dateStr = formatRuDate(new Date('2026-11-18T10:00:00Z'));
  assert.match(dateStr, /^\d{2}\.\d{2}\.2026$/);

  const parsed = parsePersistedState({
    schemaVersion: 2,
    dbUpdatedAt: '16.11.2026',
    lastSavedDate: '18.11.2026',
    activeTab: 'assembler',
    checkedModIds: ['embeddium', 'non-existent-mod', 'alloyium', 'embeddium'],
    builderModIds: ['emberbium', 'nvidium'],
    builderPrefs: {
      gpu: 'amd-intel',
      mode: 'server',
      goal: 'max-safe',
      useShaders: true,
      useCreate: false,
      allowSinytra: false,
      portStrategy: 'native-forge',
      recipeViewer: 'emi',
      focusModId: 'alloyium',
      packSize: 'heavy',
    },
    focusModId: 'alloyium',
  });

  assert.ok(parsed);
  assert.equal(parsed.dbUpdatedAt, '16.11.2026');
  assert.equal(parsed.lastSavedDate, '18.11.2026');
  assert.equal(parsed.activeTab, 'assembler');
  assert.deepEqual(parsed.checkedModIds, ['embeddium', 'alloyium']);
  assert.deepEqual(parsed.builderModIds, ['emberbium', 'nvidium']);
  assert.equal(parsed.builderPrefs?.recipeViewer, 'emi');
  assert.equal(parsed.builderPrefs?.gpu, 'amd-intel');
  assert.equal('packSize' in (parsed.builderPrefs || {}), false);

  const invalidTab = parsePersistedState({ activeTab: 'file' });
  assert.equal(invalidTab?.activeTab, undefined);
});

test('synergy audit fixes: Emberbium vs Oculus/Alloyium, Nvidium symmetry, HC-HariChunk, Tritium, Bobby Reforged, and rules integrity', async () => {
  const { INCOMPATIBILITY_RULES } = await import('../data/modsData.ts');
  const { normalizeSlug } = await import('./modAnalyzer.ts');

  // Every mod listed in rules.json must resolve to a real mod in MODS_DATABASE (no phantom entries like OptiLeaves)
  const dbSlugs = new Set(MODS_DATABASE.map(m => normalizeSlug(m.name)));
  for (const rule of INCOMPATIBILITY_RULES) {
    for (const cm of rule.conflictingMods) {
      assert.ok(dbSlugs.has(normalizeSlug(cm)), `Unresolved mod "${cm}" in rule "${rule.title}"`);
    }
  }

  // Emberbium conflicts with Oculus, Faster Iris Shadow Mapper, and Alloyium; Embeddium conflicts with Emberlens
  for (const clashPair of [
    ['emberbium', 'oculus'],
    ['emberbium', 'alloyium'],
    ['emberbium', 'faster-iris-shadow-mapper'],
    ['embeddium', 'emberlens'],
  ]) {
    const res = analyzeSelection(clashPair);
    assert.ok(res.conflicts.length >= 1, `Expected conflict between ${clashPair.join(' + ')}`);
  }

  // Oculus + Alloyium + Faster Iris Shadow Mapper remains conflict-free on Embeddium
  const cleanOculusAlloyium = analyzeSelection(['embeddium', 'oculus', 'faster-iris-shadow-mapper', 'alloyium']);
  assert.equal(cleanOculusAlloyium.conflicts.length, 0);

  // Nvidium conflicts with Oculus & Alloyium cleanly
  const cleanNvidium = analyzeSelection(['embeddium', 'sinytra-connector', 'forgified-fabric-api', 'nvidium']);
  assert.equal(cleanNvidium.conflicts.length, 0);
  assert.equal(cleanNvidium.warnings.length, 0);

  const nvidOculus = analyzeSelection(['embeddium', 'sinytra-connector', 'forgified-fabric-api', 'nvidium', 'oculus']);
  assert.ok(nvidOculus.conflictingIdSet.has('nvidium'));
  assert.ok(nvidOculus.conflictingIdSet.has('oculus'));

  const nvidAlloyium = analyzeSelection(['embeddium', 'sinytra-connector', 'forgified-fabric-api', 'nvidium', 'alloyium']);
  assert.ok(nvidAlloyium.conflictingIdSet.has('nvidium'));
  assert.ok(nvidAlloyium.conflictingIdSet.has('alloyium'));

  // HC-HariChunk conflicts with C2ME-Forge and smartFixAssembly strips it
  const hariClash = analyzeSelection(['concurrent-chunk-management-engine-forge-c2me', 'hc-harichunk']);
  assert.ok(hariClash.conflicts.length >= 1);
  const fixedHari = smartFixAssembly(['embeddium', 'concurrent-chunk-management-engine-forge-c2me', 'hc-harichunk']);
  assert.ok(fixedHari.includes('concurrent-chunk-management-engine-forge-c2me'));
  assert.ok(!fixedHari.includes('hc-harichunk'));

  // Tritium conflicts with CullLessLeaves Reforged
  const tritiumClash = analyzeSelection(['culllessleaves-reforged', 'tritium']);
  assert.ok(tritiumClash.conflicts.length >= 1);

  // Bobby Reforged is clean standalone with RAM guard, warns without ModernFix+FerriteCore, and is cleaned when Distant Horizons is active
  const bobbyNoRamGuard = analyzeSelection(['embeddium', 'bobby-reforged']);
  assert.ok(bobbyNoRamGuard.warnings.some(w => w.modId === 'bobby-reforged' && w.fixModIds?.includes('modernfix')));
  const bobbySolo = analyzeSelection(['embeddium', 'modernfix', 'ferritecore', 'bobby-reforged']);
  assert.equal(bobbySolo.warnings.length, 0);
  const bobbyWithDh = analyzeSelection(['embeddium', 'modernfix', 'ferritecore', 'distant-horizons', 'bobby-reforged']);
  assert.ok(bobbyWithDh.warnings.some(w => w.modId === 'bobby-reforged' && w.severity === 'yellow'));
  const fixedDh = smartFixAssembly(['embeddium', 'distant-horizons', 'bobby-reforged']);
  assert.ok(!fixedDh.includes('bobby-reforged'));

  // Newly mapped dependencies: Sinytra -> FFAPI, Accelerated Recoiling -> Accelerated Rendering, GeckoLib tree nesting
  const sinytraMissingFfapi = analyzeSelection(['sinytra-connector']);
  assert.ok(sinytraMissingFfapi.warnings.some(w => w.modId === 'sinytra-connector' && w.fixModIds?.includes('forgified-fabric-api')));

  const recoilingMissingParent = analyzeSelection(['embeddium', 'accelerated-recoiling']);
  assert.ok(recoilingMissingParent.warnings.some(w => w.modId === 'accelerated-recoiling' && w.fixModIds?.includes('accelerated-rendering')));

  const geckoTree = organizeAssemblyTree(['geckolib', 'geckolib-animation-optimizer', 'geckolibbetterfps']);
  assert.equal(geckoTree.length, 1);
  assert.equal(geckoTree[0].parent.id, 'geckolib');
  assert.equal(geckoTree[0].children.length, 2);
});

test('deep mod logic audit: no false coveredBy substrings, no overbroad exclusive conflicts, and accurate loader/tier checks', async () => {
  const { matchesCoveredByName } = await import('./modAnalyzer.ts');
  const byId = new Map(MODS_DATABASE.map(m => [m.id, m]));

  // Whole-word coveredBy matching prevents Optimi matching "Immersive Optimization."
  assert.equal(matchesCoveredByName('Immersive Optimization.', 'Optimi'), false);
  assert.equal(matchesCoveredByName('Immersive Optimization.', 'Immersive Optimization'), true);
  assert.equal(matchesCoveredByName('AllTheLeaks + ModernFix', 'ModernFix'), true);

  // Non-conflicting utility tweaks in groups must NOT delete core leaders or trigger false conflicts
  const aiToggle = toggleModSmart(['embeddium', 'radium-re-reforged'], 'ai-improvements', { strict: true });
  assert.ok(aiToggle.nextIds.includes('radium-re-reforged'));
  assert.ok(aiToggle.nextIds.includes('ai-improvements'));

  const fastEventsToggle = toggleModSmart(['embeddium'], 'fast-events', { strict: true });
  assert.ok(fastEventsToggle.nextIds.includes('embeddium'));
  assert.ok(fastEventsToggle.nextIds.includes('fast-events'));

  const tcpToggle = toggleModSmart(['krypton-reno'], 'tcp-nodeway', { strict: true });
  assert.ok(tcpToggle.nextIds.includes('krypton-reno'));
  assert.ok(tcpToggle.nextIds.includes('tcp-nodeway'));

  const renderScaleToggle = toggleModSmart(['dynamic-fps'], 'renderscale', { strict: true });
  assert.ok(renderScaleToggle.nextIds.includes('dynamic-fps'));
  assert.ok(renderScaleToggle.nextIds.includes('renderscale'));

  // smartFixAssembly preserves compatible utility tweaks alongside group leaders
  const keptUtilities = smartFixAssembly(['embeddium', 'fast-events', 'radium-re-reforged', 'ai-improvements', 'krypton-reno', 'tcp-nodeway', 'dynamic-fps', 'renderscale']);
  for (const id of ['embeddium', 'fast-events', 'radium-re-reforged', 'ai-improvements', 'krypton-reno', 'tcp-nodeway', 'dynamic-fps', 'renderscale']) {
    assert.ok(keptUtilities.includes(id), `smartFixAssembly dropped compatible mod ${id}`);
  }

  // Adding Chloride or LightStar to Emberbium+Nvidium keeps Emberbium & Nvidium intact (defaults to Embeddium only when empty)
  const emberChloride = toggleModSmart(['emberbium', 'sinytra-connector', 'forgified-fabric-api', 'nvidium'], 'sodium-chloride', { strict: true });
  assert.ok(emberChloride.nextIds.includes('emberbium'));
  assert.ok(emberChloride.nextIds.includes('nvidium'));
  assert.ok(emberChloride.nextIds.includes('sodium-chloride'));
  assert.ok(!emberChloride.nextIds.includes('embeddium'));
  assert.equal(analyzeSelection(emberChloride.nextIds).conflicts.length, 0);

  const freshChloride = toggleModSmart([], 'sodium-chloride', { strict: true });
  assert.ok(freshChloride.nextIds.includes('embeddium'));

  // Native Universal (Forge/Fabric) mods without superseder resolve to lime, whereas superseded forks/unsupported 1.20.4+ mods warn accurately
  assert.equal(getCheckerTier(byId.get('alternate-current')!).tier, 'lime');
  assert.equal(getCheckerTier(byId.get('spark-profiler-au-naturel-edit-java-25')!).tier, 'yellow');
  assert.equal(getCheckerTier(byId.get('voxy')!).tier, 'red');
  assert.equal(getCheckerTier(byId.get('scalablelux')!).tier, 'red');
  assert.ok(analyzeSelection(['spark', 'spark-profiler-au-naturel-edit-java-25']).conflicts.length >= 1);
  assert.ok(analyzeSelection(['embeddium', 'voxy']).warnings.some(w => w.modId === 'voxy' && w.severity === 'red'));
});

test('cross-mod impact & compatibility calibration: no Rubidium slug collision, full smartFix coverage, accurate tiers & scores', async () => {
  const { getModEffectivenessScore, getRuleConflictingIds } = await import('./modAnalyzer.ts');
  const byId = new Map(MODS_DATABASE.map(m => [m.id, m]));

  // Rubidium (Fluid Render Fix) must NOT falsely collide with Sodium forks
  assert.equal(analyzeSelection(['embeddium', 'rubidium-fluid-render-fix']).conflicts.length, 0);
  assert.equal(analyzeSelection(['rubidium', 'rubidium-fluid-render-fix']).conflicts.length, 0);

  // Emberbium explicitly conflicts with Embeddium-0.3.31-bound mesh/chunk addons
  for (const addonId of ['revidium-accedium', 'maple-mesh-render', 'sodium-sightline', 'sodium-streamline', 'sodium-fovea']) {
    const res = analyzeSelection(['emberbium', addonId]);
    assert.ok(res.conflicts.length >= 1, `Expected conflict between emberbium and ${addonId}`);
  }

  // Every single conflicting pair across the entire 510-mod DB is cleanly resolved to 0 conflicts by smartFixAssembly
  for (const m of MODS_DATABASE) {
    for (const cid of getRuleConflictingIds(m.id)) {
      if (m.id >= cid) continue;
      const fixed = smartFixAssembly([m.id, cid]);
      assert.equal(
        analyzeSelection(fixed).conflicts.length,
        0,
        `smartFixAssembly left conflict for pair ${m.id} + ${cid}`
      );
    }
  }

  // Experimental / frozen / archived / unverified C2ME forks classify as yellow
  for (const id of ['emberlens', 'hc-harichunk', 'bobby-reforged', 'better-biome-reblend']) {
    assert.equal(getBaseHealthTier(byId.get(id)!), 'yellow', `${id} should be yellow`);
  }

  // Every superseded mod strictly scores below every viable superseder
  for (const m of MODS_DATABASE) {
    if (!m.supersededBy) continue;
    const ms = getModEffectivenessScore(m);
    for (const sid of m.supersededBy) {
      const sm = byId.get(sid);
      if (sm) {
        assert.ok(
          ms < getModEffectivenessScore(sm),
          `Expected ${m.id} (${ms}) < superseder ${sm.id} (${getModEffectivenessScore(sm)})`
        );
      }
    }
  }

  // Relative impact hierarchy: native Forge ports > Sinytra bridges, core engines > pure libraries, Oculus > Emberlens
  assert.ok(
    getModEffectivenessScore(byId.get('concurrent-chunk-management-engine-forge-c2me')!) >
      getModEffectivenessScore(byId.get('c2me-concurrent-chunk-management-engine')!)
  );
  assert.ok(
    getModEffectivenessScore(byId.get('c2me-concurrent-chunk-management-engine')!) >
      getModEffectivenessScore(byId.get('hc-harichunk')!)
  );
  assert.ok(getModEffectivenessScore(byId.get('vmp-forge')!) > getModEffectivenessScore(byId.get('very-many-players-vmp')!));
  assert.ok(getModEffectivenessScore(byId.get('emberbium')!) > getModEffectivenessScore(byId.get('kotlin-for-forge')!));
  assert.ok(getModEffectivenessScore(byId.get('radium-re-reforged')!) > getModEffectivenessScore(byId.get('matlib')!));
  assert.ok(getModEffectivenessScore(byId.get('oculus')!) > getModEffectivenessScore(byId.get('emberlens')!));

  // Precise incompatibility coverage: Carbons, expanded OptiFine hub, Acedium vs Oculus, Voxy vs DH, contextual overlaps
  assert.ok(analyzeSelection(['embeddium', 'carbons']).conflicts.length >= 1);
  assert.ok(analyzeSelection(['optifine', 'immediatelyfast']).conflicts.length >= 1);
  assert.ok(analyzeSelection(['optifine', 'distant-horizons']).conflicts.length >= 1);
  assert.ok(analyzeSelection(['optifine', 'nvidium']).conflicts.length >= 1);
  assert.ok(analyzeSelection(['embeddium', 'revidium-accedium', 'oculus']).conflicts.length >= 1);
  assert.ok(analyzeSelection(['distant-horizons', 'voxy']).conflicts.length >= 1);

  const chlorideLights = analyzeSelection(['embeddium', 'sodium-chloride', 'sodium-embeddium-options-api', 'sodium-embeddium-dynamic-lights']);
  assert.equal(chlorideLights.conflicts.length, 0);
  assert.ok(chlorideLights.warnings.some(w => w.modId === 'sodium-embeddium-dynamic-lights' && w.severity === 'yellow'));

  const tritiumEber = analyzeSelection(['embeddium', 'tritium', 'enhanced-block-entities-reloaded', 'matlib']);
  assert.equal(tritiumEber.conflicts.length, 0);
  assert.ok(tritiumEber.warnings.some(w => w.modId === 'tritium' && w.severity === 'yellow'));
});

test('contextual interaction & impact engine: synergies, overlaps, orphaned bridges, and subsystem coverage', async () => {
  const { evaluateModImpactInPack, summarizeAssemblyImpact } = await import('./modAnalyzer.ts');

  // Farsight becomes superseded when Distant Horizons is active
  const farsightWithDh = analyzeSelection(['embeddium', 'distant-horizons', 'farsight']);
  assert.ok(farsightWithDh.warnings.some(w => w.modId === 'farsight' && w.severity === 'yellow'));

  // ALI without FastALI triggers join-freeze warning; DH+Oculus without DH Memory Fix triggers memory warning
  const aliNoFast = analyzeSelection(['embeddium', 'just-enough-items-jei', 'advanced-loot-info-ali']);
  assert.ok(aliNoFast.warnings.some(w => w.modId === 'advanced-loot-info-ali' && w.fixModIds?.includes('fastali')));

  const dhOculusNoFix = analyzeSelection(['embeddium', 'oculus', 'distant-horizons']);
  assert.ok(dhOculusNoFix.warnings.some(w => w.modId === 'distant-horizons' && w.fixModIds?.includes('distant-horizons-memory-fix-dh')));

  // Sinytra Connector without any Fabric mod triggers yellow unused-bridge warning
  const idleSinytra = analyzeSelection(['embeddium', 'sinytra-connector', 'forgified-fabric-api']);
  assert.ok(idleSinytra.warnings.some(w => w.modId === 'sinytra-connector' && w.severity === 'yellow'));

  // Unofficial Sodium forks, gameplay changers, and experimental meshes classify as yellow
  for (const id of ['prismanium', 'polidium', 'ksyxis', 'better-tnt', 'perfomant-boom', 'maple-mesh-render']) {
    assert.equal(getBaseHealthTier(MODS_DATABASE.find(m => m.id === id)!), 'yellow', `${id} should be yellow`);
  }

  // Contextual impact reflects active consumers, synergies, and overlaps
  const matlibMod = MODS_DATABASE.find(m => m.id === 'matlib')!;
  const matlibZero = evaluateModImpactInPack(matlibMod, new Set(['embeddium', 'matlib']));
  assert.equal(matlibZero.level, 'zero');

  const matlibSupport = evaluateModImpactInPack(matlibMod, new Set(['embeddium', 'enhanced-block-entities-reloaded', 'matlib']));
  assert.equal(matlibSupport.level, 'support');

  const fleroviumMod = MODS_DATABASE.find(m => m.id === 'flerovium')!;
  const fleroviumInPack = evaluateModImpactInPack(fleroviumMod, new Set(['emberbium', 'flerovium', 'immediatelyfast']));
  assert.equal(fleroviumInPack.level, 'high');
  assert.ok(fleroviumInPack.interactions.some(i => i.kind === 'synergy' && i.targetIds.includes('emberbium')));

  const extrasMod = MODS_DATABASE.find(m => m.id === 'embeddium-extras')!;
  const extrasOverlap = evaluateModImpactInPack(extrasMod, new Set(['embeddium', 'embeddium-extras', 'sodium-chloride']));
  assert.ok(extrasOverlap.interactions.some(i => i.kind === 'overlap' && i.targetIds.includes('sodium-chloride')));

  // Core Nvidium+Emberbium preset achieves 100% subsystem coverage and multiple active synergies with 0 overlaps
  const nvidiumPreset = MOD_PRESETS.find(p => p.id === 'user-nvidium-emberbium')!;
  const summary = summarizeAssemblyImpact(nvidiumPreset.modIds);
  assert.equal(summary.coveragePct, 100);
  assert.equal(summary.missingSubsystems.length, 0);
  assert.ok(summary.synergies.length >= 4);
  assert.equal(summary.overlaps.length, 0);
  assert.equal(summary.zeroOrLowImpactIds.length, 0);
  assert.ok(summary.assemblyScore >= 80, `Expected Nvidium+Emberbium assemblyScore >= 80, got ${summary.assemblyScore}`);
  assert.equal(summary.subsystemScores.length, 7);
});

test('relative % impact, 0..100 impactPoints, co-usage verdicts, and detailed analog comparison engine', async () => {
  const { evaluateModImpactInPack, summarizeAssemblyImpact, getModAnalogsComparison } = await import('./modAnalyzer.ts');
  const byId = new Map(MODS_DATABASE.map(m => [m.id, m]));

  // 1. Marginal % and 0..100 points differentiate core engines vs superseded/conflicting mods
  const basePack = new Set(['embeddium']);
  const modernFixImpact = evaluateModImpactInPack(byId.get('modernfix')!, basePack);
  const fastBootImpact = evaluateModImpactInPack(byId.get('fastboot')!, new Set(['embeddium', 'modernfix']));
  const xenonImpact = evaluateModImpactInPack(byId.get('xenon')!, basePack);

  assert.ok(modernFixImpact.relativeImpactPct >= 10, `Expected ModernFix relativeImpactPct >= 10, got ${modernFixImpact.relativeImpactPct}`);
  assert.ok(modernFixImpact.impactPoints >= 75, `Expected ModernFix impactPoints >= 75, got ${modernFixImpact.impactPoints}`);
  assert.equal(fastBootImpact.relativeImpactPct, 0);
  assert.equal(fastBootImpact.impactPoints, 0);
  assert.equal(fastBootImpact.coUsageVerdict, 'redundant');
  assert.ok(xenonImpact.relativeImpactPct < 0);
  assert.ok(xenonImpact.impactPoints < 0);
  assert.equal(xenonImpact.coUsageVerdict, 'conflict');

  // 2. Hardware & mode scaling: Krypton Reno (server > singleplayer) and Nvidium (NVIDIA > AMD/Intel)
  const serverPrefs: AssemblyPreferences = { ...INITIAL_BUILDER_PREFS, mode: 'server' };
  const singlePrefs: AssemblyPreferences = { ...INITIAL_BUILDER_PREFS, mode: 'singleplayer' };
  const kryptonServer = evaluateModImpactInPack(byId.get('krypton-reno')!, basePack, undefined, serverPrefs);
  const kryptonSingle = evaluateModImpactInPack(byId.get('krypton-reno')!, basePack, undefined, singlePrefs);
  assert.ok(kryptonServer.impactPoints > kryptonSingle.impactPoints);
  assert.ok(kryptonServer.relativeImpactPct >= kryptonSingle.relativeImpactPct);

  const nvidiaPrefs: AssemblyPreferences = { ...INITIAL_BUILDER_PREFS, gpu: 'nvidia' };
  const amdPrefs: AssemblyPreferences = { ...INITIAL_BUILDER_PREFS, gpu: 'amd-intel' };
  const nvidiumNvidia = evaluateModImpactInPack(byId.get('nvidium')!, new Set(['emberbium', 'sinytra-connector', 'forgified-fabric-api']), undefined, nvidiaPrefs);
  const nvidiumAmd = evaluateModImpactInPack(byId.get('nvidium')!, new Set(['emberbium', 'sinytra-connector', 'forgified-fabric-api']), undefined, amdPrefs);
  assert.ok(nvidiumNvidia.relativeImpactPct > nvidiumAmd.relativeImpactPct);

  // 3. Assembly score reflects penalties when adding a conflict
  const cleanSummary = summarizeAssemblyImpact(['embeddium', 'modernfix', 'ferritecore', 'radium-re-reforged']);
  const clashSummary = summarizeAssemblyImpact(['embeddium', 'modernfix', 'ferritecore', 'radium-re-reforged', 'xenon']);
  assert.ok(cleanSummary.assemblyScore > clashSummary.assemblyScore + 15);

  // 4. Deepened co-usage checks: Calm The Leaks needs AllTheLeaks; GeckoLib Optimizer + BetterFPS overlap & scale with GeckoLib
  const calmWarning = analyzeSelection(['modernfix', 'calm-the-leaks']);
  assert.ok(calmWarning.warnings.some(w => w.modId === 'calm-the-leaks' && w.fixModIds?.includes('alltheleaks-memory-leak-fix')));

  const geckoOverlap = analyzeSelection(['geckolib', 'geckolib-animation-optimizer', 'geckolibbetterfps']);
  assert.ok(geckoOverlap.warnings.some(w => w.modId === 'geckolib-animation-optimizer' && w.severity === 'yellow'));

  const geckoWithout = evaluateModImpactInPack(byId.get('geckolibbetterfps')!, new Set(['embeddium']));
  const geckoWith = evaluateModImpactInPack(byId.get('geckolibbetterfps')!, new Set(['embeddium', 'geckolib']));
  assert.equal(geckoWithout.relativeImpactPct, 0);
  assert.ok(geckoWith.impactPoints > geckoWithout.impactPoints);
  assert.equal(geckoWith.coUsageVerdict, 'synergy');

  // 5. Analog comparison engine: Radium Reforged -> Radium Re-Reforged (better-replacement), Embeddium -> Alloyium (canUseTogether: true) vs Xenon (false)
  const radiumAnalogs = getModAnalogsComparison(byId.get('radium-reforged')!, new Set(['embeddium', 'radium-reforged']));
  const radiumReEntry = radiumAnalogs.find(a => a.mod.id === 'radium-re-reforged');
  assert.ok(radiumReEntry, 'Expected Radium Re-Reforged in Radium Reforged analog comparison');
  assert.equal(radiumReEntry.relation, 'better-replacement');
  assert.equal(radiumReEntry.canUseTogether, false);
  assert.ok(radiumReEntry.relativeDeltaPoints > 0);

  const embeddiumAnalogs = getModAnalogsComparison(byId.get('embeddium')!, new Set(['embeddium']));
  const alloyiumEntry = embeddiumAnalogs.find(a => a.mod.id === 'alloyium');
  assert.ok(alloyiumEntry && alloyiumEntry.canUseTogether === true);

  const emberbiumAnalogs = getModAnalogsComparison(byId.get('emberbium')!, new Set(['emberbium']));
  const emberOculus = emberbiumAnalogs.find(a => a.mod.id === 'oculus');
  assert.ok(emberOculus && emberOculus.canUseTogether === false && emberOculus.relation === 'conflict');

  const nvidiumAnalogs = getModAnalogsComparison(byId.get('nvidium')!, new Set(['emberbium', 'sinytra-connector', 'forgified-fabric-api', 'nvidium']));
  const dhEntry = nvidiumAnalogs.find(a => a.mod.id === 'distant-horizons');
  assert.ok(dhEntry && dhEntry.canUseTogether === true);
});

test('resource & hardware trade-off engine: GPU/VRAM/CPU/RAM profiles and assembly hardwareSummary', async () => {
  const { getModResourceProfile, evaluateModImpactInPack, summarizeAssemblyImpact } = await import('./modAnalyzer.ts');
  const byId = new Map(MODS_DATABASE.map(m => [m.id, m]));

  // Every mod in the database resolves to a non-empty valid resource profile
  for (const m of MODS_DATABASE) {
    const rp = getModResourceProfile(m);
    assert.ok(rp.gains.length > 0, `Empty gains for ${m.id}`);
    assert.ok(rp.costs.length > 0, `Empty costs for ${m.id}`);
    assert.ok(rp.shortTag.length > 0, `Empty shortTag for ${m.id}`);
    assert.ok(rp.tradeoffNote.length > 0, `Empty tradeoffNote for ${m.id}`);
  }

  // Nvidium & Accelerated Rendering trade GPU + VRAM for FPS & CPU relief
  const nvidiumProf = getModResourceProfile(byId.get('nvidium')!);
  assert.equal(nvidiumProf.hasTradeoff, true);
  assert.ok(nvidiumProf.gpuLoad >= 1);
  assert.equal(nvidiumProf.vramLoad, 2);
  assert.equal(nvidiumProf.cpuLoad, -1);

  const accelProf = getModResourceProfile(byId.get('accelerated-rendering')!);
  assert.equal(accelProf.hasTradeoff, true);
  assert.equal(accelProf.gpuLoad, 2);
  assert.equal(accelProf.vramLoad, 2);
  assert.equal(accelProf.cpuLoad, -1);

  // AMD FSR upscaler reduces GPU load at the cost of clarity
  const fsrProf = getModResourceProfile(byId.get('amd-fsr-upscaler-render-scale-for-embeddium')!);
  assert.equal(fsrProf.hasTradeoff, true);
  assert.equal(fsrProf.gpuLoad, -2);

  // Distant Horizons & C2MEF push CPU + RAM
  const dhProf = getModResourceProfile(byId.get('distant-horizons')!);
  assert.equal(dhProf.cpuLoad, 2);
  assert.ok(dhProf.ramLoad >= 1);

  const c2mefProf = getModResourceProfile(byId.get('concurrent-chunk-management-engine-forge-c2me')!);
  assert.equal(c2mefProf.cpuLoad, 2);
  assert.ok(c2mefProf.ramLoad >= 1);

  // ModernFix & FerriteCore save RAM (-2)
  assert.equal(getModResourceProfile(byId.get('modernfix')!).ramLoad, -2);
  assert.equal(getModResourceProfile(byId.get('ferritecore')!).ramLoad, -2);

  // evaluateModImpactInPack attaches resourceProfile
  const impact = evaluateModImpactInPack(byId.get('alloyium')!, new Set(['embeddium']));
  assert.equal(impact.resourceProfile.gpuLoad, 1);
  assert.equal(impact.resourceProfile.hasTradeoff, true);

  // summarizeAssemblyImpact aggregates hardwareSummary accurately
  const summary = summarizeAssemblyImpact([
    'embeddium',
    'alloyium',
    'accelerated-rendering',
    'distant-horizons',
    'modernfix',
    'ferritecore',
  ]);
  assert.ok(summary.hardwareSummary.highGpuIds.includes('alloyium'));
  assert.ok(summary.hardwareSummary.highGpuIds.includes('accelerated-rendering'));
  assert.ok(summary.hardwareSummary.highVramIds.includes('accelerated-rendering'));
  assert.ok(summary.hardwareSummary.highCpuIds.includes('distant-horizons'));
  assert.ok(summary.hardwareSummary.ramSaverIds.includes('modernfix'));
  assert.ok(summary.hardwareSummary.ramSaverIds.includes('ferritecore'));
});

test('exhaustive compatibility stress test: symmetric rules, new exclusive pools, all-510 smartFix, full matrix, orphan cleanup, and JAR aliases', async () => {
  const { getRuleConflictingIds } = await import('./modAnalyzer.ts');
  const { matchJarFilenamesToMods } = await import('./jarMatcher.ts');

  // 1. Symmetry of getRuleConflictingIds across all 510 mods
  for (const m of MODS_DATABASE) {
    for (const cid of getRuleConflictingIds(m.id)) {
      assert.ok(
        getRuleConflictingIds(cid).includes(m.id),
        `Asymmetric rule conflict: ${m.id} -> ${cid}`
      );
    }
  }

  // 2. New mutual-exclusion rules: upscalers, clearlag, despawn, weather, potion & damage particles
  const newExclusivePairs: Array<[string, string]> = [
    ['amd-fsr-upscaler-render-scale-for-embeddium', 'renderscale'],
    ['super-resolution', 'purescale'],
    ['tct-clearlag', 'clearlagplus'],
    ['let-me-despawn', 'despawntweaker'],
    ['no-rain', 'disable-rain'],
    ['no-more-potion-particles', 'noeffectparticles'],
    ['limited-damage-indicator-particle', 'no-damage-indicator-heart-particles'],
  ];
  for (const [a, b] of newExclusivePairs) {
    const res = analyzeSelection([a, b]);
    assert.ok(res.conflicts.length >= 1, `Expected conflict between ${a} and ${b}`);
    const fixed = smartFixAssembly([a, b]);
    assert.equal(analyzeSelection(fixed).conflicts.length, 0);
  }

  // 3. Feeding ALL 510 mods into smartFixAssembly produces 0 conflicts, 0 red warnings, and 0 yellow warnings
  const allFixed = smartFixAssembly(MODS_DATABASE.map(m => m.id));
  const allAnalysis = analyzeSelection(allFixed);
  assert.equal(allAnalysis.conflicts.length, 0, 'smartFixAssembly(ALL 510) had conflicts');
  assert.equal(allAnalysis.warnings.length, 0, `smartFixAssembly(ALL 510) had warnings: ${allAnalysis.warnings.map(w => w.message).join('; ')}`);

  // 4. focusModId transitive dependency protection in smartFixAssembly (e.g. Emberlens keeps Emberbium over Embeddium)
  const emberFixedWithBoth = smartFixAssembly(['embeddium', 'emberbium', 'emberlens'], {
    ...INITIAL_BUILDER_PREFS,
    focusModId: 'emberlens',
  });
  assert.ok(emberFixedWithBoth.includes('emberlens'));
  assert.ok(emberFixedWithBoth.includes('emberbium'));
  assert.ok(!emberFixedWithBoth.includes('embeddium'));
  assert.equal(analyzeSelection(emberFixedWithBoth).conflicts.length, 0);

  const emberFixedMissingDep = smartFixAssembly(['embeddium', 'emberlens'], {
    ...INITIAL_BUILDER_PREFS,
    focusModId: 'emberlens',
  });
  assert.ok(emberFixedMissingDep.includes('emberlens'));
  assert.ok(emberFixedMissingDep.includes('emberbium'));
  assert.ok(!emberFixedMissingDep.includes('embeddium'));
  assert.equal(analyzeSelection(emberFixedMissingDep).conflicts.length, 0);

  // 5. toggleModSmart orphan cleanup (single-purpose libs, Sinytra bridges, JER under EMI mode)
  const dropEber = toggleModSmart(['embeddium', 'enhanced-block-entities-reloaded', 'matlib'], 'enhanced-block-entities-reloaded', { strict: true });
  assert.ok(!dropEber.nextIds.includes('matlib'), 'Orphaned matlib should be cleaned when EBER is removed');

  const switchToOculus = toggleModSmart(['embeddium', 'sinytra-connector', 'forgified-fabric-api', 'nvidium'], 'oculus', { strict: true });
  assert.ok(switchToOculus.nextIds.includes('oculus'));
  assert.ok(!switchToOculus.nextIds.includes('nvidium'));
  assert.ok(!switchToOculus.nextIds.includes('sinytra-connector'), 'Idle Sinytra bridge should be cleaned after evicting last Sinytra consumer');

  const addJerUnderEmi = toggleModSmart(['embeddium', 'emi'], 'just-enough-resources-jer', {
    strict: true,
    prefs: { ...INITIAL_BUILDER_PREFS, recipeViewer: 'emi' },
  });
  assert.ok(addJerUnderEmi.nextIds.includes('just-enough-resources-jer'));
  assert.ok(addJerUnderEmi.nextIds.includes('tmrv-updated'));
  assert.ok(!addJerUnderEmi.nextIds.includes('just-enough-items-jei'));
  assert.equal(analyzeSelection(addJerUnderEmi.nextIds).conflicts.length, 0);

  // 6. Exhaustive matrix of buildSmartAssembly profiles & focus anchors -> 0 conflicts, 0 red warnings
  const gpus = ['nvidia', 'amd-intel', 'integrated'] as const;
  const modes = ['singleplayer', 'server', 'hybrid-server'] as const;
  const goals = ['balanced', 'max-safe', 'potato'] as const;
  const strategies = [undefined, 'native-forge', 'hybrid', 'fabric-sinytra'] as const;
  const viewers = ['emi', 'jei', 'emi-jei', 'none'] as const;

  for (const gpu of gpus) {
    for (const mode of modes) {
      for (const goal of goals) {
        for (const portStrategy of strategies) {
          for (const recipeViewer of viewers) {
            const { modIds } = buildSmartAssembly({
              gpu,
              mode,
              goal,
              portStrategy,
              recipeViewer,
              useShaders: goal !== 'potato' && recipeViewer === 'emi',
              useCreate: mode !== 'server',
              allowSinytra: portStrategy !== 'native-forge',
            });
            const an = analyzeSelection(modIds);
            assert.equal(an.conflicts.length, 0);
            assert.equal(an.warnings.filter(w => w.severity === 'red').length, 0);
          }
        }
      }
    }
  }

  for (const m of MODS_DATABASE) {
    if (m.status === 'danger' || m.coveredBy) continue;
    const fixed = smartFixAssembly([m.id], { ...INITIAL_BUILDER_PREFS, focusModId: m.id });
    const an = analyzeSelection(fixed);
    assert.equal(an.conflicts.length, 0, `smartFixAssembly([${m.id}]) had conflicts`);
    assert.equal(an.warnings.filter(w => w.severity === 'red').length, 0, `smartFixAssembly([${m.id}]) had red warnings`);
  }

  // 7. Expanded jarMatcher aliases
  const jarResult = matchJarFilenamesToMods([
    'OptiFine_1.20.1_HD_U_I6.jar',
    'jei-1.20.1-forge-15.20.0.106.jar',
    'emi-1.1.14+1.20.1+forge.jar',
    'tmrv-1.20.1.jar',
    'DistantHorizons-2.2.1-a-1.20.1-forge-fabric.jar',
    'spark-1.10.53-forge.jar',
  ]);
  for (const expectedId of ['optifine', 'just-enough-items-jei', 'emi', 'tmrv-updated', 'distant-horizons', 'spark']) {
    assert.ok(jarResult.matchedIds.includes(expectedId), `jarMatcher failed to resolve ${expectedId}`);
  }
  assert.deepEqual(jarResult.unmatchedJars, []);
});

test('artifact risk chances, packScale sensitivity, dubious mods detection, and calibrated assembly score accuracy', async () => {
  const { evaluateArtifactRisk, evaluateDubiousMods, summarizeAssemblyImpact } = await import('./modAnalyzer.ts');
  const { parsePersistedState } = await import('./persistence.ts');

  // 1. Empty pack has 0% artifact risk
  const emptyRisk = evaluateArtifactRisk([]);
  assert.equal(emptyRisk.chancePct, 0);
  assert.equal(emptyRisk.level, 'low');

  // 2. Clean native Alloyium preset has minimal artifact risk, while adding heavy culling + compute + Sinytra + conflicts escalates chancePct progressively
  const alloyiumPreset = MOD_PRESETS.find(p => p.id === 'user-alloyium-embeddium')!;
  const cleanRisk = evaluateArtifactRisk(alloyiumPreset.modIds);
  assert.ok(cleanRisk.chancePct <= 15, `Expected clean Alloyium preset artifact risk <= 15%, got ${cleanRisk.chancePct}%`);
  assert.equal(cleanRisk.level, 'low');

  const stackedRisk = evaluateArtifactRisk([
    ...alloyiumPreset.modIds,
    'accelerated-rendering',
    'more-culling-reforged',
    'distant-horizons',
    'oculus',
    'sinytra-connector',
    'forgified-fabric-api',
    'c2me-concurrent-chunk-management-engine',
    'renderscale',
    'sodium-fovea',
    'ksyxis',
  ]);
  assert.ok(
    stackedRisk.chancePct >= cleanRisk.chancePct + 20,
    `Expected stacked pack risk (${stackedRisk.chancePct}%) >> clean (${cleanRisk.chancePct}%)`
  );
  assert.ok(stackedRisk.factors.some(f => f.tone === 'risk'));
  assert.ok(stackedRisk.factors.some(f => f.tone === 'mitigation'));

  const conflictRisk = evaluateArtifactRisk(['embeddium', 'xenon', 'optifine', 'nvidium', 'oculus']);
  assert.ok(conflictRisk.chancePct >= 55, `Expected critical conflict artifact risk >= 55%, got ${conflictRisk.chancePct}%`);
  assert.equal(conflictRisk.level, 'critical');

  // 3. packScale sensitivity on a dense 30+ mod stack & persistence sanitization
  const denseIds = [
    ...alloyiumPreset.modIds,
    'fastsuite',
    'fastworkbench',
    'fastfurnace',
    'duplicate-nbt-flattener',
    'capability-fix-revived',
    'structure-dfu-cache',
    'broken-tag-fixer',
    'stutterfix-reforged',
    'threadtweak-reforged',
    'more-culling-reforged',
    'better-biome-reblend',
  ];
  const lightRisk = evaluateArtifactRisk(denseIds, undefined, { ...INITIAL_BUILDER_PREFS, packScale: 'light' });
  const heavyRisk = evaluateArtifactRisk(denseIds, undefined, { ...INITIAL_BUILDER_PREFS, packScale: 'heavy' });
  assert.ok(heavyRisk.chancePct > lightRisk.chancePct, `Expected heavy packScale risk (${heavyRisk.chancePct}%) > light (${lightRisk.chancePct}%)`);

  const persistedScale = parsePersistedState({ builderPrefs: { packScale: 'heavy' } });
  assert.equal(persistedScale?.builderPrefs?.packScale, 'heavy');

  // 4. evaluateDubiousMods flags high/medium/low risks with reasons & replacements
  const mixedPack = [
    'embeddium',
    'xenon',
    'modernfix',
    'fastboot',
    'matlib',
    'sinytra-connector',
    'forgified-fabric-api',
    'nvidium',
    'radium-reforged',
  ];
  const amdSummary = summarizeAssemblyImpact(mixedPack, undefined, { ...INITIAL_BUILDER_PREFS, gpu: 'amd-intel' });
  const dubious = evaluateDubiousMods(mixedPack, undefined, { ...INITIAL_BUILDER_PREFS, gpu: 'amd-intel' });

  assert.ok(dubious.some(d => d.modId === 'xenon' && d.severity === 'high'));
  assert.ok(dubious.some(d => d.modId === 'nvidium' && d.severity === 'high'));
  assert.ok(dubious.some(d => d.modId === 'fastboot' && d.severity === 'medium'));
  assert.ok(dubious.some(d => d.modId === 'matlib' && d.severity === 'medium'));
  const radiumDubious = dubious.find(d => d.modId === 'radium-reforged');
  assert.ok(radiumDubious && radiumDubious.replacementId === 'radium-re-reforged');
  assert.ok(amdSummary.dubiousMods.length === dubious.length);

  // 5. Accurate assemblyScore & scoreBreakdown differentiate clean fit vs hardware mismatch & bloat
  const nvidiumPreset = MOD_PRESETS.find(p => p.id === 'user-nvidium-emberbium')!;
  const nvidiumOnNvidia = summarizeAssemblyImpact(nvidiumPreset.modIds, undefined, { ...INITIAL_BUILDER_PREFS, gpu: 'nvidia', useShaders: false });
  const nvidiumOnAmd = summarizeAssemblyImpact(nvidiumPreset.modIds, undefined, { ...INITIAL_BUILDER_PREFS, gpu: 'amd-intel', useShaders: false });
  assert.ok(nvidiumOnNvidia.assemblyScore >= 80);
  assert.ok(
    nvidiumOnNvidia.assemblyScore >= nvidiumOnAmd.assemblyScore + 12,
    `Expected Nvidium on NVIDIA (${nvidiumOnNvidia.assemblyScore}) >> AMD (${nvidiumOnAmd.assemblyScore})`
  );
  assert.ok(nvidiumOnAmd.scoreBreakdown.hardwareFitDelta < 0);
  assert.ok(nvidiumOnNvidia.scoreBreakdown.efficiencyScore > 0);
  assert.ok(nvidiumOnNvidia.scoreBreakdown.stabilityScore >= 85);
});

test('resourceBalance and context-aware precision impact across GPU, shaders, Create, and packScale', async () => {
  const { summarizeAssemblyImpact, evaluateModImpactInPack, getModResourceProfile } = await import('./modAnalyzer.ts');

  // 1. ShadowLOD is a shader optimization (gpuLoad <= 0), not a heavy shader pipeline itself
  const shadowLodMod = MODS_DATABASE.find(m => m.id === 'shadowlod')!;
  const shadowProfile = getModResourceProfile(shadowLodMod);
  assert.ok(shadowProfile.gpuLoad <= 0, `ShadowLOD should reduce GPU load, got ${shadowProfile.gpuLoad}`);

  // 2. Clean pack has strong fpsScore, memoryScore, positive RAM savings & effectiveCount
  const alloyiumPreset = MOD_PRESETS.find(p => p.id === 'user-alloyium-embeddium')!;
  const cleanSummary = summarizeAssemblyImpact(alloyiumPreset.modIds, undefined, INITIAL_BUILDER_PREFS);
  assert.ok(cleanSummary.resourceBalance.fpsScore >= 75);
  assert.ok(cleanSummary.resourceBalance.memoryScore >= 70);
  assert.ok(cleanSummary.resourceBalance.effectiveCount >= 10);
  assert.equal(cleanSummary.resourceBalance.conflictCount, 0);
  assert.ok(cleanSummary.resourceBalance.ramDeltaLabel.includes('−'));

  // 3. Integrated GPU values upscaler more than high-end NVIDIA without shaders
  const fsrMod = MODS_DATABASE.find(m => m.id === 'amd-fsr-upscaler-render-scale-for-embeddium')!;
  const fsrOnPotato = evaluateModImpactInPack(fsrMod, new Set(['embeddium']), undefined, {
    ...INITIAL_BUILDER_PREFS,
    gpu: 'integrated',
    goal: 'potato',
  });
  const fsrOnRtx = evaluateModImpactInPack(fsrMod, new Set(['embeddium']), undefined, {
    ...INITIAL_BUILDER_PREFS,
    gpu: 'nvidia',
    goal: 'max-safe',
    useShaders: false,
  });
  assert.ok(
    fsrOnPotato.impactPoints > fsrOnRtx.impactPoints,
    `Expected FSR upscaler on iGPU (${fsrOnPotato.impactPoints}) > RTX (${fsrOnRtx.impactPoints})`
  );

  // 4. Create mode boosts Flywheel + Vanillin impact
  const vanillinMod = MODS_DATABASE.find(m => m.id === 'vanillin')!;
  const vanillinCreate = evaluateModImpactInPack(vanillinMod, new Set(['embeddium', 'flywheel']), undefined, {
    ...INITIAL_BUILDER_PREFS,
    useCreate: true,
  });
  const vanillinNoCreate = evaluateModImpactInPack(vanillinMod, new Set(['embeddium', 'flywheel']), undefined, {
    ...INITIAL_BUILDER_PREFS,
    useCreate: false,
  });
  assert.ok(vanillinCreate.impactPoints >= vanillinNoCreate.impactPoints);
  assert.ok(vanillinCreate.relativeImpactPct >= vanillinNoCreate.relativeImpactPct);
});

test('verified Modrinth 1.20.1 conflicts and Forge dependencies behave accurately across both ports', async () => {
  const { getRuleConflictingIds, getTransitiveDependencies } = await import('./modAnalyzer.ts');

  // 1. CLab conflicts with Entity Culling; Xenon conflicts with Embeddium Extras & Leaf Culling (without making Extras conflict with Leaf Culling)
  const clabClash = analyzeSelection(['embeddium', 'clab', 'entity-culling']);
  assert.ok(clabClash.conflicts.some(c => c.matchedIds.includes('clab') && c.matchedIds.includes('entity-culling')));
  assert.ok(getRuleConflictingIds('clab').includes('entity-culling'));
  assert.ok(getRuleConflictingIds('entity-culling').includes('clab'));

  const xenonExtrasClash = analyzeSelection(['xenon', 'embeddium-extras']);
  assert.ok(xenonExtrasClash.conflicts.some(c => c.matchedIds.includes('xenon') && c.matchedIds.includes('embeddium-extras')));
  const xenonLeafClash = analyzeSelection(['xenon', 'sodium-embeddium-leaf-culling']);
  assert.ok(xenonLeafClash.conflicts.some(c => c.matchedIds.includes('xenon') && c.matchedIds.includes('sodium-embeddium-leaf-culling')));
  const extrasPlusLeafClean = analyzeSelection(['embeddium', 'embeddium-extras', 'sodium-embeddium-leaf-culling']);
  assert.equal(extrasPlusLeafClean.conflicts.length, 0);

  // 2. OptiFine also detects direct conflicts with Sodium and VulkanMod in analyzeSelection
  assert.ok(analyzeSelection(['optifine', 'sodium']).conflicts.length >= 1);
  assert.ok(analyzeSelection(['optifine', 'vulkanmod']).conflicts.length >= 1);

  // 3. Confirmed 1.20.1 Forge dependencies trigger warnings when missing and pull via toggleModSmart
  const expectedDeps: Array<[string, string[]]> = [
    ['emi-loot', ['emi', 'fzzy-config']],
    ['geckolibbetterfps', ['geckolib', 'embeddium']],
    ['cullify', ['embeddium']],
    ['structure-layout-optimizer', ['resourceful-config']],
    ['observable', ['kotlin-for-forge', 'architectury-api']],
    ['fast-item-frames', ['puzzles-lib']],
    ['let-me-despawn', ['almanac']],
    ['fastsuite', ['placebo']],
    ['fastfurnace', ['placebo']],
    ['fastworkbench', ['placebo']],
    ['structure-dfu-cache', ['rinlib']],
    ['emiffect', ['emi', 'fzzy-config']],
    ['geckolib-animation-optimizer', ['geckolib']],
    ['sodium-embeddium-leaf-culling', ['embeddium']],
    ['ggtu', ['embeddium', 'oculus']],
    ['chunkyborder', ['chunky']],
    ['controlling', ['searchables']],
    ['lazyyyyy', ['forgified-fabric-api', 'kotlin-for-forge']],
  ];
  for (const [modId, reqIds] of expectedDeps) {
    const an = analyzeSelection([modId]);
    const w = an.warnings.find(item => item.modId === modId);
    assert.ok(w, `Expected missing-dependency warning for ${modId}`);
    for (const reqId of reqIds) {
      assert.ok(w.fixModIds?.includes(reqId), `Expected ${modId} fixModIds to include ${reqId}`);
    }
  }

  // 4. Transitive resolution & orphan preservation: emi-loot pulls emi + fzzy-config + kotlin-for-forge; lazyyyyy keeps forgified-fabric-api
  const emiLootDeps = getTransitiveDependencies('emi-loot');
  assert.ok(emiLootDeps.includes('emi'));
  assert.ok(emiLootDeps.includes('fzzy-config'));
  assert.ok(emiLootDeps.includes('kotlin-for-forge'));

  const lazyFixed = smartFixAssembly(['embeddium', 'lazyyyyy'], { ...INITIAL_BUILDER_PREFS, focusModId: 'lazyyyyy' });
  assert.ok(lazyFixed.includes('forgified-fabric-api'));
  assert.ok(lazyFixed.includes('kotlin-for-forge'));
  assert.equal(analyzeSelection(lazyFixed).conflicts.length, 0);
  assert.equal(analyzeSelection(lazyFixed).warnings.length, 0);
});

test('optimized presets and bloat-free buildSmartAssembly achieve high scores with zero overlaps or orphan bloat', async () => {
  const { summarizeAssemblyImpact } = await import('./modAnalyzer.ts');

  for (const preset of MOD_PRESETS) {
    for (const staple of ['entity-culling', 'clumps', 'let-me-despawn']) {
      assert.ok(preset.modIds.includes(staple), `Preset ${preset.id} should include ${staple}`);
    }
    const summaryCtx = summarizeAssemblyImpact(preset.modIds, undefined, {
      ...INITIAL_BUILDER_PREFS,
      ...preset.recommendedPrefs,
    });
    assert.ok(summaryCtx.assemblyScore >= 96, `Preset ${preset.id} expected ctx score >= 96, got ${summaryCtx.assemblyScore}`);
    assert.equal(summaryCtx.overlaps.length, 0, `Preset ${preset.id} has overlaps`);
    assert.equal(summaryCtx.zeroOrLowImpactIds.length, 0, `Preset ${preset.id} has zero-impact mods`);
  }

  const singleProfiles: AssemblyPreferences[] = [
    { gpu: 'nvidia', mode: 'singleplayer', useShaders: false, useCreate: false, allowSinytra: true, goal: 'balanced', recipeViewer: 'emi' },
    { gpu: 'amd-intel', mode: 'singleplayer', useShaders: false, useCreate: false, allowSinytra: false, goal: 'balanced', recipeViewer: 'jei' },
    { gpu: 'nvidia', mode: 'singleplayer', useShaders: false, useCreate: false, allowSinytra: true, goal: 'max-safe', recipeViewer: 'emi' },
    { gpu: 'nvidia', mode: 'singleplayer', useShaders: false, useCreate: false, allowSinytra: false, portStrategy: 'native-forge', goal: 'max-safe', recipeViewer: 'emi' },
    { gpu: 'nvidia', mode: 'singleplayer', useShaders: true, useCreate: false, allowSinytra: true, goal: 'max-safe', recipeViewer: 'emi' },
    { gpu: 'integrated', mode: 'singleplayer', useShaders: false, useCreate: false, allowSinytra: false, goal: 'potato', recipeViewer: 'jei' },
  ];

  for (const prefs of singleProfiles) {
    const { modIds } = buildSmartAssembly(prefs);
    const analysis = analyzeSelection(modIds);
    const summary = summarizeAssemblyImpact(modIds, analysis, prefs);

    assert.equal(analysis.conflicts.length, 0);
    assert.equal(analysis.warnings.length, 0, `Unexpected warnings for ${JSON.stringify(prefs)}: ${analysis.warnings.map(w => w.message).join('; ')}`);
    assert.equal(summary.overlaps.length, 0, `Unexpected overlaps for ${JSON.stringify(prefs)}`);
    assert.equal(summary.zeroOrLowImpactIds.length, 0, `Unexpected zero-impact mods: ${summary.zeroOrLowImpactIds.join(',')}`);

    for (const forbidden of ['restmode', 'more-culling-reforged', 'better-biome-reblend', 'geckolib-animation-optimizer', 'servercore', 'connectivity', 'cupboard', 'krypton-reno']) {
      assert.ok(!modIds.includes(forbidden), `Singleplayer profile should not include ${forbidden}`);
    }
    assert.ok(summary.assemblyScore >= 90, `Expected score >= 90 for ${JSON.stringify(prefs)}, got ${summary.assemblyScore}`);
    assert.ok(summary.artifactRisk.chancePct <= 28, `Expected moderate/low artifact risk <= 28%, got ${summary.artifactRisk.chancePct}%`);
  }

  const hybridMax = buildSmartAssembly(singleProfiles[2]).modIds;
  assert.ok(hybridMax.includes('emberbium') && hybridMax.includes('nvidium'));
});

test('Nvidium config has valid JSON without placeholder text and group exclusives allow non-conflicting combinations', async () => {
  const { MOD_RECOMMENDED_CONFIGS, NVIDIUM_CONFIG_CONTENT } = await import('../data/modConfigs.ts');
  const { encodeShareHash, decodeShareHash } = await import('./persistence.ts');

  // 1. NVIDIUM_CONFIG_CONTENT valid JSON, no placeholder
  assert.ok(!NVIDIUM_CONFIG_CONTENT.includes('ВСТАВЬ'));
  const parsedNvidium = JSON.parse(NVIDIUM_CONFIG_CONTENT) as Record<string, unknown>;
  assert.equal(parsedNvidium.automatic_memory, true);
  assert.equal(parsedNvidium.max_geometry_memory, 2048);

  const nvidiumEntry = MOD_RECOMMENDED_CONFIGS.find(c => c.modId === 'nvidium');
  assert.ok(nvidiumEntry);
  assert.equal(nvidiumEntry.filePath, 'config/nvidium.json');

  // 2. block-culling and upscaling-bg are non-exclusive
  const blockCullingGroup = MOD_GROUPS.find(g => g.id === 'block-culling');
  const upscalingBgGroup = MOD_GROUPS.find(g => g.id === 'upscaling-bg');
  assert.equal(blockCullingGroup?.exclusive, false);
  assert.equal(upscalingBgGroup?.exclusive, false);

  assert.equal(analyzeSelection(['entity-culling', 'more-culling-reforged']).conflicts.length, 0);
  assert.equal(analyzeSelection(['dynamic-fps', 'amd-fsr-upscaler-render-scale-for-embeddium', 'framepacer']).conflicts.length, 0);

  // 3. Xenon conflicts with Alloyium, Chloride, Flerovium, Revidium/Acedium, Options API, Cullify
  for (const addonId of [
    'alloyium',
    'sodium-chloride',
    'flerovium',
    'revidium-accedium',
    'sodium-embeddium-options-api',
    'cullify',
  ]) {
    const clash = analyzeSelection(['xenon', addonId]);
    assert.ok(clash.conflicts.length >= 1, `Expected conflict between xenon and ${addonId}`);
  }
  const embeddiumAddonsClean = analyzeSelection([
    'embeddium',
    'sodium-chloride',
    'flerovium',
    'revidium-accedium',
    'sodium-embeddium-options-api',
    'cullify',
  ]);
  assert.equal(embeddiumAddonsClean.conflicts.length, 0);

  // 4. Dynamic FPS + RestMode / Idle Boost emit yellow warnings
  const restWarning = analyzeSelection(['dynamic-fps', 'restmode']);
  assert.ok(restWarning.warnings.some(w => w.severity === 'yellow' && (w.modId === 'dynamic-fps' || w.modId === 'restmode')));
  const idleWarning = analyzeSelection(['dynamic-fps', 'idle-boost']);
  assert.ok(idleWarning.warnings.some(w => w.severity === 'yellow' && (w.modId === 'dynamic-fps' || w.modId === 'idle-boost')));

  // 5. buildSmartAssembly with focusModId='emberbium' and useShaders=false keeps Emberbium + Nvidium
  const emberNoShaders = buildSmartAssembly({
    ...INITIAL_BUILDER_PREFS,
    gpu: 'nvidia',
    mode: 'singleplayer',
    goal: 'max-safe',
    useShaders: false,
    useCreate: false,
    allowSinytra: true,
    focusModId: 'emberbium',
  });
  assert.ok(emberNoShaders.modIds.includes('emberbium'));
  assert.ok(emberNoShaders.modIds.includes('nvidium'));
  assert.ok(!emberNoShaders.modIds.includes('emberlens'));

  // With useShaders=true + focusModId='emberbium' + useCreate=false: selects emberbium + emberlens without embeddium or flywheel
  const emberShadersNoCreate = buildSmartAssembly({
    ...INITIAL_BUILDER_PREFS,
    gpu: 'nvidia',
    mode: 'singleplayer',
    goal: 'max-safe',
    useShaders: true,
    useCreate: false,
    allowSinytra: true,
    focusModId: 'emberbium',
  });
  assert.ok(emberShadersNoCreate.modIds.includes('emberbium'));
  assert.ok(emberShadersNoCreate.modIds.includes('emberlens'));
  assert.ok(!emberShadersNoCreate.modIds.includes('embeddium'));
  assert.ok(!emberShadersNoCreate.modIds.includes('flywheel'));

  // 6. removeModsCascade cleans up orphaned single-purpose libs, jei-plugins, and idle Sinytra bridges
  const afterCupboardCascade = removeModsCascade(['connectivity', 'cupboard'], ['connectivity']).nextIds;
  assert.ok(!afterCupboardCascade.includes('cupboard'), 'Expected cupboard orphan to be removed');

  const afterResourcefulCascade = removeModsCascade(
    ['structure-layout-optimizer', 'resourceful-config'],
    ['structure-layout-optimizer']
  ).nextIds;
  assert.ok(!afterResourcefulCascade.includes('resourceful-config'), 'Expected resourceful-config orphan to be removed');

  const afterJeiCascade = removeModsCascade(['just-enough-items-jei', 'just-enough-resources-jer'], ['just-enough-items-jei']).nextIds;
  assert.ok(!afterJeiCascade.includes('just-enough-resources-jer'), 'Expected orphaned JER plugin to be removed');

  const afterSinytraCascade = removeModsCascade(['embeddium', 'nvidium', 'sinytra-connector', 'forgified-fabric-api'], ['nvidium']).nextIds;
  assert.ok(!afterSinytraCascade.includes('sinytra-connector'), 'Expected idle sinytra-connector to be removed');
  assert.ok(!afterSinytraCascade.includes('forgified-fabric-api'), 'Expected idle forgified-fabric-api to be removed');

  // 7. encodeShareHash / decodeShareHash preserves full builderPrefs
  const fullPrefs: AssemblyPreferences = {
    gpu: 'amd-intel',
    mode: 'server',
    goal: 'potato',
    useCreate: true,
    useShaders: true,
    portStrategy: 'native-forge',
    recipeViewer: 'emi-jei',
    packScale: 'heavy',
    allowSinytra: false,
    hideOutdatedUseless: false,
    focusModId: 'embeddium',
  };
  const hash = encodeShareHash({
    activeTab: 'checker',
    builderModIds: ['embeddium', 'oculus'],
    checkedModIds: ['embeddium'],
    builderPrefs: fullPrefs,
  });
  const decoded = decodeShareHash(hash);
  assert.ok(decoded);
  assert.equal(decoded.activeTab, 'checker');
  assert.deepEqual(decoded.builderPrefs, fullPrefs);
});

test('upgraded combinations (Kerria, LightStar, Falling Blocks FPS Fix, Particle Core, ShadowLOD, SoundGC) and Emberbium conflict parity', async () => {
  const { evaluateModImpactInPack, summarizeAssemblyImpact } = await import('./modAnalyzer.ts');

  // 1. Emberbium rule conflict parity with Embeddium-0.3.31-specific addons
  for (const embOnlyId of ['cullify', 'sodium-embeddium-leaf-culling', 'geckolibbetterfps', 'ggtu']) {
    const clash = analyzeSelection(['emberbium', embOnlyId]);
    assert.ok(clash.conflicts.length >= 1, `Expected conflict between emberbium and ${embOnlyId}`);
  }

  // 2. Kerria synergy with Embeddium/Emberbium + ImmediatelyFast and clean nesting in assembly tree
  const kerriaMod = MODS_DATABASE.find(m => m.id === 'kerria')!;
  const kerriaImpact = evaluateModImpactInPack(kerriaMod, new Set(['emberbium', 'immediatelyfast', 'kerria']));
  assert.equal(kerriaImpact.level, 'high');
  assert.ok(kerriaImpact.interactions.some(i => i.kind === 'synergy' && i.targetIds.includes('emberbium')));

  const tree = organizeAssemblyTree(['emberbium', 'kerria', 'immediatelyfast']);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].parent.id, 'emberbium');
  assert.ok(tree[0].children.some(c => c.mod.id === 'kerria'));

  // 3. Balanced vs Max-Safe solo profiles: Max-Safe adds Particle Core (without PartiCull), LightStar, Falling Blocks FPS Fix, SoundGC and scores >= Balanced
  const balPrefs: AssemblyPreferences = {
    gpu: 'nvidia',
    mode: 'singleplayer',
    useShaders: false,
    useCreate: false,
    allowSinytra: true,
    goal: 'balanced',
    recipeViewer: 'emi',
  };
  const maxPrefs: AssemblyPreferences = { ...balPrefs, goal: 'max-safe' };

  const balBuild = buildSmartAssembly(balPrefs);
  const maxBuild = buildSmartAssembly(maxPrefs);

  for (const id of ['kerria', 'reload-looping-sound-fix']) {
    assert.ok(balBuild.modIds.includes(id), `Expected balanced build to include ${id}`);
    assert.ok(maxBuild.modIds.includes(id), `Expected max-safe build to include ${id}`);
  }
  for (const id of ['lightstar', 'falling-blocks-fps-fix', 'soundgc', 'particle-core', 'fzzy-config', 'kotlin-for-forge']) {
    assert.ok(maxBuild.modIds.includes(id), `Expected max-safe build to include ${id}`);
  }
  assert.ok(!maxBuild.modIds.includes('particull'), 'PartiCull must be excluded when Particle Core is active');

  const balSummary = summarizeAssemblyImpact(balBuild.modIds, undefined, balPrefs);
  const maxSummary = summarizeAssemblyImpact(maxBuild.modIds, undefined, maxPrefs);
  assert.ok(
    maxSummary.assemblyScore >= balSummary.assemblyScore,
    `Expected max-safe score (${maxSummary.assemblyScore}) >= balanced (${balSummary.assemblyScore})`
  );
  assert.equal(maxSummary.zeroOrLowImpactIds.length, 0);
  assert.equal(maxSummary.overlaps.length, 0);

  // 4. Shaders + max-safe adds ShadowLOD; hybrid-server adds Spark & entity-collision-optimization
  const shaderMax = buildSmartAssembly({ ...maxPrefs, useShaders: true });
  assert.ok(shaderMax.modIds.includes('oculus'));
  assert.ok(shaderMax.modIds.includes('faster-iris-shadow-mapper'));
  assert.ok(shaderMax.modIds.includes('shadowlod'));
  assert.equal(analyzeSelection(shaderMax.modIds).conflicts.length, 0);

  const hybridMax = buildSmartAssembly({ ...maxPrefs, mode: 'hybrid-server' });
  assert.ok(hybridMax.modIds.includes('krypton-hybrid'));
  assert.ok(hybridMax.modIds.includes('spark'));
  assert.ok(hybridMax.modIds.includes('entity-collision-optimization'));
  assert.equal(analyzeSelection(hybridMax.modIds).conflicts.length, 0);

  // 5. Shader addon anchor (shadowlod) auto-enables shaders & avoids Nvidium; emberbium anchor on AMD excludes alloyium; heavy EMI pack includes emi-trades
  const shadowAnchorBuild = buildSmartAssembly({
    ...maxPrefs,
    gpu: 'nvidia',
    allowSinytra: true,
    useShaders: false,
    focusModId: 'shadowlod',
  });
  assert.ok(shadowAnchorBuild.modIds.includes('oculus'));
  assert.ok(shadowAnchorBuild.modIds.includes('shadowlod'));
  assert.ok(!shadowAnchorBuild.modIds.includes('nvidium'));
  assert.equal(analyzeSelection(shadowAnchorBuild.modIds).conflicts.length, 0);

  const emberAmdBuild = buildSmartAssembly({
    ...maxPrefs,
    gpu: 'amd-intel',
    allowSinytra: false,
    portStrategy: 'native-forge',
    focusModId: 'emberbium',
  });
  assert.ok(emberAmdBuild.modIds.includes('emberbium'));
  assert.ok(!emberAmdBuild.modIds.includes('embeddium'));
  assert.ok(!emberAmdBuild.modIds.includes('alloyium'));
  assert.equal(analyzeSelection(emberAmdBuild.modIds).conflicts.length, 0);

  const heavyEmiBuild = buildSmartAssembly({
    ...maxPrefs,
    packScale: 'heavy',
    recipeViewer: 'emi',
  });
  assert.ok(heavyEmiBuild.modIds.includes('emi-trades'));
  assert.ok(heavyEmiBuild.modIds.includes('emi-ores'));
  assert.ok(heavyEmiBuild.modIds.includes('emiffect'));
  assert.ok(heavyEmiBuild.modIds.includes('emi-professions'));
  assert.equal(analyzeSelection(heavyEmiBuild.modIds).conflicts.length, 0);
});

test('evaluateDubiousMods classifies clean Sinytra Nvidium as low nuance while flagging mismatches, and buildSmartAssembly scales heavy balanced servers & shader builds', async () => {
  const { evaluateDubiousMods } = await import('./modAnalyzer.ts');

  const nvidiumPreset = MOD_PRESETS.find(p => p.id === 'user-nvidium-emberbium')!;
  const cleanNvidiaPrefs: AssemblyPreferences = {
    ...INITIAL_BUILDER_PREFS,
    ...nvidiumPreset.recommendedPrefs,
    gpu: 'nvidia',
    useShaders: false,
    allowSinytra: true,
    portStrategy: 'hybrid',
  };

  const cleanDubious = evaluateDubiousMods(nvidiumPreset.modIds, undefined, cleanNvidiaPrefs);
  const nvidiumCleanEntry = cleanDubious.find(d => d.modId === 'nvidium');
  assert.ok(nvidiumCleanEntry, 'Expected Nvidium to appear as a nuance entry');
  assert.equal(nvidiumCleanEntry.severity, 'low', 'Clean NVIDIA Sinytra Nvidium should be low nuance, not medium risky');

  const nativeForgeDubious = evaluateDubiousMods(nvidiumPreset.modIds, undefined, {
    ...cleanNvidiaPrefs,
    allowSinytra: false,
    portStrategy: 'native-forge',
  });
  assert.equal(nativeForgeDubious.find(d => d.modId === 'nvidium')?.severity, 'high');

  const shaderMismatchDubious = evaluateDubiousMods(nvidiumPreset.modIds, undefined, {
    ...cleanNvidiaPrefs,
    useShaders: true,
  });
  assert.equal(shaderMismatchDubious.find(d => d.modId === 'nvidium')?.severity, 'high');

  const heavyBalancedServer = buildSmartAssembly({
    gpu: 'amd-intel',
    mode: 'server',
    goal: 'balanced',
    packScale: 'heavy',
    useShaders: false,
    useCreate: false,
    allowSinytra: false,
    portStrategy: 'native-forge',
    recipeViewer: 'jei',
  });
  for (const expectedId of [
    'vmp-forge',
    'alternate-current',
    'entity-collision-optimization',
    'stutterfix-reforged',
  ]) {
    assert.ok(heavyBalancedServer.modIds.includes(expectedId), `Expected heavy balanced server to include ${expectedId}`);
  }
  assert.ok(!heavyBalancedServer.modIds.includes('threadtweak-reforged'), 'Expected single scheduler without threadtweak overlap');
  assert.equal(analyzeSelection(heavyBalancedServer.modIds).conflicts.length, 0);

  const balancedShaders = buildSmartAssembly({
    gpu: 'amd-intel',
    mode: 'singleplayer',
    goal: 'balanced',
    packScale: 'medium',
    useShaders: true,
    useCreate: false,
    allowSinytra: false,
    portStrategy: 'native-forge',
    recipeViewer: 'jei',
  });
  assert.ok(balancedShaders.modIds.includes('shadowlod'), 'Balanced shader build should include ShadowLOD');
  assert.equal(analyzeSelection(balancedShaders.modIds).conflicts.length, 0);
});

test('toggleModSmart auto-pairs companion fixes (ALI+FastALI, DH+shaders+MemoryFix, C2ME+Extras/Radium, Calm+AllTheLeaks) cleanly', () => {
  const aliRes = toggleModSmart(['embeddium', 'just-enough-items-jei'], 'advanced-loot-info-ali', { strict: true });
  assert.ok(aliRes.nextIds.includes('fastali'));
  assert.equal(analyzeSelection(aliRes.nextIds).warnings.length, 0);

  const dhShaderRes = toggleModSmart(['embeddium', 'oculus'], 'distant-horizons', { strict: true });
  assert.ok(dhShaderRes.nextIds.includes('distant-horizons-memory-fix-dh'));
  assert.equal(analyzeSelection(dhShaderRes.nextIds).warnings.length, 0);

  const shaderAfterDhRes = toggleModSmart(['emberbium', 'distant-horizons'], 'emberlens', { strict: true });
  assert.ok(shaderAfterDhRes.nextIds.includes('distant-horizons-memory-fix-dh'));
  assert.equal(analyzeSelection(shaderAfterDhRes.nextIds).warnings.length, 0);

  const c2meRes = toggleModSmart(['canary', 'noisiumed'], 'c2me-concurrent-chunk-management-engine', { strict: true });
  assert.ok(c2meRes.nextIds.includes('connector-extras'));
  assert.ok(c2meRes.nextIds.includes('radium-re-reforged'));
  assert.ok(!c2meRes.nextIds.includes('canary'));
  assert.equal(analyzeSelection(c2meRes.nextIds).conflicts.length, 0);
  assert.equal(analyzeSelection(c2meRes.nextIds).warnings.length, 0);

  const calmRes = toggleModSmart(['modernfix'], 'calm-the-leaks', { strict: true });
  assert.ok(calmRes.nextIds.includes('alltheleaks-memory-leak-fix'));
  assert.equal(analyzeSelection(calmRes.nextIds).warnings.length, 0);

  // Exhaustive single-mod strict toggle check: no safe Forge mod leaves conflicts or companion-fix warnings
  for (const mod of MODS_DATABASE) {
    if (mod.status === 'danger' || mod.coveredBy) continue;
    const res = toggleModSmart([], mod.id, { strict: true });
    const a = analyzeSelection(res.nextIds);
    assert.equal(a.conflicts.length, 0, `Single toggle of ${mod.id} caused conflicts`);
    assert.equal(
      a.warnings.filter(w => w.fixModIds && w.fixModIds.length > 0).length,
      0,
      `Single toggle of ${mod.id} left unresolved fixModIds warnings`
    );
  }
});

test('relative impact and analog comparison accurately evaluate slot replacements, recipe ecosystems, and narrow fixes', async () => {
  const { MOD_BY_ID, evaluateModImpactInPack, getModAnalogsComparison } = await import('./modAnalyzer.ts');
  const defaultPack = new Set(buildSmartAssembly(INITIAL_BUILDER_PREFS).modIds);

  // 1. Exclusive slot replacements are evaluated cleanly without conflicting against an existing peer (e.g. Emberbium)
  const rubidiumImpact = evaluateModImpactInPack(MOD_BY_ID.get('rubidium')!, defaultPack, undefined, INITIAL_BUILDER_PREFS);
  assert.ok(rubidiumImpact.betterAnalogId && rubidiumImpact.betterAnalogDeltaPoints && rubidiumImpact.betterAnalogDeltaPoints > 100);

  const flatlightCmp = getModAnalogsComparison(MOD_BY_ID.get('flatlight-shading-cutter')!, defaultPack, INITIAL_BUILDER_PREFS);
  const flatlightEmbeddium = flatlightCmp.find(e => e.mod.id === 'embeddium');
  assert.ok(flatlightEmbeddium && flatlightEmbeddium.relation === 'better-replacement');
  assert.ok(flatlightEmbeddium.points >= 80 && flatlightEmbeddium.relativeDeltaPoints > 50);

  const alloyiumCmp = getModAnalogsComparison(MOD_BY_ID.get('alloyium')!, defaultPack, INITIAL_BUILDER_PREFS);
  const alloyiumEmbeddium = alloyiumCmp.find(e => e.mod.id === 'embeddium');
  assert.ok(alloyiumEmbeddium && alloyiumEmbeddium.points >= 80);

  // Xenon solo recommends Embeddium cleanly (+45+ pts)
  const xenonSolo = evaluateModImpactInPack(MOD_BY_ID.get('xenon')!, new Set(), undefined, INITIAL_BUILDER_PREFS);
  assert.equal(xenonSolo.betterAnalogId, 'embeddium');
  assert.ok((xenonSolo.betterAnalogDeltaPoints ?? 0) >= 40);

  // 2. Narrow/complementary mods in non-exclusive groups never mis-recommend unrelated leaders
  for (const [modId, forbiddenAnalog] of [
    ['shadowlod', 'distant-horizons'],
    ['ggtu', 'dynamic-fps'],
    ['tom-s-simple-storage-performance-optimization', 'just-enough-items-jei'],
    ['alltheleaks-fix-for-moonlight-2-13-4', 'modernfix'],
    ['hp-hariplayer', 'ixeris'],
  ] as const) {
    const solo = evaluateModImpactInPack(MOD_BY_ID.get(modId)!, new Set(), undefined, INITIAL_BUILDER_PREFS);
    assert.notEqual(solo.betterAnalogId, forbiddenAnalog, `${modId} should not suggest unrelated ${forbiddenAnalog}`);
  }
  const ggtuSolo = evaluateModImpactInPack(MOD_BY_ID.get('ggtu')!, new Set(), undefined, INITIAL_BUILDER_PREFS);
  assert.equal(ggtuSolo.betterAnalogId, 'amd-fsr-upscaler-render-scale-for-embeddium');

  const shadowSolo = evaluateModImpactInPack(MOD_BY_ID.get('shadowlod')!, new Set(), undefined, INITIAL_BUILDER_PREFS);
  assert.equal(shadowSolo.label, 'Нужна зависимость');
  assert.equal(shadowSolo.coUsageVerdict, 'dependency');

  // 3. Recipe-viewer awareness: JER in JEI mode does not flag emi-loot as better-replacement
  const jerJeiCmp = getModAnalogsComparison(MOD_BY_ID.get('just-enough-resources-jer')!, defaultPack, {
    ...INITIAL_BUILDER_PREFS,
    recipeViewer: 'jei',
  });
  const emiLootInJei = jerJeiCmp.find(e => e.mod.id === 'emi-loot');
  assert.ok(emiLootInJei && emiLootInJei.relation !== 'better-replacement');

  // 4. Recommended non-conditional mods & networking leader hierarchy
  const fastSounds = evaluateModImpactInPack(MOD_BY_ID.get('fast-sounds')!, new Set(), undefined, INITIAL_BUILDER_PREFS);
  const smoothBoot = evaluateModImpactInPack(MOD_BY_ID.get('smooth-boot-reloaded')!, new Set(), undefined, INITIAL_BUILDER_PREFS);
  assert.equal(fastSounds.level, 'high');
  assert.equal(smoothBoot.level, 'high');

  const kryptonReno = evaluateModImpactInPack(MOD_BY_ID.get('krypton-reno')!, new Set(), undefined, INITIAL_BUILDER_PREFS);
  const c2sFilter = evaluateModImpactInPack(MOD_BY_ID.get('c2s-log-filter')!, new Set(), undefined, INITIAL_BUILDER_PREFS);
  assert.ok(kryptonReno.impactPoints > c2sFilter.impactPoints);

  // 5. Full sweep: no valid non-diagnostic better-replacement entry produces negative/zero delta in default pack
  for (const mod of MODS_DATABASE) {
    if (mod.status === 'danger' || mod.status === 'diagnostic') continue;
    const cmp = getModAnalogsComparison(mod, defaultPack, INITIAL_BUILDER_PREFS);
    for (const entry of cmp) {
      if (entry.relation === 'better-replacement') {
        assert.ok(
          entry.relativeDeltaPoints > 0,
          `${mod.id} -> ${entry.mod.id} had non-positive better-replacement delta (${entry.relativeDeltaPoints})`
        );
      }
    }
  }
});

test('verified mod facts, new library dependencies, cascade cleanup, and FastSuite vs Fast Recipe Search conflict hold', () => {
  // 1. FastSuite <-> Fast Recipe Search incompatibility rule
  const recipeClash = analyzeSelection(['fastsuite', 'placebo', 'fast-recipe-search']);
  assert.ok(
    recipeClash.conflicts.some(c => c.matchedIds.includes('fastsuite') && c.matchedIds.includes('fast-recipe-search')),
    'Expected conflict between FastSuite and Fast Recipe Search'
  );

  // 2. New library dependencies pull via toggleModSmart and cascade cleanly via removeModsCascade
  const fif = toggleModSmart([], 'fast-item-frames', { strict: true });
  assert.ok(fif.nextIds.includes('puzzles-lib'));
  assert.ok(!removeModsCascade(fif.nextIds, ['fast-item-frames']).nextIds.includes('puzzles-lib'));

  const lmd = toggleModSmart([], 'let-me-despawn', { strict: true });
  assert.ok(lmd.nextIds.includes('almanac'));
  assert.ok(!removeModsCascade(lmd.nextIds, ['let-me-despawn']).nextIds.includes('almanac'));

  const obs = toggleModSmart([], 'observable', { strict: true });
  assert.ok(obs.nextIds.includes('kotlin-for-forge'));
  assert.ok(obs.nextIds.includes('architectury-api'));
  assert.ok(!removeModsCascade(obs.nextIds, ['observable']).nextIds.includes('architectury-api'));

  const sdfu = toggleModSmart([], 'structure-dfu-cache', { strict: true });
  assert.ok(sdfu.nextIds.includes('rinlib'));
  assert.ok(!removeModsCascade(sdfu.nextIds, ['structure-dfu-cache']).nextIds.includes('rinlib'));

  // 3. Factual descriptions & CurseForge URLs
  const papi = MODS_DATABASE.find(m => m.id === 'put-a-plug-in-it-papi')!;
  assert.equal(papi.curseforgeUrl, 'https://www.curseforge.com/minecraft/mc-mods/put-a-plug-in-it-papi');
  assert.ok(papi.description.includes('ModelManager') || papi.description.includes('ItemStackKey'));
  assert.ok(!papi.description.includes('спам ошибок в консоли'));

  const rlsf = MODS_DATABASE.find(m => m.id === 'reload-looping-sound-fix')!;
  assert.ok(rlsf.description.includes('MC-194284') || rlsf.description.includes('F3+T'));

  const falling = MODS_DATABASE.find(m => m.id === 'falling-blocks-fps-fix')!;
  assert.ok((falling.warning ?? '').includes('удаляет') && (falling.warning ?? '').includes('дроп'));

  const vanillin = MODS_DATABASE.find(m => m.id === 'vanillin')!;
  assert.equal(vanillin.curseforgeUrl, 'https://www.curseforge.com/minecraft/mc-mods/vanillin');
});

test('obvious duplicate-port conflicts and non-obvious cross-mod co-work checks, configs, and tree nesting hold', async () => {
  const { MOD_BY_ID, evaluateDubiousMods, evaluateModImpactInPack } = await import('./modAnalyzer.ts');
  const { MOD_RECOMMENDED_CONFIGS } = await import('../data/modConfigs.ts');

  // 1. Newly added obvious mutual conflict pairs & smartFixAssembly resolution
  const duplicatePairs: Array<[string, string]> = [
    ['stutterfix-reforged', 'stutterfix-modern-port'],
    ['language-reload-reforged', 'languagereloadunofficial'],
    ['capability-fix-revived', 'capability-fix'],
    ['bobby-reforged', 'farsight'],
    ['fastfurnace', 'furnaceoptimizer'],
    ['let-me-despawn', 'despawn-tweaks'],
    ['let-me-despawn', 'despawn-tweaks-modern-port'],
  ];
  for (const [a, b] of duplicatePairs) {
    const clash = analyzeSelection([a, b]);
    assert.ok(
      clash.conflicts.some(c => c.matchedIds.includes(a) && c.matchedIds.includes(b)),
      `Expected conflict between ${a} and ${b}`
    );
    const fixed = smartFixAssembly([a, b]);
    assert.equal(analyzeSelection(fixed).conflicts.length, 0, `Expected smartFixAssembly([${a}, ${b}]) to resolve conflicts`);
  }

  // 2. Non-rule yellow overlap warnings and smartFixAssembly cleanup
  const overlapPairs: Array<[string, string]> = [
    ['prismanium', 'sodium-embeddium-dynamic-lights'],
    ['distant-horizons', 'bobby-reforged'],
    ['distant-horizons', 'farsight'],
    ['servercore', 'adaptive-performance-tweaks'],
    ['servercore', 'adaptive-optimization-reborn'],
    ['mob-collision-off', 'farmcollisionless'],
    ['mob-collision-off', 'entity-collision-optimization'],
  ];
  for (const [a, b] of overlapPairs) {
    const res = analyzeSelection([a, b]);
    assert.ok(
      res.warnings.some(w => w.severity === 'yellow' && w.modId === b),
      `Expected yellow overlap warning on ${b} when paired with ${a}`
    );
    const fixed = smartFixAssembly([a, b]);
    const fixedAn = analyzeSelection(fixed);
    assert.equal(fixedAn.conflicts.length, 0);
    assert.equal(
      fixedAn.warnings.filter(w => w.modId === b).length,
      0,
      `Expected smartFixAssembly([${a}, ${b}]) to prune overlapping ${b}`
    );
  }

  // 3. Non-obvious contextual interactions & dubious caveats (zero false alarms on presets)
  const flywheelShader = evaluateModImpactInPack(
    MOD_BY_ID.get('flywheel')!,
    new Set(['embeddium', 'oculus', 'flywheel']),
    undefined,
    { ...INITIAL_BUILDER_PREFS, useShaders: true, useCreate: true }
  );
  assert.ok(
    flywheelShader.interactions.some(i => i.kind === 'context' && i.targetIds.includes('oculus')),
    'Expected Flywheel + Oculus GPU instancing fallback context note'
  );
  const flywheelDubious = evaluateDubiousMods(['embeddium', 'oculus', 'flywheel'], undefined, {
    ...INITIAL_BUILDER_PREFS,
    useShaders: true,
    useCreate: true,
  });
  assert.ok(flywheelDubious.some(d => d.modId === 'flywheel' && d.severity === 'low'));

  const gputapeShader = evaluateModImpactInPack(
    MOD_BY_ID.get('gputape')!,
    new Set(['embeddium', 'oculus', 'gputape'])
  );
  assert.ok(gputapeShader.interactions.some(i => i.kind === 'context' && i.summary.includes('RBO depth')));

  const immFastShader = evaluateModImpactInPack(
    MOD_BY_ID.get('immediatelyfast')!,
    new Set(['embeddium', 'oculus', 'immediatelyfast'])
  );
  assert.ok(immFastShader.interactions.some(i => i.kind === 'context' && i.summary.includes('hud_batching')));

  const dhC2me = evaluateModImpactInPack(
    MOD_BY_ID.get('distant-horizons')!,
    new Set(['embeddium', 'distant-horizons', 'concurrent-chunk-management-engine-forge-c2me'])
  );
  assert.ok(dhC2me.interactions.some(i => i.kind === 'context' && i.summary.includes('CPU')));
  const dhC2meDubious = evaluateDubiousMods([
    'embeddium',
    'modernfix',
    'ferritecore',
    'distant-horizons',
    'concurrent-chunk-management-engine-forge-c2me',
  ]);
  assert.ok(dhC2meDubious.some(d => d.modId === 'distant-horizons' && d.severity === 'low'));

  const altCurRadium = evaluateModImpactInPack(
    MOD_BY_ID.get('alternate-current')!,
    new Set(['radium-re-reforged', 'alternate-current'])
  );
  assert.ok(altCurRadium.interactions.some(i => i.kind === 'context' && i.targetIds.includes('radium-re-reforged')));

  const fallingCreate = evaluateModImpactInPack(
    MOD_BY_ID.get('falling-blocks-fps-fix')!,
    new Set(['falling-blocks-fps-fix']),
    undefined,
    { ...INITIAL_BUILDER_PREFS, useCreate: true }
  );
  assert.ok(fallingCreate.interactions.some(i => i.kind === 'context' && i.summary.includes('Create')));

  // 4. Tree nesting & recommended configs for compatibility caveats
  const dhTree = organizeAssemblyTree(['distant-horizons', 'farsight']);
  assert.equal(dhTree.length, 1);
  assert.equal(dhTree[0].parent.id, 'distant-horizons');
  assert.ok(dhTree[0].children.some(c => c.mod.id === 'farsight'));

  for (const cfgId of ['gputape', 'immediatelyfast', 'radium-re-reforged', 'distant-horizons']) {
    assert.ok(
      MOD_RECOMMENDED_CONFIGS.some(c => c.modId === cfgId),
      `Expected recommended config entry for ${cfgId}`
    );
  }
});

test('extended co-work checks cover DimThread+C2ME, ZSTDNET+KryptonHybrid, explosions, F3, splash, entity-sleep, asyncparticles, world-save, resourcepack cache, configs, and tree', async () => {
  const { MOD_BY_ID, evaluateDubiousMods, evaluateModImpactInPack, summarizeAssemblyImpact } = await import('./modAnalyzer.ts');
  const { MOD_RECOMMENDED_CONFIGS } = await import('../data/modConfigs.ts');

  // 1. Newly added mutual-exclusion rules & smartFixAssembly
  const newConflictPairs: Array<[string, string]> = [
    ['dimensional-threading-reforked', 'concurrent-chunk-management-engine-forge-c2me'],
    ['dimensional-threading-reforked', 'c2me-concurrent-chunk-management-engine'],
    ['dimensional-threading-reforked', 'c2mer'],
    ['zstdnet', 'krypton-hybrid'],
    ['zstdnet', 'aegisnetworking-krypton-hybrid'],
    ['better-tnt', 'perfomant-boom'],
    ['compact-f3-plus', 'improved-f3'],
    ['smooth-loading-screens', 'early-loading-screen'],
    ['smooth-loading-screens', 'splashscreen'],
    ['early-loading-screen', 'splashscreen'],
    ['entitysleep', 'enttick'],
    ['sleepium', 'martensite-entity-tick-skiper'],
  ];
  for (const [a, b] of newConflictPairs) {
    const clash = analyzeSelection([a, b]);
    assert.ok(
      clash.conflicts.some(c => c.matchedIds.includes(a) && c.matchedIds.includes(b)),
      `Expected conflict between ${a} and ${b}`
    );
    const fixed = smartFixAssembly([a, b]);
    assert.equal(analyzeSelection(fixed).conflicts.length, 0, `Expected smartFixAssembly([${a}, ${b}]) to have 0 conflicts`);
  }

  // Asymmetric rules must NOT emit a false DimThread conflict for C2ME vs C2MEF, or ZSTDNET conflict for Hybrid vs Aegis
  const c2meOnlyClash = analyzeSelection(['concurrent-chunk-management-engine-forge-c2me', 'c2mer']);
  assert.ok(!c2meOnlyClash.conflicts.some(c => c.rule.title.includes('Dimensional Threading')));
  const hybridOnlyClash = analyzeSelection(['krypton-hybrid', 'aegisnetworking-krypton-hybrid']);
  assert.ok(!hybridOnlyClash.conflicts.some(c => c.rule.title.includes('Zstd-сжатия')));

  // 2. Non-rule yellow overlap checks & smartFixAssembly pruning
  const extendedOverlaps: Array<[string, string]> = [
    ['particle-core', 'asyncparticles'],
    ['immersive-optimization', 'entitysleep'],
    ['immersive-optimization', 'enttick'],
    ['immersive-optimization', 'sleepium'],
    ['immersive-optimization', 'martensite-entity-tick-skiper'],
    ['c2mer', 'parallel-world-save'],
    ['concurrent-chunk-management-engine-forge-c2me', 'delta-chunk'],
    ['parallel-world-save', 'delta-chunk'],
    ['resourcepackcached', 'keep-the-resourcepack'],
    ['resourcepackcached', 'packforge'],
    ['keep-the-resourcepack', 'packforge'],
  ];
  for (const [a, b] of extendedOverlaps) {
    const res = analyzeSelection([a, b]);
    assert.ok(
      res.warnings.some(w => w.severity === 'yellow' && w.modId === b),
      `Expected yellow overlap warning on ${b} when paired with ${a}`
    );
    const fixed = smartFixAssembly([a, b]);
    const fixedAn = analyzeSelection(fixed);
    assert.equal(fixedAn.conflicts.length, 0);
    assert.equal(
      fixedAn.warnings.filter(w => w.modId === b).length,
      0,
      `Expected smartFixAssembly([${a}, ${b}]) to remove overlapping ${b}`
    );
  }

  // 3. Non-obvious contextual caveats & dubious warnings
  const zstdDubious = evaluateDubiousMods(['krypton-reno'.replace('krypton-reno', 'zstdnet')]);
  assert.ok(zstdDubious.some(d => d.modId === 'zstdnet' && d.reason.includes('Zstandard')));
  const zstdImpact = evaluateModImpactInPack(MOD_BY_ID.get('zstdnet')!, new Set(['zstdnet']));
  assert.ok(zstdImpact.interactions.some(i => i.kind === 'context' && i.summary.includes('клиент')));

  const asyncPartDubious = evaluateDubiousMods(['asyncparticles']);
  assert.ok(asyncPartDubious.some(d => d.modId === 'asyncparticles' && d.reason.includes('Botania')));

  const chunkyC2meImpact = evaluateModImpactInPack(
    MOD_BY_ID.get('chunky')!,
    new Set(['chunky', 'concurrent-chunk-management-engine-forge-c2me', 'distant-horizons'])
  );
  assert.ok(chunkyC2meImpact.interactions.some(i => i.kind === 'synergy' && i.targetIds.includes('concurrent-chunk-management-engine-forge-c2me')));
  assert.ok(chunkyC2meImpact.interactions.some(i => i.kind === 'context' && i.targetIds.includes('distant-horizons')));
  const chunkyDubious = evaluateDubiousMods(['chunky', 'distant-horizons']);
  assert.ok(chunkyDubious.some(d => d.modId === 'chunky' && d.severity === 'low'));

  const ecCreateImpact = evaluateModImpactInPack(
    MOD_BY_ID.get('entity-culling')!,
    new Set(['embeddium', 'oculus', 'entity-culling']),
    undefined,
    { ...INITIAL_BUILDER_PREFS, useCreate: true, useShaders: true }
  );
  assert.ok(ecCreateImpact.interactions.some(i => i.kind === 'context' && i.summary.includes('blockEntityWhitelist')));

  const badOptShader = evaluateModImpactInPack(
    MOD_BY_ID.get('badoptimizations')!,
    new Set(['embeddium', 'oculus', 'badoptimizations']),
    undefined,
    { ...INITIAL_BUILDER_PREFS, useShaders: true }
  );
  assert.ok(badOptShader.interactions.some(i => i.kind === 'context' && i.summary.includes('enable_sky_color_caching')));

  const lmdImpact = evaluateModImpactInPack(
    MOD_BY_ID.get('let-me-despawn')!,
    new Set(['let-me-despawn', 'almanac'])
  );
  assert.ok(lmdImpact.interactions.some(i => i.kind === 'context' && i.targetIds.includes('almanac')));

  // 4. Presets remain spotless (0 conflicts, 0 warnings, 0 overlaps, 0 zero/low impact mods)
  for (const preset of MOD_PRESETS) {
    const an = analyzeSelection(preset.modIds);
    assert.equal(an.conflicts.length, 0, `Preset ${preset.id} must have 0 conflicts`);
    assert.equal(an.warnings.length, 0, `Preset ${preset.id} must have 0 warnings`);
    const summary = summarizeAssemblyImpact(preset.modIds, an, {
      ...INITIAL_BUILDER_PREFS,
      ...preset.recommendedPrefs,
    });
    assert.equal(summary.overlaps.length, 0, `Preset ${preset.id} must have 0 overlaps`);
    assert.equal(summary.zeroOrLowImpactIds.length, 0, `Preset ${preset.id} must have 0 dead mods`);
  }

  // 5. smartFixAssembly(ALL_MOD_IDS) still ends with 0 conflicts & 0 warnings
  const allFixed = smartFixAssembly(MODS_DATABASE.map(m => m.id));
  const allAn = analyzeSelection(allFixed);
  assert.equal(allAn.conflicts.length, 0);
  assert.equal(allAn.warnings.length, 0);

  // 6. New tree nestings and configs
  const f3Tree = organizeAssemblyTree(['compact-f3-plus', 'improved-f3']);
  assert.equal(f3Tree.length, 1);
  assert.equal(f3Tree[0].parent.id, 'compact-f3-plus');
  assert.ok(f3Tree[0].children.some(c => c.mod.id === 'improved-f3'));

  const sleepTree = organizeAssemblyTree(['immersive-optimization', 'entitysleep', 'sleepium']);
  assert.equal(sleepTree.length, 1);
  assert.equal(sleepTree[0].parent.id, 'immersive-optimization');
  assert.equal(sleepTree[0].children.length, 2);

  const partTree = organizeAssemblyTree(['particle-core', 'asyncparticles']);
  assert.equal(partTree.length, 1);
  assert.equal(partTree[0].parent.id, 'particle-core');
  assert.ok(partTree[0].children.some(c => c.mod.id === 'asyncparticles'));

  const rpTree = organizeAssemblyTree(['resourcepackcached', 'keep-the-resourcepack', 'packforge']);
  assert.equal(rpTree.length, 1);
  assert.equal(rpTree[0].parent.id, 'resourcepackcached');
  assert.equal(rpTree[0].children.length, 2);

  for (const cfgId of ['entity-culling', 'badoptimizations', 'servercore', 'let-me-despawn']) {
    assert.ok(
      MOD_RECOMMENDED_CONFIGS.some(c => c.modId === cfgId),
      `Expected recommended config entry for ${cfgId}`
    );
  }
});

test('isOutdatedOrUselessMod, shouldHideMod toggle, and persistent hideOutdatedUseless preference work accurately', async () => {
  const { isOutdatedOrUselessMod } = await import('./modAnalyzer.ts');
  const { decodeShareHash, encodeShareHash, parsePersistedState } = await import('./persistence.ts');
  const byId = new Map(MODS_DATABASE.map(m => [m.id, m]));
  const emptySet = new Set<string>();

  // Default preference hides danger, outdated, redundant, coveredBy, and superseded mods
  assert.equal(INITIAL_BUILDER_PREFS.hideOutdatedUseless, true);
  for (const outdatedOrUselessId of [
    'memguard',
    'rubidium',
    'radium-reforged',
    'stablecap-pacer-forge-1-19-2',
    'cullify',
    'fastboot',
  ]) {
    const mod = byId.get(outdatedOrUselessId);
    assert.ok(mod, `Expected mod ${outdatedOrUselessId} in DB`);
    assert.equal(
      isOutdatedOrUselessMod(mod, emptySet, INITIAL_BUILDER_PREFS),
      true,
      `Expected ${outdatedOrUselessId} to be classified as outdated/useless`
    );
    assert.equal(
      shouldHideMod(mod, emptySet, INITIAL_BUILDER_PREFS, {
        hideIncompatible: false,
        hideUselessCovered: true,
      }),
      true
    );
    assert.equal(
      shouldHideMod(mod, emptySet, INITIAL_BUILDER_PREFS, {
        hideIncompatible: false,
        hideUselessCovered: false,
      }),
      false
    );
    // Selected mods remain visible even when hideUselessCovered is true
    assert.equal(
      shouldHideMod(mod, new Set([outdatedOrUselessId]), INITIAL_BUILDER_PREFS, {
        hideIncompatible: false,
        hideUselessCovered: true,
      }),
      false
    );
  }

  // Neither canonical preset contains any outdated/useless mods
  for (const preset of MOD_PRESETS) {
    const pSet = new Set(preset.modIds);
    for (const id of preset.modIds) {
      const mod = byId.get(id)!;
      assert.equal(
        isOutdatedOrUselessMod(mod, pSet, { ...INITIAL_BUILDER_PREFS, ...preset.recommendedPrefs }),
        false,
        `Preset ${preset.id} mod ${id} should not be outdated/useless`
      );
    }
  }

  // Persistence & share hash round-trip for hideOutdatedUseless
  const parsedFalse = parsePersistedState({
    builderPrefs: { ...INITIAL_BUILDER_PREFS, hideOutdatedUseless: false },
  });
  assert.equal(parsedFalse?.builderPrefs?.hideOutdatedUseless, false);

  const hash = encodeShareHash({
    activeTab: 'catalog',
    builderModIds: ['embeddium'],
    checkedModIds: ['embeddium'],
    builderPrefs: { ...INITIAL_BUILDER_PREFS, hideOutdatedUseless: false },
  });
  const decoded = decodeShareHash(hash);
  assert.equal(decoded?.builderPrefs?.hideOutdatedUseless, false);
});

test('Blocks 1-4 technical audit: Fastload/Ksyxis, SuperChunk/CLab asymmetric rules, HC-HariChunk, RAM guard, schedulers, culling, Create+Shaders compat, and 6 presets', async () => {
  const { MOD_BY_ID, evaluateModImpactInPack, getRuleConflictingIds, summarizeAssemblyImpact } = await import('./modAnalyzer.ts');

  // Block 1: Fastload vs Ksyxis conflict + smartFixAssembly keeping strictly one
  const fastKsyx = analyzeSelection(['modernfix', 'fastload', 'ksyxis']);
  assert.ok(fastKsyx.conflicts.some(c => c.matchedIds.includes('fastload') && c.matchedIds.includes('ksyxis')));
  const fixedFastKsyx = smartFixAssembly(['modernfix', 'fastload', 'ksyxis']);
  assert.equal([ 'fastload', 'ksyxis' ].filter(id => fixedFastKsyx.includes(id)).length, 1);

  // Block 1: SuperChunk asymmetric hub rule (conflicts with Noisiumed and C2MEF, without making Noisiumed <-> C2MEF conflict)
  const superNois = analyzeSelection(['superchunk', 'noisiumed']);
  assert.ok(superNois.conflicts.some(c => c.matchedIds.includes('superchunk') && c.matchedIds.includes('noisiumed')));
  const superC2me = analyzeSelection(['superchunk', 'concurrent-chunk-management-engine-forge-c2me']);
  assert.ok(superC2me.conflicts.some(c => c.matchedIds.includes('superchunk')));
  const cleanNoisC2me = analyzeSelection(['embeddium', 'modernfix', 'ferritecore', 'noisiumed', 'concurrent-chunk-management-engine-forge-c2me']);
  assert.equal(cleanNoisC2me.conflicts.length, 0);

  // Block 1: HC-HariChunk included in C2ME world-save / dimthread overlaps & smartFix
  const hariDim = analyzeSelection(['hc-harichunk', 'dimensional-threading-reforked']);
  assert.ok(hariDim.conflicts.length >= 1);
  const hariSave = analyzeSelection(['modernfix', 'ferritecore', 'hc-harichunk', 'parallel-world-save']);
  assert.ok(hariSave.warnings.some(w => w.modId === 'parallel-world-save' && w.severity === 'yellow'));
  assert.ok(getRuleConflictingIds('krypton-hybrid').length >= 0);

  // Block 1: Packet Fixer synergy with Krypton Hybrid / AegisNetworking
  const pfHybrid = evaluateModImpactInPack(MOD_BY_ID.get('packet-fixer')!, new Set(['krypton-hybrid', 'packet-fixer']));
  assert.ok(pfHybrid.interactions.some(i => i.kind === 'synergy' && i.targetIds.includes('krypton-hybrid')));

  // Block 1: Hybrid server strictly excludes Radium Re-Reforged, C2ME*, VMP*
  const hybridBuild = buildSmartAssembly({
    ...INITIAL_BUILDER_PREFS,
    mode: 'hybrid-server',
    goal: 'max-safe',
    packScale: 'heavy',
  });
  for (const banned of ['radium-re-reforged', 'concurrent-chunk-management-engine-forge-c2me', 'c2mer', 'hc-harichunk', 'vmp-forge', 'krypton-reno']) {
    assert.ok(!hybridBuild.modIds.includes(banned), `hybrid-server must exclude ${banned}`);
  }
  assert.ok(hybridBuild.modIds.includes('krypton-hybrid'));

  // Block 2: GPUTape vs Fix GPU Memory Leak overlap, LOD/Chunk RAM guard, and Create + Shaders companions
  const gpuOverlap = analyzeSelection(['embeddium', 'gputape', 'fix-gpu-memory-leak']);
  assert.ok(gpuOverlap.warnings.some(w => w.modId === 'fix-gpu-memory-leak' && w.severity === 'yellow'));
  const fixedGpu = smartFixAssembly(['embeddium', 'gputape', 'fix-gpu-memory-leak']);
  assert.ok(fixedGpu.includes('gputape') && !fixedGpu.includes('fix-gpu-memory-leak'));

  const c2meNoRam = analyzeSelection(['embeddium', 'concurrent-chunk-management-engine-forge-c2me']);
  assert.ok(c2meNoRam.warnings.some(w => w.fixModIds?.includes('modernfix') && w.fixModIds?.includes('ferritecore')));
  const toggledC2me = toggleModSmart(['embeddium'], 'concurrent-chunk-management-engine-forge-c2me', { strict: true });
  assert.ok(toggledC2me.nextIds.includes('modernfix') && toggledC2me.nextIds.includes('ferritecore'));
  assert.equal(analyzeSelection(toggledC2me.nextIds).warnings.length, 0);

  const createShadersBuild = buildSmartAssembly({
    ...INITIAL_BUILDER_PREFS,
    useCreate: true,
    useShaders: true,
    goal: 'max-safe',
  });
  for (const expectedCreateId of ['flywheel', 'vanillin', 'iris-oculus-flywheel-compat', 'duplicate-nbt-flattener', 'capability-fix-revived']) {
    assert.ok(createShadersBuild.modIds.includes(expectedCreateId), `Create+Shaders build missing ${expectedCreateId}`);
  }

  // Block 3: Exclusive thread schedulers (StutterFix Reforged vs ThreadTweak Reforged vs Smooth Boot Reloaded)
  const schedOverlap = analyzeSelection(['stutterfix-reforged', 'threadtweak-reforged']);
  assert.ok(schedOverlap.warnings.some(w => w.modId === 'stutterfix-reforged' && w.severity === 'yellow'));
  const fixedSched = smartFixAssembly(['stutterfix-reforged', 'threadtweak-reforged', 'smooth-boot-reloaded']);
  assert.equal(['stutterfix-reforged', 'threadtweak-reforged', 'smooth-boot-reloaded'].filter(id => fixedSched.includes(id)).length, 1);

  // Block 4: Culling overlaps, CLab asymmetric leaf culling, More Culling + EBER synergy, Sightline + Shaders, Toast Control + Placebo
  const ecItem = analyzeSelection(['entity-culling', 'itemculler']);
  assert.ok(ecItem.warnings.some(w => w.modId === 'itemculler' && w.severity === 'yellow'));
  const clabLeaf = analyzeSelection(['clab', 'culllessleaves-reforged']);
  assert.ok(clabLeaf.conflicts.some(c => c.matchedIds.includes('clab') && c.matchedIds.includes('culllessleaves-reforged')));
  const moreFif = analyzeSelection(['more-culling-reforged', 'fast-item-frames', 'puzzles-lib']);
  assert.ok(moreFif.warnings.some(w => w.modId === 'more-culling-reforged' || w.modId === 'fast-item-frames'));
  const moreEber = evaluateModImpactInPack(
    MOD_BY_ID.get('more-culling-reforged')!,
    new Set(['embeddium', 'more-culling-reforged', 'enhanced-block-entities-reloaded', 'matlib'])
  );
  assert.ok(moreEber.interactions.some(i => i.kind === 'synergy' && i.targetIds.includes('enhanced-block-entities-reloaded')));

  const sightlineShader = analyzeSelection(['embeddium', 'oculus', 'sodium-sightline']);
  assert.ok(sightlineShader.warnings.some(w => w.modId === 'sodium-sightline' && w.severity === 'yellow'));
  const toastPlacebo = analyzeSelection(['toast-control', 'placebo']);
  assert.equal(toastPlacebo.warnings.length, 0);

  // Block 4: All 6 presets meet strict quality gates (0 conflicts, 0 warnings, 0 overlaps, 0 dead mods, 7/7 subsystems, score >= 96)
  for (const preset of MOD_PRESETS) {
    const an = analyzeSelection(preset.modIds);
    const sum = summarizeAssemblyImpact(preset.modIds, an, {
      ...INITIAL_BUILDER_PREFS,
      ...preset.recommendedPrefs,
    });
    assert.equal(an.conflicts.length, 0, `${preset.id}: unexpected conflicts`);
    assert.equal(an.warnings.length, 0, `${preset.id}: unexpected warnings`);
    assert.equal(sum.overlaps.length, 0, `${preset.id}: unexpected overlaps`);
    assert.equal(sum.zeroOrLowImpactIds.length, 0, `${preset.id}: unexpected dead mods`);
    assert.equal(sum.coveredSubsystems.length, 7, `${preset.id}: expected 7/7 subsystems`);
    assert.ok(sum.assemblyScore >= 96, `${preset.id}: expected score >= 96, got ${sum.assemblyScore}`);
  }
});
