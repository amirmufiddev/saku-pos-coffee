// electron/build-electron.ts — bundle main (ESM) + preload (CJS) for Electron
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const outDir = path.join(projectRoot, 'dist-electron');

export async function buildElectronArtifacts(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(projectRoot, 'electron/preload.ts')],
    outfile: path.join(outDir, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });

  await esbuild.build({
    entryPoints: [path.join(projectRoot, 'electron/main.ts')],
    outfile: path.join(outDir, 'main.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    external: ['electron'],
  });

  await esbuild.build({
    entryPoints: [path.join(projectRoot, 'server/index.ts')],
    outfile: path.join(outDir, 'server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    external: ['electron', 'serialport'],
  });

  const staleMainJs = path.join(outDir, 'main.js');
  if (fs.existsSync(staleMainJs)) {
    fs.unlinkSync(staleMainJs);
  }
}

async function main(): Promise<void> {
  await buildElectronArtifacts();
  console.log('[build-electron] dist-electron/main.mjs + preload.cjs + server.mjs');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
