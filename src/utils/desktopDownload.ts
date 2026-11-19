export interface ExeArtifactMeta {
  filename: string;
  version: string;
  platform: string;
  sizeBytes: number;
  sha256: string;
  builtAt: string;
}

export const DESKTOP_EXE_FILENAME = 'ModOptimizer-Forge-1.20.1-win-x64.exe';
export const DESKTOP_EXE_DOWNLOAD_URL = `/downloads/${DESKTOP_EXE_FILENAME}`;
export const DESKTOP_EXE_META_URL = '/downloads/exe-meta.json';

export function formatExeSizeMb(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '';
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function shouldShowExeDownload(isDesktopApp: boolean): boolean {
  return !isDesktopApp;
}
