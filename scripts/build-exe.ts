import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DESKTOP_DIR = path.join(ROOT, 'desktop');
const DIST_DIR = path.join(ROOT, 'dist');
const WEBDIST_DIR = path.join(DESKTOP_DIR, 'webdist');
const RELEASE_DIR = path.join(ROOT, 'release');
const PUBLIC_DOWNLOADS_DIR = path.join(ROOT, 'public', 'downloads');
const EXE_FILENAME = 'ModOptimizer-Forge-1.20.1-win-x64.exe';

function resolveGoBin(): string {
  const candidates = ['/usr/local/go/bin/go', '/tmp/go/bin/go', 'go'];
  for (const bin of candidates) {
    try {
      execSync(`${bin} version`, { stdio: 'ignore' });
      return bin;
    } catch {
      // try next
    }
  }
  throw new Error('Go toolchain not found. Install Go 1.23+ to build the Windows .exe.');
}

function copyDirExcluding(srcDir: string, dstDir: string, excludeTopLevel: Set<string>): void {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (excludeTopLevel.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirExcluding(srcPath, dstPath, new Set());
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function main(): void {
  const goBin = resolveGoBin();

  console.log('1/5 Syncing database bundle & building frontend dist/...');
  execSync('npx --yes tsx scripts/sync-data.ts', { cwd: ROOT, stdio: 'inherit' });
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  console.log('2/5 Staging clean frontend bundle into desktop/webdist (excluding downloads/)...');
  fs.rmSync(WEBDIST_DIR, { recursive: true, force: true });
  copyDirExcluding(DIST_DIR, WEBDIST_DIR, new Set(['downloads']));

  console.log('3/5 Generating Windows icon/manifest resources & running Go verification...');
  execSync(`${goBin} mod tidy`, { cwd: DESKTOP_DIR, stdio: 'inherit' });
  execSync(`${goBin} run github.com/tc-hib/go-winres@latest make --arch amd64`, {
    cwd: DESKTOP_DIR,
    stdio: 'inherit',
  });
  execSync(`${goBin} test ./...`, { cwd: DESKTOP_DIR, stdio: 'inherit' });
  execSync(`GOOS=windows GOARCH=amd64 CGO_ENABLED=0 ${goBin} vet ./...`, {
    cwd: DESKTOP_DIR,
    stdio: 'inherit',
  });

  console.log('4/5 Cross-compiling standalone Windows x64 GUI executable...');
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  const releaseExePath = path.join(RELEASE_DIR, EXE_FILENAME);
  execSync(
    `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 ${goBin} build -trimpath -ldflags="-s -w -H windowsgui" -o "${releaseExePath}" .`,
    { cwd: DESKTOP_DIR, stdio: 'inherit' }
  );

  console.log('5/5 Publishing executable artifact to public/downloads/ & dist/downloads/...');
  fs.mkdirSync(PUBLIC_DOWNLOADS_DIR, { recursive: true });
  const publicExePath = path.join(PUBLIC_DOWNLOADS_DIR, EXE_FILENAME);
  fs.copyFileSync(releaseExePath, publicExePath);

  const distDownloadsDir = path.join(DIST_DIR, 'downloads');
  fs.mkdirSync(distDownloadsDir, { recursive: true });
  fs.copyFileSync(releaseExePath, path.join(distDownloadsDir, EXE_FILENAME));

  const buf = fs.readFileSync(releaseExePath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const meta = {
    filename: EXE_FILENAME,
    version: '1.2.1',
    platform: 'windows-x64',
    sizeBytes: buf.length,
    sha256,
    builtAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(PUBLIC_DOWNLOADS_DIR, 'exe-meta.json'), JSON.stringify(meta, null, 2) + '\n');
  fs.writeFileSync(path.join(distDownloadsDir, 'exe-meta.json'), JSON.stringify(meta, null, 2) + '\n');
  fs.writeFileSync(path.join(RELEASE_DIR, 'exe-meta.json'), JSON.stringify(meta, null, 2) + '\n');

  console.log(
    `Built ${EXE_FILENAME}: ${(buf.length / (1024 * 1024)).toFixed(2)} MB (sha256: ${sha256.slice(0, 12)}...)`
  );
}

main();
