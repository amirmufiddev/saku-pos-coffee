/**
 * Windows installer build. Uses release/artifacts so a locked release/win-unpacked
 * (app still running, Explorer, IDE) does not block electron-builder.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = 'release/artifacts';

const legacyUnpacked = path.join(projectRoot, 'release', 'win-unpacked');
if (fs.existsSync(legacyUnpacked)) {
  try {
    fs.rmSync(legacyUnpacked, { recursive: true, force: true });
    console.log('[build:win] Folder lama release/win-unpacked dihapus.');
  } catch {
    console.warn(
      '[build:win] release/win-unpacked masih terkunci — build memakai',
      outputDir,
      '(installer tidak menimpa folder lama).',
    );
  }
}

const electronBuilderCli = path.join(
  projectRoot,
  'node_modules',
  'electron-builder',
  'cli.js',
);

const result = spawnSync(
  process.execPath,
  [electronBuilderCli, '--win', 'nsis', '--x64', `--config.directories.output=${outputDir}`],
  { cwd: projectRoot, stdio: 'inherit', env: process.env },
);

process.exit(result.status ?? 1);
