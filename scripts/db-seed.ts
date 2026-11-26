// scripts/db-seed.ts
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectEnv } from '../server/config/load-env.js';
import { OutletDatabase } from '../server/db/database.js';
import { seedFullLocalDatabase } from '../server/db/seed.js';

loadProjectEnv();

const args = new Set(process.argv.slice(2));
const isReset = args.has('--reset');

const dbPath =
  process.env.SQLITE_DB_PATH ||
  path.resolve(process.env.DATA_DIR || process.cwd(), 'data', 'outlet_pos.sqlite');

if (isReset) {
  OutletDatabase.resetInstance();
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${dbPath}${suffix}`;
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      console.log(`Removed ${target}`);
    }
  }
}

const instance = new OutletDatabase(dbPath, { skipAutoSeed: true });
const summary = seedFullLocalDatabase(instance.db, { includeTransactions: true });

const counts = {
  products: (instance.db.prepare('SELECT count(*) as c FROM products').get() as { c: number }).c,
  modifierGroups: (instance.db.prepare('SELECT count(*) as c FROM modifier_groups').get() as { c: number }).c,
  users: (instance.db.prepare('SELECT count(*) as c FROM users').get() as { c: number }).c,
  edcConfigurations: (instance.db.prepare('SELECT count(*) as c FROM edc_configurations').get() as { c: number }).c,
  shifts: (instance.db.prepare('SELECT count(*) as c FROM shifts').get() as { c: number }).c,
  orders: (instance.db.prepare('SELECT count(*) as c FROM orders').get() as { c: number }).c,
  orderItems: (instance.db.prepare('SELECT count(*) as c FROM order_items').get() as { c: number }).c,
  printJobs: (instance.db.prepare('SELECT count(*) as c FROM print_jobs').get() as { c: number }).c,
};

console.log('SQLite Seed Summary:', { dbPath, seeded: summary, totals: counts });
OutletDatabase.resetInstance();
