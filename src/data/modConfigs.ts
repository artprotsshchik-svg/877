export const NVIDIUM_CONFIG_CONTENT = `{
  "automatic_memory": true,
  "max_geometry_memory": 2048,
  "enable_temporal_coherency": true,
  "async_bfs": true,
  "ignore_driver_blacklist": false,
  "region_keep_distance": 32,
  "translucency_sorting_level": "QUADS"
}`;

export interface ModConfigEntry {
  modId: string;
  modName: string;
  filePath: string;
  title: string;
  note: string;
  content: string;
}

export const MOD_RECOMMENDED_CONFIGS: ModConfigEntry[] = [
  {
    modId: 'nvidium',
    modName: 'Nvidium',
    filePath: 'config/nvidium.json',
    title: 'Базовый конфиг Nvidium (управление VRAM и дальностью)',
    note: 'Требует NVIDIA GTX 16xx / RTX 20xx+, отключённых шейдеров и алиаса sodium в config/connector.json при работе через Sinytra.',
    content: NVIDIUM_CONFIG_CONTENT,
  },
  {
    modId: 'sinytra-connector',
    modName: 'Sinytra Connector',
    filePath: 'config/connector.json',
    title: 'Алиас Embeddium → Sodium для Fabric-аддонов',
    note: 'Позволяет Fabric-модам (в т.ч. Nvidium) видеть Embeddium как Sodium.',
    content: `{
  "version": 1,
  "hiddenMods": [],
  "dependencyOverrides": {
    "nvidium": {
      "sodium": ">=0.5.0"
    }
  }
}`,
  },
  {
    modId: 'concurrent-chunk-management-engine-forge-c2me',
    modName: 'C2ME-Forge (C2MEF)',
    filePath: 'config/c2me.toml',
    title: 'Стабильные потоки генерации чанков на Forge',
    note: 'Отключение noTickViewDistance предотвращает конфликты миксинов и утечки чанков. Для сборок с Terralith / Alex\'s Caves ограничивайте globalExecutorParallelism до числа физических ядер CPU.',
    content: `[noTickViewDistance]
enabled = false

[generalConfig]
globalExecutorParallelism = 4

[ioSystem]
asyncChunkio = true`,
  },
  {
    modId: 'c2me-concurrent-chunk-management-engine',
    modName: 'C2ME (Fabric через Sinytra)',
    filePath: 'config/c2me.toml',
    title: 'Безопасный режим C2ME через Sinytra Connector',
    note: 'Обязательно выключите noTickViewDistance при запуске поверх Forge 1.20.1 и ограничьте globalExecutorParallelism под число физических ядер (особенно с Terralith / Alex\'s Caves).',
    content: `[noTickViewDistance]
enabled = false

[generalConfig]
globalExecutorParallelism = 4`,
  },
  {
    modId: 'modernfix',
    modName: 'ModernFix',
    filePath: 'config/modernfix-mixins.properties',
    title: 'Рекомендуемые флаги памяти и запуска',
    note: 'Dynamic Resources экономит до 30–50% RAM на ресурсах модов. Если Create или Distant Horizons нестабильны, отключите только dynamic_resources (ценой +0.5–1.5 ГБ ОЗУ).',
    content: `mixin.perf.dynamic_resources=true
mixin.perf.faster_item_rendering=true`,
  },
  {
    modId: 'sodium-chloride',
    modName: '(Sodium) Chloride',
    filePath: 'config/chloride-client.toml',
    title: 'Отключение дублей при совместной работе с Dynamic Lights',
    note: 'Если установлен отдельный Sodium/Embeddium Dynamic Lights, отключите свет в Chloride.',
    content: `[general]
fullbright = false
[dynamicLights]
mode = "OFF"`,
  },
  {
    modId: 'particle-core',
    modName: 'Particle Core',
    filePath: 'config/particle_core.json',
    title: 'Оптимизация частиц и отсечение за стенами',
    note: 'Снижает нагрузку от частиц без удаления визуально важных эффектов.',
    content: `{
  "cullParticlesInSight": true,
  "reduceAllChance": 0.0,
  "maxParticles": 4000
}`,
  },
  {
    modId: 'gputape',
    modName: 'GPUTape',
    filePath: 'config/gputape.toml',
    title: 'Безопасная очистка VRAM вместе с шейдерами Oculus / Emberlens',
    note: 'Режим RBO depth ломает буферы глубины шейдерпаков — держите его выключенным при игре с Oculus.',
    content: `[experimental]
useRboDepth = false`,
  },
  {
    modId: 'immediatelyfast',
    modName: 'ImmediatelyFast',
    filePath: 'config/immediatelyfast.json',
    title: 'Тонкая настройка батчинга при работе с Oculus и тяжёлым HUD',
    note: 'Если с шейдерами Oculus мерцает HUD, шрифт или таблички, отключите hud_batching или sign_text_buffering.',
    content: `{
  "hud_batching": true,
  "font_atlas_resizing": true,
  "map_atlas_generation": true,
  "experimental_sign_text_buffering": false
}`,
  },
  {
    modId: 'radium-re-reforged',
    modName: 'Radium Re-Reforged',
    filePath: 'config/radium.properties',
    title: 'Совместимость редстоуна (при использовании Alternate Current / сложных схем)',
    note: 'Если установлен Alternate Current или есть редкий редстоун-механизм на точных таймингах, модуль redstone в Radium можно отключить.',
    content: `mixin.block.redstone=false`,
  },
  {
    modId: 'distant-horizons',
    modName: 'Distant Horizons',
    filePath: 'config/DistantHorizons.toml',
    title: 'Снижение нагрузки на CPU при совместной работе с C2ME',
    note: 'При одновременной работе Distant Horizons и C2ME ограничьте нагрузку на процессор до BALANCED или LOW_IMPACT, чтобы избежать микростаттеров.',
    content: `[client.advanced.multiThreading]
numberOfThreads = 2
threadPriority = "BALANCED"`,
  },
  {
    modId: 'entity-culling',
    modName: 'Entity Culling',
    filePath: 'config/entityculling.json',
    title: 'Белый список механизмов Create и контейнеров при мерцании за стенами',
    note: 'Если крупные механизмы Create, терминалы хранилищ или таблички на секунду пропадают при повороте камеры, добавьте их ID в blockEntityWhitelist.',
    content: `{
  "configVersion": 5,
  "renderNametagsThroughWalls": true,
  "blockEntityWhitelist": [
    "minecraft:beacon",
    "create:belt",
    "create:flywheel",
    "create:*_contraption"
  ],
  "tickCulling": true
}`,
  },
  {
    modId: 'badoptimizations',
    modName: 'BadOptimizations',
    filePath: 'config/badoptimizations.txt',
    title: 'Отключение кэша цвета неба при багах с шейдерами или погодными модами',
    note: 'Если с шейдерами или модами на погоду небо меняет цвет рывками, отключите enable_sky_color_caching, оставив остальные микро-оптимизации.',
    content: `enable_sky_color_caching=false
enable_toast_optimizations=true
enable_lightmap_caching=true`,
  },
  {
    modId: 'servercore',
    modName: 'ServerCore',
    filePath: 'config/servercore/config.toml',
    title: 'Сбалансированная динамика тиков без урезания ближних ферм',
    note: 'Оставляет адаптивное снижение нагрузки на TPS при перегрузе сервера, не зажимая радиус активации прямо у базы игрока.',
    content: `[dynamic]
enabled = true
target_mspt = 35
min_chunk_tick_distance = 5
min_simulation_distance = 6`,
  },
  {
    modId: 'let-me-despawn',
    modName: 'Let Me Despawn',
    filePath: 'config/letmedespawn.json',
    title: 'Защита именных мобов и редких боссов от раннего деспавна с лутом',
    note: 'По умолчанию мобы с бирками и так защищены; дополнительно можно исключить модовых боссов, чтобы они не пропадали при отходе игрока.',
    content: `{
  "despawnTimer": 600,
  "pickUpItems": true,
  "mobNames": [
    "minecraft:ender_dragon",
    "minecraft:wither"
  ]
}`,
  },
  {
    modId: 'alltheleaks-memory-leak-fix',
    modName: 'AllTheLeaks (Memory Leak Fix)',
    filePath: 'config/alltheleaks-common.toml',
    title: 'Безопасная дедупликация ингредиентов без крашей рецептов',
    note: 'ingredientDedupe экономит сотни мегабайт RAM в тяжёлых паках 200+ модов; при редком сбое конкретного кастомного рецепта отключите именно его.',
    content: `[memory]
ingredientDedupe = true`,
  },
  {
    modId: 'ixeris',
    modName: 'Ixeris',
    filePath: 'config/ixeris.json',
    title: 'Стабильный Raw Input при игре в полноэкранном режиме с шейдерами',
    note: 'Только клиентский мод. Если в полноэкранном режиме с шейдерами камера дёргается или мышь залипает, переключите bufferedRawInput в false.',
    content: `{
  "bufferedRawInput": true,
  "separateEventThread": true
}`,
  },
  {
    modId: 'stutterfix-reforged',
    modName: 'StutterFix-Reforged',
    filePath: 'config/stutterfix.toml',
    title: 'Рекомендуемый режим без конфликтов со сторонними планировщиками',
    note: 'Не совмещайте с ThreadTweak или Smooth Boot. В случае ручного тюнинга приоритетов используйте только один регулятор потоков.',
    content: `[threading]
optimizeMainThreadPriority = true
optimizeRenderThread = true`,
  },
  {
    modId: 'more-culling-reforged',
    modName: 'More Culling Reforged',
    filePath: 'config/moreculling.toml',
    title: 'Безопасный профиль без артефактов на модовых блоках и листве',
    note: 'Отключайте куллинг листвы в More Culling, если используете CullLessLeaves; для рамок не совмещайте с Fast Item Frames.',
    content: `useBlockStateCulling = true
useItemFrameCulling = true
leavesCullingMode = "DEFAULT"
entityModelCulling = false`,
  },
];

