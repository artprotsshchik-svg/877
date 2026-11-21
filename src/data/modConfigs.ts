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
  alsoForModIds?: string[];
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
    note: 'Требует NVIDIA GTX 16xx / RTX 20xx+, отключённых шейдеров, алиаса в config/connector.json и обхода версии Sodium в config/fabric_loader_dependencies.json.',
    content: NVIDIUM_CONFIG_CONTENT,
  },
  {
    modId: 'sinytra-connector',
    modName: 'Sinytra Connector (для Nvidium)',
    alsoForModIds: ['nvidium', 'emberbium'],
    filePath: 'config/connector.json',
    title: 'Рабочий алиас Embeddium / Emberbium → Sodium для Forge 1.20.1',
    note: 'Ключ globalModAliases заставляет Nvidium (Fabric) видеть установленный Embeddium или Emberbium как Sodium на Forge 1.20.1.',
    content: `{
  "version": 1,
  "hiddenMods": [],
  "globalModAliases": {
    "embeddium": "sodium"
  }
}`,
  },
  {
    modId: 'nvidium',
    modName: 'Nvidium (Fabric Loader Override)',
    alsoForModIds: ['sinytra-connector'],
    filePath: 'config/fabric_loader_dependencies.json',
    title: 'Снятие строгой проверки версии Sodium для запуска Nvidium на Forge',
    note: 'Nvidium требует Sodium >=0.5.8, тогда как Embeddium 0.3.31 / Emberbium отдают другую версию. Этот конфиг убирает краш несовпадения версий при старте через Sinytra Connector.',
    content: `{
  "version": 1,
  "overrides": {
    "nvidium": {
      "-depends": {
        "sodium": "IGNORED"
      }
    }
  }
}`,
  },
  {
    modId: 'concurrent-chunk-management-engine-forge-c2me',
    modName: 'C2ME-Forge (C2MEF)',
    filePath: 'config/c2me.toml',
    title: 'Стабильные потоки генерации чанков на Forge',
    note: 'Отключение noTickViewDistance предотвращает конфликты миксинов и утечки чанков.',
    content: `[noTickViewDistance]
enabled = false

[ioSystem]
asyncChunkio = true`,
  },
  {
    modId: 'c2me-concurrent-chunk-management-engine',
    modName: 'C2ME (Fabric через Sinytra)',
    filePath: 'config/c2me.toml',
    title: 'Безопасный режим C2ME через Sinytra Connector',
    note: 'Обязательно выключите noTickViewDistance при запуске поверх Forge 1.20.1.',
    content: `[noTickViewDistance]
enabled = false`,
  },
  {
    modId: 'modernfix',
    modName: 'ModernFix',
    filePath: 'config/modernfix-mixins.properties',
    title: 'Рекомендуемые флаги памяти и запуска',
    note: 'Dynamic Resources экономит до 30–50% RAM на ресурсах модов.',
    content: `mixin.perf.dynamic_resources=true
mixin.perf.faster_item_rendering=true
mixin.bugfix.packet_threading=true`,
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
    modId: 'entity-culling',
    modName: 'Entity Culling (Совместимость с Create и маяками)',
    alsoForModIds: ['flywheel', 'vanillin', 'enhanced-block-entities-reloaded'],
    filePath: 'config/entityculling.json',
    title: 'Безопасный whitelist для движущихся механизмов Create и маяков',
    note: 'Исключает мерцание больших ветряков, водяных колёс и поездов Create за стенами без потери куллинга остальных мобов и сундуков EBER.',
    content: `{
  "configVersion": 5,
  "renderNametagsThroughWalls": false,
  "blockEntityWhitelist": [
    "minecraft:beacon",
    "create:contraption",
    "create:stationary_contraption",
    "create:gantry_contraption",
    "create:carriage_contraption"
  ],
  "entityWhitelist": [
    "minecraft:ender_dragon",
    "minecraft:wither",
    "create:contraption",
    "create:stationary_contraption",
    "create:gantry_contraption",
    "create:carriage_contraption"
  ],
  "tracingDistance": 128,
  "sleepDelay": 10,
  "hitboxLimit": 50
}`,
  },
  {
    modId: 'more-culling-reforged',
    modName: 'More Culling Reforged (Совместно с CullLessLeaves и Fast Item Frames)',
    alsoForModIds: ['culllessleaves-reforged', 'fast-item-frames', 'enhanced-block-entities-reloaded'],
    filePath: 'config/moreculling.toml',
    title: 'Отключение дублирующих модулей листвы и рамок при полном стеке куллинга',
    note: 'Если используете CullLessLeaves Reforged и Fast Item Frames, отключите встроенный куллинг листвы и рамок в More Culling, оставив отсечение скрытых граней блоков и текста табличек.',
    content: `useBlockStateCulling = true
useCustomItemFrameRenderer = false
itemFrameMapCulling = false
leavesCullingMode = "DEFAULT"
useOnSignTextCulling = true
rainDropCulling = true`,
  },
];
