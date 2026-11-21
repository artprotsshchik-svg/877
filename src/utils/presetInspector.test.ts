import test from 'node:test';
import assert from 'node:assert/strict';
import { MOD_PRESETS } from '../data/modsData.ts';
import {
  buildPresetModRows,
  filterPresetModRows,
  getInteractionKindMeta,
  getPresetDiffSummary,
} from './presetInspector.ts';

test('presetInspector builds complete rows with per-mod purpose and contextual interactions for all 6 presets', () => {
  assert.equal(MOD_PRESETS.length, 6);

  const expectedCounts: Record<string, number> = {
    'user-nvidium-emberbium': 47,
    'user-alloyium-embeddium': 44,
    'shaders-optimum': 48,
    'create-industry-shaders': 57,
    'multiplayer-heavy-server': 55,
    'potato-integrated-gpu': 37,
  };

  for (const [presetId, expectedCount] of Object.entries(expectedCounts)) {
    const preset = MOD_PRESETS.find(p => p.id === presetId);
    assert.ok(preset, `Missing preset ${presetId}`);
    const rows = buildPresetModRows(preset);
    assert.equal(rows.length, expectedCount, `${presetId} expected ${expectedCount} rows, got ${rows.length}`);

    rows.forEach((row, idx) => {
      assert.equal(row.index, idx + 1, `${presetId}: index sequence broken at ${row.mod.id}`);
      assert.ok(row.mod.description.trim().length > 10, `${presetId}: empty description for ${row.mod.id}`);
      assert.ok(row.impact.summary.trim().length > 10, `${presetId}: empty impact summary for ${row.mod.id}`);
      assert.ok(
        row.impact.interactions.length > 0,
        `${presetId}: expected contextual interactions for ${row.mod.id}`
      );
      for (const note of row.impact.interactions) {
        const meta = getInteractionKindMeta(note.kind);
        assert.ok(meta.label.length > 0);
      }
    });
  }

  const nvidiumRows = buildPresetModRows(MOD_PRESETS.find(p => p.id === 'user-nvidium-emberbium')!);
  const alloyiumRows = buildPresetModRows(MOD_PRESETS.find(p => p.id === 'user-alloyium-embeddium')!);

  // Controlling must be attached with Searchables inside both flagship assemblies
  const controllingRow = nvidiumRows.find(r => r.mod.id === 'controlling');
  assert.ok(controllingRow);
  assert.ok(controllingRow.impact.interactions.some(i => i.targetIds.includes('searchables')));

  // Sinytra Connector mentions Nvidium / .connector synergy
  const sinytraRow = nvidiumRows.find(r => r.mod.id === 'sinytra-connector');
  assert.ok(sinytraRow);
  assert.ok(sinytraRow.impact.interactions.some(i => i.targetIds.includes('nvidium')));

  // Alloyium assembly has Alloyium + Embeddium without Sinytra
  const alloyiumRow = alloyiumRows.find(r => r.mod.id === 'alloyium');
  assert.ok(alloyiumRow);
  assert.ok(alloyiumRow.impact.interactions.some(i => i.targetIds.includes('embeddium')));
});

test('presetInspector filters by query, category, reaction filter, and computes exact diff summary', () => {
  const nvidiumPreset = MOD_PRESETS.find(p => p.id === 'user-nvidium-emberbium')!;
  const alloyiumPreset = MOD_PRESETS.find(p => p.id === 'user-alloyium-embeddium')!;

  const nvidiumRows = buildPresetModRows(nvidiumPreset);

  const searchMatches = filterPresetModRows(nvidiumRows, { query: 'Nvidium' });
  assert.ok(searchMatches.some(r => r.mod.id === 'nvidium'));
  assert.ok(searchMatches.some(r => r.mod.id === 'emberbium'));

  const coreOnly = filterPresetModRows(nvidiumRows, { reaction: 'core' });
  assert.ok(coreOnly.length >= 5);
  assert.ok(coreOnly.every(r => r.impact.level === 'core' || r.impact.level === 'high'));

  const supportOnly = filterPresetModRows(nvidiumRows, { reaction: 'support' });
  assert.ok(supportOnly.some(r => r.mod.id === 'searchables'));
  assert.ok(supportOnly.some(r => r.mod.id === 'controlling'));

  const diff = getPresetDiffSummary(nvidiumPreset, alloyiumPreset);
  assert.equal(diff.sharedCount, 42);
  assert.deepEqual(
    diff.onlyInReference.map(m => m.id).sort(),
    ['connector-extras', 'emberbium', 'forgified-fabric-api', 'nvidium', 'sinytra-connector']
  );
  assert.deepEqual(
    diff.onlyInCounterpart.map(m => m.id).sort(),
    ['alloyium', 'embeddium']
  );
});
