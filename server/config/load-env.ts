import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function resolveEnvFileName(): string {
  const appEnv = (process.env.APP_ENV || '').trim().toLowerCase();
  if (appEnv === 'production' || appEnv === 'prod') return '.env.production';
  if (appEnv === 'staging' || appEnv === 'stg') return '.env.staging';
  if (appEnv === 'development' || appEnv === 'dev') return '.env.development';
  return '.env';
}

export function loadProjectEnv(): void {
  const named = path.join(projectRoot, resolveEnvFileName());
  const local = path.join(projectRoot, '.env');

  if (fs.existsSync(named)) {
    dotenv.config({ path: named });
  }
  if (fs.existsSync(local)) {
    dotenv.config({ path: local, override: true });
  }
}
