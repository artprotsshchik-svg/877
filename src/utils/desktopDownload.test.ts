import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESKTOP_EXE_DOWNLOAD_URL,
  DESKTOP_EXE_FILENAME,
  formatExeSizeMb,
  shouldShowExeDownload,
} from './desktopDownload.ts';

test('formatExeSizeMb formats valid positive byte counts and guards invalid values', () => {
  assert.equal(formatExeSizeMb(0), '');
  assert.equal(formatExeSizeMb(-10), '');
  assert.equal(formatExeSizeMb(Number.NaN), '');
  assert.equal(formatExeSizeMb(10 * 1024 * 1024), '10.0 МБ');
  assert.equal(formatExeSizeMb(8_912_896), '8.5 МБ');
});

test('shouldShowExeDownload hides download button inside desktop WebView host', () => {
  assert.equal(shouldShowExeDownload(false), true);
  assert.equal(shouldShowExeDownload(true), false);
  assert.equal(DESKTOP_EXE_DOWNLOAD_URL, `/downloads/${DESKTOP_EXE_FILENAME}`);
});
