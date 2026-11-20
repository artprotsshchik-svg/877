import { MOD_GROUPS, type ModItem } from '../data/modsData.ts';
import type {
  AssemblyPreferences,
  ExcludedModNote,
  PortStrategy,
  RecipeViewerChoice,
  SmartAssemblyResult,
  SmartToggleResult,
} from './modTypes.ts';
import {
  EXCLUSIVE_ENGINE_POOLS,
  FABRIC_TO_FORGE_SWAP,
  LIBRARY_CONSUMER_MAP,
  MOD_BY_ID,
  SINYTRA_BRIDGE_IDS,
  analyzeSelection,
  getDirectDependencies,
  getDualPortPairForMod,
  getModEffectivenessScore,
  getModSuperseder,
  getRuleConflictingIds,
  getTransitiveDependencies,
  isUnsupportedOnForge,
} from './modAnalyzer.ts';

export function buildSmartAssembly(prefs: AssemblyPreferences): SmartAssemblyResult {
  const anchorRaw = prefs.focusModId ? MOD_BY_ID.get(prefs.focusModId) : undefined;
  const notes: string[] = [];
  const excluded: ExcludedModNote[] = [];

  let activeAnchor: ModItem | undefined = anchorRaw;
  if (anchorRaw && isUnsupportedOnForge(anchorRaw)) {
    const swapId = FABRIC_TO_FORGE_SWAP[anchorRaw.id];
    const swapMod = swapId ? MOD_BY_ID.get(swapId) : undefined;
    if (swapMod) {
      notes.push(`Упор «${anchorRaw.name}» недоступен на Forge 1.20.1 — автоматически переключён нативный порт ${swapMod.name}.`);
      excluded.push({ name: anchorRaw.name, reason: `Fabric-оригинал заменён на порт ${swapMod.name}.` });
      activeAnchor = swapMod;
    } else {
      notes.push(`Упор «${anchorRaw.name}» несовместим с Forge 1.20.1 — упор пропущен.`);
      excluded.push({ name: anchorRaw.name, reason: anchorRaw.bestAlternative || 'Не работает на Forge 1.20.1.' });
      activeAnchor = undefined;
    }
  } else if (anchorRaw && anchorRaw.status === 'danger') {
    notes.push(`Упор «${anchorRaw.name}» заблокирован умным движком: ${anchorRaw.warning || 'плацебо или высокий риск краша'}.`);
    excluded.push({ name: anchorRaw.name, reason: anchorRaw.warning || 'Опасный или плацебо-мод.' });
    activeAnchor = undefined;
  } else if (anchorRaw && anchorRaw.coveredBy) {
    notes.push(`Упор «${anchorRaw.name}» уже встроен в ${anchorRaw.coveredBy} — использован основной лидер.`);
  }

  const portStrategy: PortStrategy =
    prefs.portStrategy ?? (prefs.allowSinytra ? 'hybrid' : 'native-forge');

  let recipeViewer: RecipeViewerChoice = prefs.recipeViewer ?? 'jei';
  if (activeAnchor) {
    if (activeAnchor.id === 'tmrv-updated' || activeAnchor.id === 'emi' || activeAnchor.recipeEcosystem === 'emi-only') {
      recipeViewer = activeAnchor.id === 'tmrv-updated' || recipeViewer === 'none' || recipeViewer === 'jei' ? 'emi' : recipeViewer;
    } else if (activeAnchor.id === 'just-enough-items-jei' || activeAnchor.recipeEcosystem === 'jei-engine') {
      recipeViewer = recipeViewer === 'emi-jei' ? 'emi-jei' : 'jei';
    } else if (activeAnchor.recipeEcosystem === 'jei-plugin' && recipeViewer === 'none') {
      recipeViewer = 'jei';
    }
  }

  const effectivePrefs: AssemblyPreferences = {
    ...prefs,
    portStrategy,
    recipeViewer,
    allowSinytra: portStrategy === 'fabric-sinytra' ? true : prefs.allowSinytra,
    focusModId: activeAnchor?.id ?? null,
  };

  let useEmberlensPipeline = false;
  if (activeAnchor) {
    const aid = activeAnchor.id;
    const anchorPair = getDualPortPairForMod(aid);
    if (aid === 'nvidium') {
      effectivePrefs.gpu = 'nvidia';
      effectivePrefs.allowSinytra = true;
      effectivePrefs.useShaders = false;
      if (effectivePrefs.goal === 'potato') effectivePrefs.goal = 'balanced';
      notes.push(`Упор на ${activeAnchor.name}: активирован Sinytra Connector + Emberbium + Flerovium, а шейдеры и Alloyium отключены для работы Mesh Shaders.`);
    } else if (aid === 'alloyium') {
      if (effectivePrefs.goal === 'potato') effectivePrefs.goal = 'balanced';
      notes.push('Упор на Alloyium: выбран нативный OpenGL Compute конвейер (без Nvidium). Доступно переключение на Nvidium (Fabric + Sinytra) в блоке выбора портов.');
    } else if (aid === 'emberlens' || (aid === 'emberbium' && effectivePrefs.useShaders)) {
      useEmberlensPipeline = true;
      effectivePrefs.useShaders = true;
      if (effectivePrefs.goal === 'potato') effectivePrefs.goal = 'balanced';
      notes.push(`Упор на ${activeAnchor.name}: подключена альтернативная связка Emberbium + Emberlens (вместо Embeddium + Oculus + Nvidium).`);
    } else if (aid === 'emberbium') {
      notes.push('Упор на Emberbium: выбран в качестве базового 3D-рендера вместо Embeddium (совместим с Nvidium, Flerovium и Chloride; для шейдеров включите опцию «Шейдеры»).');
    } else if (
      aid === 'oculus' ||
      aid === 'faster-iris-shadow-mapper' ||
      aid === 'shadowlod' ||
      aid === 'ggtu' ||
      aid === 'unofficial-luxium-compatibility-luxium-oculus' ||
      aid === 'bons-dlss-diet-complementary-unbound'
    ) {
      effectivePrefs.useShaders = true;
      if (effectivePrefs.goal === 'potato') effectivePrefs.goal = 'balanced';
      notes.push(`Упор на ${activeAnchor.name}: включён шейдерный стек Embeddium + Oculus (Nvidium исключён).`);
    } else if (aid === 'c2me-concurrent-chunk-management-engine' || activeAnchor.platform.includes('Sinytra')) {
      effectivePrefs.allowSinytra = true;
      notes.push(`Упор на ${activeAnchor.name} (Fabric + Sinytra): подключены Sinytra Connector + Forgified Fabric API.${anchorPair?.switchableOnForge ? ` Можно в 1 клик переключить на нативный Forge-порт ${anchorPair.forgeLabel}.` : ''}`);
    } else if (aid === 'concurrent-chunk-management-engine-forge-c2me' || aid === 'c2mer' || aid === 'vmp-forge') {
      notes.push(`Упор на нативный Forge-порт ${activeAnchor.name}: Fabric-дубликаты исключены.${anchorPair?.switchableOnForge ? ` При желании можно переключить на ${anchorPair.fabricLabel}.` : ''}`);
    } else if (aid === 'pluto' || aid === 'krypton-hybrid') {
      notes.push(`Упор на сетевой стек ${activeAnchor.name}: он заменил стандартный Krypton Reno в сетевом слоте.`);
    } else if (aid === 'accelerated-rendering') {
      if (effectivePrefs.goal === 'potato') effectivePrefs.goal = 'balanced';
      notes.push('Упор на Accelerated Rendering: подключён OpenGL 4.6 GPU-инстансинг сущностей и анимаций GeckoLib.');
    } else if (aid === 'distant-horizons' || aid === 'distant-horizons-memory-fix-dh') {
      notes.push('Упор на Distant Horizons: добавлены DH Memory Fix, Noisiumed и асинхронная подгрузка чанков под сверхдальний LOD.');
    } else if (aid === 'emi' || aid === 'tmrv-updated') {
      notes.push(`Упор на ${activeAnchor.name}: включена экосистема EMI + прослойка TMRV Updated + нативные EMI-плагины.`);
    } else {
      notes.push(`Упор на мод ${activeAnchor.name}: конфликтные аналоги исключены, а недостающие зависимости подтянуты автоматически.`);
    }
  } else if (portStrategy === 'native-forge') {
    notes.push('Режим портов «Нативный Forge»: для C2ME, VMP, GPU-рендера (Alloyium) и сети выбраны прямые Forge-порты без зависимости от Sinytra Connector.');
  } else if (portStrategy === 'fabric-sinytra') {
    notes.push('Режим портов «Fabric + Sinytra»: подключены оригинальные Fabric-версии (Nvidium, C2ME, VMP) через Sinytra Connector (LTS) + Forgified Fabric API.');
  } else {
    notes.push('Режим «Гибрид (Умный баланс)»: VMP и C2ME берутся нативными Forge-портами без лишних миксинов, а для NVIDIA без шейдеров подключается Nvidium через Sinytra.');
  }

  const isPotato = effectivePrefs.goal === 'potato' || effectivePrefs.gpu === 'integrated';
  const isHeavy = effectivePrefs.goal === 'max-safe';
  const isHeavyPack = effectivePrefs.packScale === 'heavy';

  const ids = new Set<string>([
    'embeddium',
    'sodium-chloride',
    'immediatelyfast',
    'kerria',
    'entity-culling',
    'enhanced-block-entities-reloaded',
    'culllessleaves-reforged',
    'modernfix',
    'ferritecore',
    'alltheleaks-memory-leak-fix',
    'jasione',
    'put-a-plug-in-it-papi',
    'radium-re-reforged',
    'badoptimizations',
    'noisiumed',
    'solix',
    'ixeris',
    'dynamic-fps',
    'packet-fixer',
    'fastvancements',
    'clumps',
    'let-me-despawn',
    'falling-blocks-fps-fix',
    'fast-sounds',
    'reload-looping-sound-fix',
    'cloth-config-v12',
    'matlib',
  ]);
  if (!isPotato) {
    ids.add('flerovium');
    ids.add('fast-item-frames');
  }
  if (isHeavyPack) {
    [
      'duplicate-nbt-flattener',
      'capability-fix-revived',
      'structure-dfu-cache',
      'structure-layout-optimizer',
      'broken-tag-fixer',
    ].forEach(id => ids.add(id));
    notes.push('Масштаб «Тяжёлый пак (200+ модов)»: усилена защита от утечек NBT/Capability и структуры DFU.');
  }

  if (recipeViewer === 'jei') {
    ids.add('just-enough-items-jei');
    ids.add('jei-emi-optimizations');
    ids.add('fast-recipe-search');
    if (isHeavy) {
      ids.add('jeioptimizer');
      if (isHeavyPack) {
        ids.add('just-enough-freezes');
        ids.add('just-enough-threads');
      }
    }
    notes.push('Просмотрщик рецептов: Just Enough Items (JEI) + JEI/EMI Optimizations' + (isHeavy ? ' + оптимизация индексации JEI.' : '.'));
    excluded.push({ name: 'EMI / TMRV Updated / EMI Loot', reason: 'Отключены, так как выбран классический режим JEI.' });
  } else if (recipeViewer === 'emi') {
    ids.add('emi');
    ids.add('tmrv-updated');
    ids.add('jei-emi-optimizations');
    ids.add('fast-recipe-search');
    if (isHeavy) {
      ids.add('emi-loot');
      if (isHeavyPack) {
        ids.add('emi-ores');
        ids.add('emiffect');
        ids.add('emi-professions');
        ids.add('emi-trades');
      }
    }
    notes.push('Просмотрщик рецептов: EMI + прослойка TMRV Updated (запускает плагины JEI внутри EMI без самого JEI).');
    excluded.push({ name: 'Just Enough Items (JEI) + JEIOptimizer / Threads', reason: 'Заменены на EMI + TMRV Updated.' });
    if (isHeavy && isHeavyPack) {
      excluded.push({ name: 'JER / JEP / JEED', reason: 'Полностью перекрыты более быстрыми нативными EMI-плагинами (EMI Loot, Ores, EMIffect, Professions, Trades).' });
    }
  } else if (recipeViewer === 'emi-jei') {
    ids.add('emi');
    ids.add('just-enough-items-jei');
    ids.add('jei-emi-optimizations');
    ids.add('fast-recipe-search');
    if (isHeavy) {
      ids.add('emi-loot');
      ids.add('jeioptimizer');
      if (isHeavyPack) {
        ids.add('emi-ores');
        ids.add('emiffect');
        ids.add('emi-professions');
        ids.add('emi-trades');
        ids.add('just-enough-freezes');
        ids.add('just-enough-threads');
      }
    }
    notes.push('Режим EMI + JEI: работают оба просмотрщика (прослойка TMRV Updated отключена, так как EMI нативно подхватывает установленный JEI).');
    excluded.push({ name: 'TMRV Updated', reason: 'Конфликтует с JEI — не нужен при совместной установке EMI + JEI.' });
  } else {
    excluded.push({ name: 'JEI / EMI и их плагины', reason: 'Просмотрщик рецептов отключён в настройках сборки.' });
  }

  if (effectivePrefs.mode === 'hybrid-server') {
    ids.add('krypton-hybrid');
    ids.add('connectivity');
    ids.add('cupboard');
    ids.add('servercore');
    ids.add('fast-ip-ping');
    ids.add('spark');
    notes.push('Выбран Krypton Hybrid (сжатие Zstd и фиксы для гибридных серверов Mohist/Arclight) вместо Krypton Reno.');
    excluded.push({ name: 'Krypton Reno', reason: 'Заменён на Krypton Hybrid для совместимости с гибрид-ядром.' });
  } else {
    ids.add('krypton-reno');
    if (effectivePrefs.mode === 'server') {
      ids.add('servercore');
      ids.add('connectivity');
      ids.add('cupboard');
      ids.add('fast-ip-ping');
      ids.add('spark');
      notes.push('Для сетевой игры добавлены ServerCore, Connectivity (+ Cupboard), Fast IP Ping и Spark.');
    } else {
      ids.add('smooth-boot-reloaded');
      notes.push('Для одиночной игры добавлен Smooth Boot (Reloaded) без лишних серверных/сетевых модов.');
    }
  }

  if (isHeavyPack && !isPotato) {
    [
      'stutterfix-reforged',
      'threadtweak-reforged',
    ].forEach(id => ids.add(id));
  }

  if (effectivePrefs.mode !== 'singleplayer' && (isHeavy || (isHeavyPack && !isPotato))) {
    ids.add('alternate-current');
    ids.add('entity-collision-optimization');
  }

  if (isHeavy) {
    [
      'duplicate-nbt-flattener',
      'capability-fix-revived',
      'structure-dfu-cache',
      'structure-layout-optimizer',
      'lightstar',
      'falling-blocks-fps-fix',
      'stutterfix-reforged',
      'threadtweak-reforged',
      'lightspeedre',
      'fast-item-frames',
      'immersive-optimization',
      'fast-sounds',
      'soundgc',
    ].forEach(id => ids.add(id));
    if (recipeViewer === 'none') {
      ids.add('fastsuite');
    } else {
      excluded.push({
        name: 'FastSuite',
        reason: 'Несовместим с Fast Recipe Search (при активном JEI/EMI предпочтителен хэш-индекс поиска рецептов).',
      });
    }
    if (!isPotato) {
      ids.add('particle-core');
      excluded.push({ name: 'PartiCull', reason: 'Полностью перекрыт Particle Core в максимальной сборке.' });
    }
    if (effectivePrefs.mode === 'singleplayer') {
      excluded.push({ name: 'ServerCore / Connectivity / Cupboard', reason: 'Сетевые моды исключены в одиночном режиме (в соло не дают прироста).' });
    }
    excluded.push({ name: 'RestMode / More Culling / Better Biome Reblend', reason: 'Исключены из-за наложения с Dynamic FPS / CullLessLeaves и архивации Better Biome Reblend.' });
    notes.push(
      `Для максимальной сборки добавлены высокоэффективные моды без раздувания миксинов: Kerria, LightStar, Particle Core, ${
        recipeViewer === 'none' ? 'FastSuite (+ Placebo), ' : ''
      }Structure DFU (+ RinLib)/Layout, Immersive Optimization, Falling Blocks FPS Fix, StutterFix + ThreadTweak и Fast Item Frames (+ Puzzles Lib).`
    );
  } else {
    excluded.push({ name: 'FastSuite / Structure DFU Cache', reason: 'Опциональные кеши для тяжёлых сборок пропущены в лёгком/сбалансированном профиле.' });
  }

  const anchorForcesAlloyium = activeAnchor?.id === 'alloyium' || activeAnchor?.id === 'revidium-accedium';
  const anchorForcesNvidium = activeAnchor?.id === 'nvidium';
  const useNvidium =
    !useEmberlensPipeline &&
    !anchorForcesAlloyium &&
    (anchorForcesNvidium ||
      (effectivePrefs.allowSinytra &&
        portStrategy !== 'native-forge' &&
        effectivePrefs.gpu === 'nvidia' &&
        !effectivePrefs.useShaders &&
        !isPotato));

  if (useEmberlensPipeline) {
    ids.delete('embeddium');
    ids.add('emberbium');
    ids.add('emberlens');
    ids.add('gputape');
    ids.add('shadowlod');
    if (effectivePrefs.useCreate) {
      ids.add('flywheel');
      ids.add('vanillin');
    }
    excluded.push({
      name: 'Embeddium + Oculus + Alloyium + Nvidium',
      reason: 'Заменены на альтернативный шейдерный стек Emberbium + Emberlens.',
    });
  } else if (isPotato && !anchorForcesAlloyium) {
    ids.add('amd-fsr-upscaler-render-scale-for-embeddium');
    ids.add('dynamicrenderdistance');
    ids.add('fast-sounds');
    ids.add('particull');
    ids.add('fast-item-frames');
    ids.add('immersive-optimization');
    notes.push('Режим слабой графики: добавлены AMD FSR апскейлер, DynamicRenderDistance, PartiCull (без тяжёлого Kotlin), Fast Item Frames и Immersive Optimization (без дубля RestMode).');
    excluded.push({ name: 'FastBoot / RestMode / Accelerated Rendering / Alloyium', reason: 'FastBoot встроен в ModernFix, RestMode дублирует Dynamic FPS, а Compute Shaders перегружают слабую GPU.' });
  } else if (!useNvidium) {
    if (activeAnchor?.id === 'emberbium') {
      ids.delete('embeddium');
      ids.add('emberbium');
      notes.push('Выбран Emberbium + Flerovium + Kerria (Alloyium исключён, так как несовместим с Emberbium).');
    } else {
      ids.add('alloyium');
      if (activeAnchor?.id === 'accelerated-rendering') {
        ids.add('accelerated-rendering');
        notes.push('Для дискретной GPU добавлены Alloyium, Flerovium и Accelerated Rendering (OpenGL 4.6 — расходует больше VRAM GPU).');
      } else {
        notes.push('Добавлен Alloyium + Flerovium (нативный Compute-аддон к Embeddium для любых видеокарт без Sinytra и с минимальным риском артефактов).');
      }
    }
  } else {
    const canUseEmberbium =
      activeAnchor?.id !== 'embeddium' &&
      (!activeAnchor || !getRuleConflictingIds('emberbium').includes(activeAnchor.id));
    if (canUseEmberbium) {
      ids.delete('embeddium');
      ids.add('emberbium');
    }
    ids.add('flerovium');
    excluded.push({ name: 'Alloyium', reason: 'Заменён на Nvidium (оба мода перехватывают GPU-рендер чанков).' });
  }

  if (!useEmberlensPipeline && effectivePrefs.useShaders && effectivePrefs.goal !== 'potato') {
    ids.add('oculus');
    ids.add('faster-iris-shadow-mapper');
    ids.add('gputape');
    ids.add('shadowlod');
    notes.push(
      'Активированы шейдеры: Oculus + Faster Iris Shadow Mapper + ShadowLOD + GPUTape (стандартный стек на Embeddium).'
    );
    excluded.push({ name: 'Emberlens', reason: 'Форк Oculus, требующий Emberbium вместо Embeddium (исключён во избежание конфликта).' });
    if (effectivePrefs.allowSinytra) {
      excluded.push({ name: 'Nvidium', reason: 'Жёсткий конфликт с буферами шейдеров Oculus (исключён автоматически).' });
    }
  } else if (effectivePrefs.useShaders && effectivePrefs.goal === 'potato') {
    excluded.push({ name: 'Oculus и шейдеры', reason: 'Пропущены, так как выбрана цель «Слабый ПК».' });
  }

  if (effectivePrefs.useCreate) {
    ids.add('flywheel');
    ids.add('vanillin');
    ids.add('immersive-optimization');
    ids.add('alternate-current');
    ids.add('entity-collision-optimization');
    ids.add('observable');
    notes.push('Для Create/индустрии добавлены Flywheel, Vanillin, Alternate Current, Immersive Optimization и Observable.');
  }

  const useFabricC2ME =
    effectivePrefs.allowSinytra &&
    activeAnchor?.id !== 'concurrent-chunk-management-engine-forge-c2me' &&
    activeAnchor?.id !== 'c2mer' &&
    (activeAnchor?.id === 'c2me-concurrent-chunk-management-engine' ||
      (portStrategy === 'fabric-sinytra' && (effectivePrefs.mode !== 'singleplayer' || isHeavyPack)));

  const useNativeC2MEF =
    !useFabricC2ME &&
    activeAnchor?.id !== 'c2me-concurrent-chunk-management-engine' &&
    (activeAnchor?.id === 'concurrent-chunk-management-engine-forge-c2me' ||
      (!isPotato && (effectivePrefs.mode !== 'singleplayer' || isHeavyPack)));

  const needVmp = effectivePrefs.mode !== 'singleplayer' && (isHeavy || (isHeavyPack && !isPotato));
  const useFabricVMP =
    effectivePrefs.allowSinytra &&
    activeAnchor?.id !== 'vmp-forge' &&
    (activeAnchor?.id === 'very-many-players-vmp' || (portStrategy === 'fabric-sinytra' && needVmp));

  if (useFabricC2ME) {
    ids.add('c2me-concurrent-chunk-management-engine');
    excluded.push({ name: 'C2ME-Forge (C2MEF)', reason: 'Выбран оригинальный Fabric C2ME через Sinytra Connector.' });
  } else if (useNativeC2MEF) {
    ids.add('concurrent-chunk-management-engine-forge-c2me');
    if (effectivePrefs.allowSinytra) {
      excluded.push({ name: 'C2ME (Fabric)', reason: 'Заменён на нативный C2ME-Forge (C2MEF) во избежание конфликтов шины событий.' });
    }
  }

  if (useFabricVMP) {
    ids.add('very-many-players-vmp');
    ids.delete('vmp-forge');
    excluded.push({ name: 'Very Many Players (Forge)', reason: 'Выбрана Fabric-версия VMP через Sinytra Connector.' });
  } else if (needVmp) {
    ids.add('vmp-forge');
    if (effectivePrefs.allowSinytra) {
      excluded.push({ name: 'VMP (Fabric)', reason: 'Выбран нативный VMP (Forge) без конфликтов миксинов через Sinytra.' });
    }
  }

  if (effectivePrefs.allowSinytra) {
    const needsSinytraBridge =
      useNvidium ||
      useFabricC2ME ||
      useFabricVMP ||
      Boolean(activeAnchor?.platform.includes('Sinytra'));

    if (needsSinytraBridge || portStrategy === 'fabric-sinytra') {
      ids.add('sinytra-connector');
      ids.add('forgified-fabric-api');
      ids.add('connector-extras');
    }

    if (useNvidium) {
      ids.add('nvidium');
      notes.push(`Через Sinytra подключён Nvidium (RTX/GTX 16xx+)${ids.has('emberbium') ? ' на базе Emberbium' : ''}. В connector.json добавьте алиас "embeddium": "sodium".`);
    } else if (activeAnchor?.id === 'distant-horizons' || activeAnchor?.id === 'distant-horizons-memory-fix-dh') {
      ids.add('distant-horizons');
      ids.add('distant-horizons-memory-fix-dh');
      notes.push('Подключён Distant Horizons + DH Memory Fix для сверхдальнего LOD.');
    } else if (portStrategy === 'native-forge' && effectivePrefs.gpu === 'nvidia' && !effectivePrefs.useShaders && !isPotato) {
      excluded.push({ name: 'Nvidium', reason: 'Отключён из-за приоритета «Нативный Forge» (используется Alloyium).' });
    } else if (effectivePrefs.gpu !== 'nvidia') {
      excluded.push({ name: 'Nvidium', reason: 'Требует видеокарту NVIDIA (GTX 16xx / RTX 20xx+), заменён на Alloyium.' });
    }
  } else {
    if (activeAnchor?.id === 'distant-horizons' || activeAnchor?.id === 'distant-horizons-memory-fix-dh') {
      ids.add('distant-horizons');
      ids.add('distant-horizons-memory-fix-dh');
    }
    excluded.push({ name: 'Nvidium / C2ME (Fabric) / VMP (Fabric)', reason: 'Прослойка Sinytra Connector выключена — сборка на 100% нативном Forge.' });
  }

  if (activeAnchor && !activeAnchor.coveredBy) {
    for (const cid of getRuleConflictingIds(activeAnchor.id)) {
      if (ids.delete(cid)) {
        const cname = MOD_BY_ID.get(cid)?.name || cid;
        if (!excluded.some(e => e.name === cname)) {
          excluded.push({ name: cname, reason: `Заменён из-за упора сборки на ${activeAnchor.name}.` });
        }
      }
    }

    ids.add(activeAnchor.id);
    for (const depId of getTransitiveDependencies(activeAnchor.id, new Set(), ids)) {
      for (const depConflict of getRuleConflictingIds(depId)) {
        if (ids.delete(depConflict)) {
          const cname = MOD_BY_ID.get(depConflict)?.name || depConflict;
          if (!excluded.some(e => e.name === cname)) {
            excluded.push({ name: cname, reason: `Конфликтует с зависимостью упора (${MOD_BY_ID.get(depId)?.name || depId}).` });
          }
        }
      }
      ids.add(depId);
    }

    let cascadeChanged = true;
    while (cascadeChanged) {
      cascadeChanged = false;
      for (const id of Array.from(ids)) {
        if (getDirectDependencies(id, ids).some(d => !ids.has(d))) {
          ids.delete(id);
          cascadeChanged = true;
        }
      }
    }
  }

  excluded.push(
    { name: 'OptiFine / Xenon / Rubidium', reason: 'Конфликтуют с базовым рендерером.' },
    { name: 'Lithium / Krypton / Indium / DashLoader', reason: 'Fabric-оригиналы заменены на нативные порты Forge (Radium Re-Reforged, Krypton Reno/Hybrid/Pluto, ModernFix).' }
  );

  const cleaned = smartFixAssembly(Array.from(ids), effectivePrefs);
  return { modIds: cleaned, notes, excluded };
}

export function smartFixAssembly(selectedIds: string[], prefs?: AssemblyPreferences): string[] {
  const next = new Set(selectedIds);
  const focusId = prefs?.focusModId || null;

  for (const id of Array.from(next)) {
    const mod = MOD_BY_ID.get(id);
    if (!mod) {
      next.delete(id);
      continue;
    }
    if (isUnsupportedOnForge(mod)) {
      next.delete(id);
      const swap = FABRIC_TO_FORGE_SWAP[id];
      if (swap) next.add(swap);
      continue;
    }
    if (mod.status === 'danger' || mod.coveredBy) {
      next.delete(id);
      continue;
    }
    const isNeoForgeOnly = mod.platform.includes('NeoForge') && !/\bForge\b/.test(mod.platform);
    const isLegacy119 = mod.name.includes('1.19.2');
    if ((isNeoForgeOnly || isLegacy119) && id !== focusId) {
      next.delete(id);
    }
  }

  // Respect recipeViewer preference if explicitly specified
  if (prefs?.recipeViewer) {
    const viewer = prefs.recipeViewer;
    if (viewer === 'emi') {
      if (focusId !== 'just-enough-items-jei') next.delete('just-enough-items-jei');
      for (const id of Array.from(next)) {
        if (id !== focusId && MOD_BY_ID.get(id)?.recipeEcosystem === 'jei-engine') {
          next.delete(id);
        }
      }
    } else if (viewer === 'jei') {
      if (focusId !== 'emi') next.delete('emi');
      if (focusId !== 'tmrv-updated') next.delete('tmrv-updated');
      for (const id of Array.from(next)) {
        if (id !== focusId && MOD_BY_ID.get(id)?.recipeEcosystem === 'emi-only') {
          next.delete(id);
        }
      }
    } else if (viewer === 'emi-jei') {
      if (focusId !== 'tmrv-updated') next.delete('tmrv-updated');
    } else if (viewer === 'none') {
      for (const id of Array.from(next)) {
        if (id === focusId) continue;
        const eco = MOD_BY_ID.get(id)?.recipeEcosystem;
        if (
          id === 'emi' ||
          id === 'just-enough-items-jei' ||
          id === 'tmrv-updated' ||
          eco === 'emi-only' ||
          eco === 'jei-engine' ||
          eco === 'jei-plugin'
        ) {
          next.delete(id);
        }
      }
    }
  }

  // Compute transitive dependency affinity for focusId so dependencies (e.g. emberbium for emberlens) survive engine pools & rules
  const focusDepSet = new Set<string>();
  if (focusId && next.has(focusId)) {
    for (const depId of getTransitiveDependencies(focusId, new Set(), next)) {
      const depMod = MOD_BY_ID.get(depId);
      if (depMod && depMod.status !== 'danger' && !isUnsupportedOnForge(depMod)) {
        focusDepSet.add(depId);
      }
    }
    for (const depId of focusDepSet) {
      for (const cid of getRuleConflictingIds(depId)) {
        if (cid !== focusId && !focusDepSet.has(cid)) {
          next.delete(cid);
        }
      }
      next.add(depId);
    }
    for (const cid of getRuleConflictingIds(focusId)) {
      if (!focusDepSet.has(cid)) {
        next.delete(cid);
      }
    }
  }

  for (const [groupId, pool] of Object.entries(EXCLUSIVE_ENGINE_POOLS)) {
    const g = MOD_GROUPS.find(grp => grp.id === groupId);
    const chosen = pool.filter(id => next.has(id));
    if (chosen.length > 1) {
      chosen.sort((a, b) => {
        if (focusId && a === focusId) return -1;
        if (focusId && b === focusId) return 1;
        const aFocusDep = focusDepSet.has(a);
        const bFocusDep = focusDepSet.has(b);
        if (aFocusDep !== bFocusDep) return aFocusDep ? -1 : 1;
        if (g && a === g.leaderId) return -1;
        if (g && b === g.leaderId) return 1;
        return getModEffectivenessScore(MOD_BY_ID.get(b)!) - getModEffectivenessScore(MOD_BY_ID.get(a)!);
      });
      chosen.slice(1).forEach(id => next.delete(id));
    }
  }

  if (next.has('nvidium') && next.has('oculus')) {
    if (focusId === 'nvidium') next.delete('oculus');
    else if (focusId === 'oculus') {
      next.delete('nvidium');
    } else if (prefs?.useShaders) {
      next.delete('nvidium');
    } else {
      next.delete('oculus');
    }
  }
  if (next.has('nvidium') && next.has('emberlens')) {
    if (focusId === 'nvidium') next.delete('emberlens');
    else if (focusId === 'emberlens' || focusId === 'emberbium') {
      next.delete('nvidium');
    } else if (prefs?.useShaders) {
      next.delete('nvidium');
    } else {
      next.delete('emberlens');
    }
  }
  if (next.has('nvidium') && next.has('alloyium')) {
    if (focusId === 'alloyium') {
      next.delete('nvidium');
    } else if (focusId === 'nvidium') {
      next.delete('alloyium');
    } else {
      const keepNvidium =
        prefs?.gpu === 'nvidia' &&
        !prefs?.useShaders &&
        prefs?.allowSinytra !== false &&
        prefs?.portStrategy !== 'native-forge';
      if (keepNvidium) {
        next.delete('alloyium');
      } else {
        next.delete('nvidium');
      }
    }
  }
  if (next.has('nvidium') && next.has('revidium-accedium')) {
    if (focusId === 'revidium-accedium') {
      next.delete('nvidium');
    } else {
      next.delete('revidium-accedium');
    }
  }
  if (next.has('alloyium') && next.has('revidium-accedium')) {
    next.delete(focusId === 'revidium-accedium' ? 'alloyium' : 'revidium-accedium');
  }
  if (next.has('revidium-accedium') && (next.has('oculus') || next.has('emberlens'))) {
    if (focusId === 'revidium-accedium') {
      next.delete('oculus');
      next.delete('emberlens');
    } else {
      next.delete('revidium-accedium');
    }
  }
  if (next.has('oculus') && next.has('emberlens')) {
    if (focusId === 'emberlens' || focusId === 'emberbium' || (next.has('emberbium') && !next.has('embeddium'))) {
      next.delete('oculus');
    } else {
      next.delete('emberlens');
    }
  }
  if (next.has('c2me-concurrent-chunk-management-engine') && next.has('concurrent-chunk-management-engine-forge-c2me')) {
    if (focusId === 'concurrent-chunk-management-engine-forge-c2me') {
      next.delete('c2me-concurrent-chunk-management-engine');
    } else if (focusId === 'c2me-concurrent-chunk-management-engine') {
      next.delete('concurrent-chunk-management-engine-forge-c2me');
    } else if (prefs?.portStrategy === 'fabric-sinytra') {
      next.delete('concurrent-chunk-management-engine-forge-c2me');
    } else {
      next.delete('c2me-concurrent-chunk-management-engine');
    }
  }
  if (next.has('c2mer') && (next.has('c2me-concurrent-chunk-management-engine') || next.has('concurrent-chunk-management-engine-forge-c2me'))) {
    if (focusId === 'c2mer') {
      next.delete('c2me-concurrent-chunk-management-engine');
      next.delete('concurrent-chunk-management-engine-forge-c2me');
    } else {
      next.delete('c2mer');
    }
  }
  if (
    next.has('hc-harichunk') &&
    (next.has('c2me-concurrent-chunk-management-engine') ||
      next.has('concurrent-chunk-management-engine-forge-c2me') ||
      next.has('c2mer'))
  ) {
    if (focusId === 'hc-harichunk') {
      next.delete('c2me-concurrent-chunk-management-engine');
      next.delete('concurrent-chunk-management-engine-forge-c2me');
      next.delete('c2mer');
    } else {
      next.delete('hc-harichunk');
    }
  }
  if (next.has('vmp-forge') && next.has('very-many-players-vmp')) {
    if (focusId === 'very-many-players-vmp') next.delete('vmp-forge');
    else if (focusId === 'vmp-forge') next.delete('very-many-players-vmp');
    else if (prefs?.portStrategy === 'fabric-sinytra') next.delete('vmp-forge');
    else next.delete('very-many-players-vmp');
  }
  if (next.has('noisiumed') && next.has('noisium')) {
    next.delete(focusId === 'noisium' ? 'noisiumed' : 'noisium');
  }
  if (next.has('dynamicrenderdistance') && next.has('drd-dynamic-render-distance')) {
    next.delete(focusId === 'drd-dynamic-render-distance' ? 'dynamicrenderdistance' : 'drd-dynamic-render-distance');
  }
  if (next.has('modernfix') && next.has('dashloader')) {
    next.delete('dashloader');
  }
  if (next.has('jasione') && next.has('redirected')) next.delete('redirected');
  if (next.has('jasione') && next.has('redirector-modern')) next.delete('redirector-modern');
  if (next.has('krypton-hybrid') && next.has('aegisnetworking-krypton-hybrid')) {
    next.delete(focusId === 'aegisnetworking-krypton-hybrid' ? 'krypton-hybrid' : 'aegisnetworking-krypton-hybrid');
  }
  if (next.has('tmrv-updated') && next.has('just-enough-items-jei')) {
    if (focusId === 'tmrv-updated') next.delete('just-enough-items-jei');
    else if (focusId === 'just-enough-items-jei') next.delete('tmrv-updated');
    else if (prefs?.recipeViewer === 'emi') next.delete('just-enough-items-jei');
    else next.delete('tmrv-updated');
  }
  if (next.has('accelerated-rendering') && next.has('accelerated-rendering-turned')) {
    next.delete(focusId === 'accelerated-rendering-turned' ? 'accelerated-rendering' : 'accelerated-rendering-turned');
  }
  if (next.has('sodium-chloride') && next.has('sodium-embeddium-dynamic-lights')) {
    if (focusId === 'sodium-embeddium-dynamic-lights') next.delete('sodium-chloride');
    else next.delete('sodium-embeddium-dynamic-lights');
  }
  if (next.has('geckolibbetterfps') && next.has('geckolib-animation-optimizer')) {
    if (focusId === 'geckolib-animation-optimizer') next.delete('geckolibbetterfps');
    else next.delete('geckolib-animation-optimizer');
  }
  if (next.has('dynamic-fps') && next.has('idle-boost')) {
    if (focusId === 'idle-boost') next.delete('dynamic-fps');
    else next.delete('idle-boost');
  }
  if (next.has('dynamic-fps') && next.has('restmode')) {
    if (focusId === 'restmode') next.delete('dynamic-fps');
    else next.delete('restmode');
  }
  if (next.has('fast-recipe-search') && next.has('fastsuite')) {
    if (focusId === 'fastsuite') next.delete('fast-recipe-search');
    else next.delete('fastsuite');
  }
  if (next.has('prismanium') && next.has('sodium-embeddium-dynamic-lights')) {
    if (focusId === 'sodium-embeddium-dynamic-lights') next.delete('prismanium');
    else next.delete('sodium-embeddium-dynamic-lights');
  }
  if (next.has('distant-horizons')) {
    if (next.has('bobby-reforged')) {
      if (focusId === 'bobby-reforged') next.delete('distant-horizons');
      else next.delete('bobby-reforged');
    }
    if (next.has('farsight')) {
      if (focusId === 'farsight') next.delete('distant-horizons');
      else next.delete('farsight');
    }
  }
  if (next.has('servercore')) {
    for (const adaptiveId of ['adaptive-performance-tweaks', 'adaptive-optimization-reborn'] as const) {
      if (next.has(adaptiveId)) {
        if (focusId === adaptiveId) next.delete('servercore');
        else next.delete(adaptiveId);
      }
    }
  }
  if (next.has('mob-collision-off')) {
    for (const colId of ['farmcollisionless', 'entity-collision-optimization'] as const) {
      if (next.has(colId)) {
        if (focusId === colId) next.delete('mob-collision-off');
        else next.delete(colId);
      }
    }
  }
  if (next.has('particle-core') && next.has('asyncparticles')) {
    if (focusId === 'asyncparticles') next.delete('particle-core');
    else next.delete('asyncparticles');
  }
  if (next.has('immersive-optimization')) {
    for (const sleepId of ['entitysleep', 'enttick', 'sleepium', 'martensite-entity-tick-skiper'] as const) {
      if (next.has(sleepId)) {
        if (focusId === sleepId) next.delete('immersive-optimization');
        else next.delete(sleepId);
      }
    }
  }
  const hasC2meInNext =
    next.has('concurrent-chunk-management-engine-forge-c2me') ||
    next.has('c2me-concurrent-chunk-management-engine') ||
    next.has('c2mer');
  if (hasC2meInNext) {
    for (const saveId of ['parallel-world-save', 'delta-chunk'] as const) {
      if (next.has(saveId)) {
        if (focusId === saveId) {
          next.delete('concurrent-chunk-management-engine-forge-c2me');
          next.delete('c2me-concurrent-chunk-management-engine');
          next.delete('c2mer');
        } else {
          next.delete(saveId);
        }
      }
    }
  }
  if (next.has('parallel-world-save') && next.has('delta-chunk')) {
    if (focusId === 'delta-chunk') next.delete('parallel-world-save');
    else next.delete('delta-chunk');
  }
  if (next.has('resourcepackcached')) {
    for (const rpId of ['keep-the-resourcepack', 'packforge'] as const) {
      if (next.has(rpId)) {
        if (focusId === rpId) next.delete('resourcepackcached');
        else next.delete(rpId);
      }
    }
  } else if (next.has('keep-the-resourcepack') && next.has('packforge')) {
    if (focusId === 'packforge') next.delete('keep-the-resourcepack');
    else next.delete('packforge');
  }

  for (const id of Array.from(next)) {
    if (focusId && id === focusId) continue;
    const mod = MOD_BY_ID.get(id);
    if (!mod) continue;
    const sup = getModSuperseder(mod, next, prefs, false);
    if (sup?.isActiveInSelection) {
      next.delete(id);
    }
  }

  // Generic residual conflict sweep: guarantees 0 rule conflicts for any arbitrary combination of mods
  let conflictPass = 0;
  while (conflictPass < 16) {
    conflictPass++;
    const currentAnalysis = analyzeSelection(Array.from(next));
    if (currentAnalysis.conflicts.length === 0) break;
    let resolvedAny = false;
    for (const conflict of currentAnalysis.conflicts) {
      const presentIds = conflict.matchedIds.filter(id => next.has(id));
      if (presentIds.length <= 1) continue;
      presentIds.sort((a, b) => {
        if (focusId && a === focusId) return -1;
        if (focusId && b === focusId) return 1;
        const aFocusDep = focusDepSet.has(a);
        const bFocusDep = focusDepSet.has(b);
        if (aFocusDep !== bFocusDep) return aFocusDep ? -1 : 1;
        const ma = MOD_BY_ID.get(a);
        const mb = MOD_BY_ID.get(b);
        const aLeader = ma?.isGroupLeader ? 1 : 0;
        const bLeader = mb?.isGroupLeader ? 1 : 0;
        if (bLeader !== aLeader) return bLeader - aLeader;
        return (mb ? getModEffectivenessScore(mb) : 0) - (ma ? getModEffectivenessScore(ma) : 0);
      });
      for (const loser of presentIds.slice(1)) {
        next.delete(loser);
        resolvedAny = true;
      }
    }
    if (!resolvedAny) break;
  }

  let pruneOrphans = true;
  while (pruneOrphans) {
    pruneOrphans = false;
    for (const id of Array.from(next)) {
      const deps = getDirectDependencies(id, next);
      if (deps.some(d => !next.has(d) && getRuleConflictingIds(d).some(c => next.has(c)))) {
        next.delete(id);
        pruneOrphans = true;
      }
    }
  }

  for (const id of Array.from(next)) {
    for (const dep of getTransitiveDependencies(id, new Set(), next)) {
      if (!getRuleConflictingIds(dep).some(c => next.has(c))) {
        next.add(dep);
      }
    }
  }

  if (
    (next.has('c2me-concurrent-chunk-management-engine') ||
      next.has('concurrent-chunk-management-engine-forge-c2me') ||
      next.has('c2mer')) &&
    focusId !== 'canary' &&
    focusId !== 'radium-reforged'
  ) {
    let swappedOldLithium = false;
    if (next.delete('canary')) swappedOldLithium = true;
    if (next.delete('radium-reforged')) swappedOldLithium = true;
    if (swappedOldLithium && !next.has('radium-re-reforged') && !getRuleConflictingIds('radium-re-reforged').some(c => next.has(c))) {
      next.add('radium-re-reforged');
    }
  }

  // Auto-add paired companion fixes flagged by analyzeSelection
  if (next.has('calm-the-leaks') && !next.has('alltheleaks-memory-leak-fix')) {
    next.add('alltheleaks-memory-leak-fix');
  }
  if (next.has('advanced-loot-info-ali') && !next.has('fastali')) {
    next.add('fastali');
  }
  if (
    next.has('distant-horizons') &&
    (next.has('oculus') || next.has('emberlens')) &&
    !next.has('distant-horizons-memory-fix-dh')
  ) {
    next.add('distant-horizons-memory-fix-dh');
  }
  if (next.has('c2me-concurrent-chunk-management-engine') && !next.has('connector-extras')) {
    next.add('connector-extras');
  }

  // Clean orphaned mod-specific libraries whose consumers are not present
  const strictSinglePurposeLibs: Array<[string, string[]]> = [
    ['matlib', LIBRARY_CONSUMER_MAP['matlib']],
    ['cupboard', LIBRARY_CONSUMER_MAP['cupboard']],
    ['fzzy-config', LIBRARY_CONSUMER_MAP['fzzy-config']],
    ['resourceful-config', LIBRARY_CONSUMER_MAP['resourceful-config']],
    ['sodium-embeddium-options-api', LIBRARY_CONSUMER_MAP['sodium-embeddium-options-api']],
    ['puzzles-lib', LIBRARY_CONSUMER_MAP['puzzles-lib']],
    ['almanac', LIBRARY_CONSUMER_MAP['almanac']],
    ['placebo', LIBRARY_CONSUMER_MAP['placebo']],
    ['architectury-api', LIBRARY_CONSUMER_MAP['architectury-api']],
    ['rinlib', LIBRARY_CONSUMER_MAP['rinlib']],
    ['accelerated-recoiling', ['accelerated-rendering', 'accelerated-rendering-turned']],
  ];
  for (const [libId, consumers] of strictSinglePurposeLibs) {
    if (next.has(libId) && idNotProtected(libId, focusId, focusDepSet)) {
      if (!consumers.some(c => next.has(c))) {
        next.delete(libId);
      }
    }
  }

  // Clean orphaned Sinytra bridge mods when zero Sinytra/FFAPI consumers remain and other mods are present
  const hasAnySinytraConsumer = Array.from(next).some(id => MOD_BY_ID.get(id)?.platform.includes('Sinytra'));
  const hasNonBridgeMod = Array.from(next).some(id => !SINYTRA_BRIDGE_IDS.has(id));
  if (!hasAnySinytraConsumer && hasNonBridgeMod) {
    for (const bridgeId of SINYTRA_BRIDGE_IDS) {
      const stillRequiredByRemaining = Array.from(next).some(
        id => !SINYTRA_BRIDGE_IDS.has(id) && getDirectDependencies(id, next).includes(bridgeId)
      );
      if (!stillRequiredByRemaining && idNotProtected(bridgeId, focusId, focusDepSet)) {
        next.delete(bridgeId);
      }
    }
  }

  return Array.from(next);
}

function idNotProtected(id: string, focusId: string | null, focusDepSet: Set<string>): boolean {
  return id !== focusId && !focusDepSet.has(id);
}

export function toggleModSmart(
  currentIds: string[],
  modId: string,
  options: { strict: boolean; prefs?: AssemblyPreferences }
): SmartToggleResult {
  const mod = MOD_BY_ID.get(modId);
  if (!mod) return { nextIds: currentIds, notice: null, noticeTone: 'info' };

  const currentSet = new Set(currentIds);

  if (currentSet.has(modId)) {
    const next = new Set(currentIds);
    next.delete(modId);

    if (!options.strict) {
      return { nextIds: Array.from(next), notice: null, noticeTone: 'info' };
    }

    const removedIdSet = new Set<string>([modId]);
    const removedDependents: string[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of Array.from(next)) {
        const depMod = MOD_BY_ID.get(id);
        const deps = getDirectDependencies(id, next);
        const pluginLostAllHosts =
          depMod?.recipeEcosystem === 'jei-plugin' &&
          !next.has('just-enough-items-jei') &&
          !(next.has('emi') && next.has('tmrv-updated'));
        if (deps.some(d => !next.has(d)) || pluginLostAllHosts) {
          next.delete(id);
          removedIdSet.add(id);
          removedDependents.push(depMod?.name || id);
          changed = true;
        }
      }
    }

    // Clean orphaned single-purpose libraries whose evicted consumer left them unused
    const singlePurposeLibs: Array<[string, string[]]> = [
      ['matlib', LIBRARY_CONSUMER_MAP['matlib']],
      ['cupboard', LIBRARY_CONSUMER_MAP['cupboard']],
      ['fzzy-config', LIBRARY_CONSUMER_MAP['fzzy-config']],
      ['resourceful-config', LIBRARY_CONSUMER_MAP['resourceful-config']],
      ['sodium-embeddium-options-api', LIBRARY_CONSUMER_MAP['sodium-embeddium-options-api']],
      ['puzzles-lib', LIBRARY_CONSUMER_MAP['puzzles-lib']],
      ['almanac', LIBRARY_CONSUMER_MAP['almanac']],
      ['placebo', LIBRARY_CONSUMER_MAP['placebo']],
      ['architectury-api', LIBRARY_CONSUMER_MAP['architectury-api']],
      ['rinlib', LIBRARY_CONSUMER_MAP['rinlib']],
    ];
    for (const [libId, consumers] of singlePurposeLibs) {
      if (next.has(libId) && consumers.some(c => removedIdSet.has(c)) && !consumers.some(c => next.has(c))) {
        next.delete(libId);
        removedDependents.push(MOD_BY_ID.get(libId)?.name || libId);
      }
    }

    // If last Sinytra consumer was removed and other Forge mods remain, clean up idle bridge mods
    if (mod.platform.includes('Sinytra')) {
      const hasSinytraLeft = Array.from(next).some(id => MOD_BY_ID.get(id)?.platform.includes('Sinytra'));
      const hasOtherMods = Array.from(next).some(id => !SINYTRA_BRIDGE_IDS.has(id));
      if (!hasSinytraLeft && hasOtherMods) {
        for (const bridgeId of SINYTRA_BRIDGE_IDS) {
          const stillRequired = Array.from(next).some(
            id => !SINYTRA_BRIDGE_IDS.has(id) && getDirectDependencies(id, next).includes(bridgeId)
          );
          if (!stillRequired && next.delete(bridgeId)) {
            removedDependents.push(MOD_BY_ID.get(bridgeId)?.name || bridgeId);
          }
        }
      }
    }

    return {
      nextIds: Array.from(next),
      notice:
        removedDependents.length > 0
          ? `Убран ${mod.name} и зависимые от него моды: ${removedDependents.join(', ')}.`
          : null,
      noticeTone: 'info',
    };
  }

  if (!options.strict) {
    return { nextIds: [...currentIds, modId], notice: null, noticeTone: 'info' };
  }

  if (mod.status === 'danger') {
    return {
      nextIds: currentIds,
      notice: `${mod.name} заблокирован умной защитой: ${mod.warning || 'плацебо или высокий риск краша'}. Отключите режим 1-слота для ручного теста.`,
      noticeTone: 'warn',
    };
  }

  if (isUnsupportedOnForge(mod)) {
    const swapId = FABRIC_TO_FORGE_SWAP[mod.id];
    if (swapId && MOD_BY_ID.has(swapId)) {
      const swapped = toggleModSmart(currentIds, swapId, options);
      const swapName = MOD_BY_ID.get(swapId)!.name;
      return {
        nextIds: swapped.nextIds,
        notice: `${mod.name} не работает на Forge 1.20.1 — автоматически подключён Forge-порт ${swapName}.`,
        noticeTone: 'info',
      };
    }
    return {
      nextIds: currentIds,
      notice: `${mod.name} не работает на Forge 1.20.1 (${mod.bestAlternative || 'несовместим даже через Sinytra'}).`,
      noticeTone: 'warn',
    };
  }

  if (mod.coveredBy) {
    return {
      nextIds: currentIds,
      notice: `${mod.name} не нужен — его функции уже встроены в ${mod.coveredBy}.`,
      noticeTone: 'warn',
    };
  }

  const next = new Set(currentIds);
  const removedNames: string[] = [];
  const evictedIds = new Set<string>();
  const addedDeps: string[] = [];

  if (
    options.prefs?.recipeViewer === 'emi' &&
    mod.recipeEcosystem === 'jei-plugin' &&
    !next.has('emi') &&
    !next.has('just-enough-items-jei')
  ) {
    next.add('emi');
    addedDeps.push(MOD_BY_ID.get('emi')?.name || 'EMI');
  }

  const conflictingIds = getRuleConflictingIds(modId);
  for (const cid of conflictingIds) {
    if (next.has(cid)) {
      next.delete(cid);
      evictedIds.add(cid);
      removedNames.push(MOD_BY_ID.get(cid)?.name || cid);
    }
  }

  next.add(modId);
  for (const depId of getTransitiveDependencies(modId, new Set(), next)) {
    if (!next.has(depId)) {
      for (const depConflict of getRuleConflictingIds(depId)) {
        if (next.has(depConflict)) {
          next.delete(depConflict);
          evictedIds.add(depConflict);
          removedNames.push(MOD_BY_ID.get(depConflict)?.name || depConflict);
        }
      }
      next.add(depId);
      addedDeps.push(MOD_BY_ID.get(depId)?.name || depId);
    }
  }

  const addCompanionIfSafe = (companionId: string) => {
    if (next.has(companionId)) return;
    if (getRuleConflictingIds(companionId).some(cid => next.has(cid))) return;
    next.add(companionId);
    addedDeps.push(MOD_BY_ID.get(companionId)?.name || companionId);
    for (const cdep of getTransitiveDependencies(companionId, new Set(), next)) {
      if (!next.has(cdep) && !getRuleConflictingIds(cdep).some(cid => next.has(cid))) {
        next.add(cdep);
        addedDeps.push(MOD_BY_ID.get(cdep)?.name || cdep);
      }
    }
  };

  if (modId === 'calm-the-leaks') {
    addCompanionIfSafe('alltheleaks-memory-leak-fix');
  }
  if (modId === 'advanced-loot-info-ali') {
    addCompanionIfSafe('fastali');
  }
  if (modId === 'c2me-concurrent-chunk-management-engine') {
    addCompanionIfSafe('connector-extras');
  }
  if (
    next.has('distant-horizons') &&
    (next.has('oculus') || next.has('emberlens')) &&
    (modId === 'distant-horizons' || modId === 'oculus' || modId === 'emberlens')
  ) {
    addCompanionIfSafe('distant-horizons-memory-fix-dh');
  }
  if (
    (modId === 'c2me-concurrent-chunk-management-engine' ||
      modId === 'concurrent-chunk-management-engine-forge-c2me' ||
      modId === 'c2mer') &&
    (next.has('canary') || next.has('radium-reforged'))
  ) {
    for (const oldLithiumId of ['canary', 'radium-reforged']) {
      if (next.delete(oldLithiumId)) {
        evictedIds.add(oldLithiumId);
        removedNames.push(MOD_BY_ID.get(oldLithiumId)?.name || oldLithiumId);
      }
    }
    if (!next.has('radium-re-reforged') && !getRuleConflictingIds('radium-re-reforged').some(cid => next.has(cid))) {
      next.add('radium-re-reforged');
      addedDeps.push(MOD_BY_ID.get('radium-re-reforged')?.name || 'Radium Re-Reforged');
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Array.from(next)) {
      if (getDirectDependencies(id, next).some(d => !next.has(d))) {
        next.delete(id);
        evictedIds.add(id);
        removedNames.push(MOD_BY_ID.get(id)?.name || id);
        changed = true;
      }
    }
  }

  // Clean orphaned single-purpose libraries or idle Sinytra bridges if conflict eviction removed their consumers
  if (evictedIds.size > 0) {
    const singlePurposeLibs: Array<[string, string[]]> = [
      ['matlib', LIBRARY_CONSUMER_MAP['matlib']],
      ['cupboard', LIBRARY_CONSUMER_MAP['cupboard']],
      ['fzzy-config', LIBRARY_CONSUMER_MAP['fzzy-config']],
      ['resourceful-config', LIBRARY_CONSUMER_MAP['resourceful-config']],
      ['sodium-embeddium-options-api', LIBRARY_CONSUMER_MAP['sodium-embeddium-options-api']],
      ['puzzles-lib', LIBRARY_CONSUMER_MAP['puzzles-lib']],
      ['almanac', LIBRARY_CONSUMER_MAP['almanac']],
      ['placebo', LIBRARY_CONSUMER_MAP['placebo']],
      ['architectury-api', LIBRARY_CONSUMER_MAP['architectury-api']],
      ['rinlib', LIBRARY_CONSUMER_MAP['rinlib']],
    ];
    for (const [libId, consumers] of singlePurposeLibs) {
      if (libId !== modId && next.has(libId) && consumers.some(c => evictedIds.has(c)) && !consumers.some(c => next.has(c))) {
        next.delete(libId);
        removedNames.push(MOD_BY_ID.get(libId)?.name || libId);
      }
    }

    if (!SINYTRA_BRIDGE_IDS.has(modId)) {
      const hasSinytraLeft = Array.from(next).some(id => MOD_BY_ID.get(id)?.platform.includes('Sinytra'));
      const hasOtherMods = Array.from(next).some(id => !SINYTRA_BRIDGE_IDS.has(id));
      if (!hasSinytraLeft && hasOtherMods) {
        for (const bridgeId of SINYTRA_BRIDGE_IDS) {
          const stillRequired = Array.from(next).some(
            id => !SINYTRA_BRIDGE_IDS.has(id) && getDirectDependencies(id, next).includes(bridgeId)
          );
          if (!stillRequired && next.delete(bridgeId)) {
            removedNames.push(MOD_BY_ID.get(bridgeId)?.name || bridgeId);
          }
        }
      }
    }
  }

  const parts: string[] = [];
  if (addedDeps.length > 0) parts.push(`добраны зависимости: ${addedDeps.join(', ')}`);
  if (removedNames.length > 0) parts.push(`заменены конфликтные: ${removedNames.join(', ')}`);

  return {
    nextIds: Array.from(next),
    notice: parts.length > 0 ? `${mod.name} выбран — ${parts.join('; ')}.` : null,
    noticeTone: 'info',
  };
}

export function removeModsCascade(currentIds: string[], removeIds: string[]): { nextIds: string[]; cascadedNames: string[] } {
  const next = new Set(currentIds);
  const removedIdSet = new Set<string>();
  for (const rid of removeIds) {
    if (next.delete(rid)) {
      removedIdSet.add(rid);
    }
  }
  const cascadedNames: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Array.from(next)) {
      const depMod = MOD_BY_ID.get(id);
      const pluginLostAllHosts =
        depMod?.recipeEcosystem === 'jei-plugin' &&
        !next.has('just-enough-items-jei') &&
        !(next.has('emi') && next.has('tmrv-updated'));
      if (getDirectDependencies(id, next).some(d => !next.has(d)) || pluginLostAllHosts) {
        next.delete(id);
        removedIdSet.add(id);
        cascadedNames.push(depMod?.name || id);
        changed = true;
      }
    }
  }

  const singlePurposeLibs: Array<[string, string[]]> = [
    ['matlib', LIBRARY_CONSUMER_MAP['matlib']],
    ['cupboard', LIBRARY_CONSUMER_MAP['cupboard']],
    ['fzzy-config', LIBRARY_CONSUMER_MAP['fzzy-config']],
    ['resourceful-config', LIBRARY_CONSUMER_MAP['resourceful-config']],
    ['sodium-embeddium-options-api', LIBRARY_CONSUMER_MAP['sodium-embeddium-options-api']],
    ['puzzles-lib', LIBRARY_CONSUMER_MAP['puzzles-lib']],
    ['almanac', LIBRARY_CONSUMER_MAP['almanac']],
    ['placebo', LIBRARY_CONSUMER_MAP['placebo']],
    ['architectury-api', LIBRARY_CONSUMER_MAP['architectury-api']],
    ['rinlib', LIBRARY_CONSUMER_MAP['rinlib']],
  ];
  for (const [libId, consumers] of singlePurposeLibs) {
    if (next.has(libId) && consumers.some(c => removedIdSet.has(c)) && !consumers.some(c => next.has(c))) {
      next.delete(libId);
      cascadedNames.push(MOD_BY_ID.get(libId)?.name || libId);
    }
  }

  const removedAnySinytraConsumer = Array.from(removedIdSet).some(
    id => MOD_BY_ID.get(id)?.platform.includes('Sinytra')
  );
  if (removedAnySinytraConsumer) {
    const hasSinytraLeft = Array.from(next).some(id => MOD_BY_ID.get(id)?.platform.includes('Sinytra'));
    const hasOtherMods = Array.from(next).some(id => !SINYTRA_BRIDGE_IDS.has(id));
    if (!hasSinytraLeft && hasOtherMods) {
      for (const bridgeId of SINYTRA_BRIDGE_IDS) {
        const stillRequired = Array.from(next).some(
          id => !SINYTRA_BRIDGE_IDS.has(id) && getDirectDependencies(id, next).includes(bridgeId)
        );
        if (!stillRequired && next.delete(bridgeId)) {
          cascadedNames.push(MOD_BY_ID.get(bridgeId)?.name || bridgeId);
        }
      }
    }
  }

  return { nextIds: Array.from(next), cascadedNames };
}
