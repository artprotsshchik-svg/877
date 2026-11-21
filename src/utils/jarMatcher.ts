import { MODS_DATABASE, type ModItem } from '../data/modsData.ts';

function normalizeJarToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\.jar(\.disabled)?$/i, '')
    .replace(/[-_+ ]mc?1\.\d+(\.\d+)?/gi, '')
    .replace(/[-_+ ](forge|neoforge|fabric|quilt|universal|hd[-_]?u)[-_+ ].*$/gi, '')
    .replace(/[-_+](forge|neoforge|fabric|quilt|universal)\b/gi, '')
    .replace(/[-_+ ]v?\d+\.\d+.*$/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

const JAR_ALIASES: Record<string, string> = {
  embeddium: 'embeddium',
  emberbium: 'emberbium',
  nvidium: 'nvidium',
  alloyium: 'alloyium',
  oculus: 'oculus',
  emberlens: 'emberlens',
  flerovium: 'flerovium',
  immediatelyfast: 'immediatelyfast',
  modernfix: 'modernfix',
  ferritecore: 'ferritecore',
  alltheleaks: 'alltheleaks-memory-leak-fix',
  badoptimizations: 'badoptimizations',
  capabilityfixrevived: 'capability-fix-revived',
  compactf3plus: 'compact-f3-plus',
  culllessleavesreforged: 'culllessleaves-reforged',
  culllessleaves: 'culllessleaves-reforged',
  eber: 'enhanced-block-entities-reloaded',
  enhancedblockentitiesreloaded: 'enhanced-block-entities-reloaded',
  enhancedblockentities: 'enhanced-block-entities-reloaded',
  fastsounds: 'fast-sounds',
  soundgc: 'soundgc',
  particlecore: 'particle-core',
  fzzyconfig: 'fzzy-config',
  kotlinforforge: 'kotlin-for-forge',
  kffmod: 'kotlin-for-forge',
  matlib: 'matlib',
  immersiveoptimization: 'immersive-optimization',
  ixeris: 'ixeris',
  jasione: 'jasione',
  kerria: 'kerria',
  noisiumed: 'noisiumed',
  packetfixer: 'packet-fixer',
  radiumrereforged: 'radium-re-reforged',
  radium: 'radium-re-reforged',
  resourcefulconfig: 'resourceful-config',
  connectorextras: 'connector-extras',
  connector: 'sinytra-connector',
  sinytraconnector: 'sinytra-connector',
  forgifiedfabricapi: 'forgified-fabric-api',
  fabricapi: 'forgified-fabric-api',
  sodiumdynamiclights: 'sodium-embeddium-dynamic-lights',
  sodiumoptionsapi: 'sodium-embeddium-options-api',
  sodiumchloride: 'sodium-chloride',
  chloride: 'sodium-chloride',
  embeddiumextras: 'embeddium-extras',
  solix: 'solix',
  lightstar: 'lightstar',
  structurelayoutoptimizer: 'structure-layout-optimizer',
  c2mef: 'concurrent-chunk-management-engine-forge-c2me',
  c2me: 'concurrent-chunk-management-engine-forge-c2me',
  c2mer: 'c2mer',
  connectivity: 'connectivity',
  cupboard: 'cupboard',
  kryptonreno: 'krypton-reno',
  kryptonhybrid: 'krypton-hybrid',
  pluto: 'pluto',
  servercore: 'servercore',
  vmp: 'vmp-forge',
  vmpforge: 'vmp-forge',
  entityculling: 'entity-culling',
  morecullingreforged: 'more-culling-reforged',
  clumps: 'clumps',
  letmedespawn: 'let-me-despawn',
  dynamicfps: 'dynamic-fps',
  restmode: 'restmode',
  acceleratedrendering: 'accelerated-rendering',
  threadtweak: 'threadtweak-reforged',
  stutterfix: 'stutterfix-reforged',
  smoothboot: 'smooth-boot-reloaded',
  smoothbootreloaded: 'smooth-boot-reloaded',
  distanthorizons: 'distant-horizons',
  jei: 'just-enough-items-jei',
  justenoughitems: 'just-enough-items-jei',
  emi: 'emi',
  tmrv: 'tmrv-updated',
  tmrvupdated: 'tmrv-updated',
  emiloot: 'emi-loot',
  emiores: 'emi-ores',
  emiffect: 'emiffect',
  emitrades: 'emi-trades',
  emiprofessions: 'emi-professions',
  jer: 'just-enough-resources-jer',
  justenoughresources: 'just-enough-resources-jer',
  fastsuite: 'fastsuite',
  fastfurnace: 'fastfurnace',
  fastworkbench: 'fastworkbench',
  fastvancements: 'fastvancements',
  fastipping: 'fast-ip-ping',
  fastitemframes: 'fast-item-frames',
  fastload: 'fastload',
  ksyxis: 'ksyxis',
  flywheel: 'flywheel',
  vanillin: 'vanillin',
  geckolibbetterfps: 'geckolibbetterfps',
  gputape: 'gputape',
  fasteririsshadowmapper: 'faster-iris-shadow-mapper',
  alternatecurrent: 'alternate-current',
  spark: 'spark',
  observable: 'observable',
  optifine: 'optifine',
  rubidium: 'rubidium',
  xenon: 'xenon',
  puzzleslib: 'puzzles-lib',
  almanac: 'almanac',
  almanaclib: 'almanac',
  placebo: 'placebo',
  architectury: 'architectury-api',
  architecturyapi: 'architectury-api',
  rinlib: 'rinlib',
  papi: 'put-a-plug-in-it-papi',
  putapluginit: 'put-a-plug-in-it-papi',
  fallingblocksfpsfix: 'falling-blocks-fps-fix',
  structuredfucache: 'structure-dfu-cache',
  configured: 'configured',
  controlling: 'controlling',
  searchables: 'searchables',
  clothconfig: 'cloth-config-v12',
  toastcontrol: 'toast-control',
  irisoculusflywheelcompat: 'iris-oculus-flywheel-compat',
  oculusflywheelcompat: 'iris-oculus-flywheel-compat',
  flywheelcompat: 'iris-oculus-flywheel-compat',
  aegisnetworking: 'aegisnetworking-krypton-hybrid',
  harichunk: 'hc-harichunk',
  hcharichunk: 'hc-harichunk',
  redirector: 'redirector-modern',
  redirectormodern: 'redirector-modern',
  tt20: 'tt20-tps-fixer',
  tt20tpsfixer: 'tt20-tps-fixer',
  bobby: 'bobby-reforged',
  notenoughbandwidth: 'not-enough-bandwidth-legacy',
  moreculling: 'more-culling-reforged',
  fastloadreforged: 'fastload',
  languagereload: 'language-reload-reforged',
  languagereloadunofficial: 'languagereloadunofficial',
  bonsdlssdiet: 'bons-dlss-diet-complementary-unbound',
  sodiumleafculling: 'sodium-leaf-culling-unofficial',
  sodiumembeddiumleafculling: 'sodium-embeddium-leaf-culling',
  drd: 'drd-dynamic-render-distance',
  dynamicrenderdistance: 'dynamicrenderdistance',
  lazydfu: 'lazydfu-forge',
  starlight: 'starlight-with-create-fix',
  starlightforge: 'starlight-with-create-fix',
  iris: 'iris-shaders',
  irisshaders: 'iris-shaders',
  memoryleakfix: 'memory-leak-fix-modern-port',
  kexosyn: 'kexosyn-forge',
  upscalecraft: 'upscalecraft-forge',
  stablecappacer: 'stablecap-pacer-forge-1-19-2',
  clearlagg: 'clearlagg-server-forge',
  clearlaggserver: 'clearlagg-server-forge',
  concurrentchunkmanagementengine: 'concurrent-chunk-management-engine-forge-c2me',
  concurrentchunkmanagementengineforgec2me: 'concurrent-chunk-management-engine-forge-c2me',
};

const MOD_TOKEN_INDEX = (() => {
  const index = new Map<string, ModItem>();
  // Prioritize Forge-native / non-Fabric-only mods so clean Forge tokens aren't stolen by reference Fabric/NeoForge entries
  const orderedMods = [...MODS_DATABASE].sort((a, b) => {
    const aUnsupported = a.platform === 'Fabric' || a.platform === 'NeoForge' ? 1 : 0;
    const bUnsupported = b.platform === 'Fabric' || b.platform === 'NeoForge' ? 1 : 0;
    return aUnsupported - bUnsupported;
  });
  for (const mod of orderedMods) {
    const candidates = [
      mod.id.replace(/[^a-z0-9]/gi, '').toLowerCase(),
      mod.name.replace(/[^a-z0-9]/gi, '').toLowerCase(),
      normalizeJarToken(mod.id),
      normalizeJarToken(mod.name),
    ];
    for (const token of candidates) {
      if (token.length >= 4 && !index.has(token)) {
        index.set(token, mod);
      }
    }
  }
  return index;
})();

export function matchJarFilenamesToMods(jarFiles: string[]): {
  matchedIds: string[];
  unmatchedJars: string[];
} {
  const matchedSet = new Set<string>();
  const unmatchedJars: string[] = [];

  for (const jar of jarFiles) {
    const rawLower = jar.toLowerCase();
    if (rawLower.includes('c2me') && rawLower.includes('fabric')) {
      matchedSet.add('c2me-concurrent-chunk-management-engine');
      continue;
    }
    if (rawLower.includes('vmp') && rawLower.includes('fabric')) {
      matchedSet.add('very-many-players-vmp');
      continue;
    }

    const token = normalizeJarToken(jar);
    if (!token) {
      unmatchedJars.push(jar);
      continue;
    }

    const directAliasId = JAR_ALIASES[token];
    if (directAliasId) {
      matchedSet.add(directAliasId);
      continue;
    }

    const exact = MOD_TOKEN_INDEX.get(token);
    if (exact) {
      matchedSet.add(exact.id);
      continue;
    }

    let partialHit: ModItem | undefined;
    for (const [aliasKey, modId] of Object.entries(JAR_ALIASES)) {
      if (aliasKey.length >= 4 && token.startsWith(aliasKey) && token.length - aliasKey.length <= 6) {
        matchedSet.add(modId);
        partialHit = MODS_DATABASE.find(m => m.id === modId);
        break;
      }
    }

    if (!partialHit) {
      unmatchedJars.push(jar);
    }
  }

  return {
    matchedIds: Array.from(matchedSet),
    unmatchedJars,
  };
}
