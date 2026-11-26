import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OutletDatabase } from '../server/db/database.js';
import { seedFullLocalDatabase } from '../server/db/seed.js';
import { formatLocalDateKey } from '../server/util/local-trx-code.util.js';

const TEST_SEED_DB = path.resolve(process.cwd(), 'data', 'test_seed.sqlite');

function cleanup() {
  OutletDatabase.resetInstance();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${TEST_SEED_DB}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

test('Seeder: mengisi penuh master, user, EDC, shift, dan transaksi historis secara idempoten', () => {
  cleanup();
  const db = new OutletDatabase(TEST_SEED_DB);
  const counts = () => ({
    products: (db.db.prepare('SELECT count(*) as c FROM products').get() as any).c,
    nullStock: (db.db.prepare('SELECT count(*) as c FROM products WHERE stock_qty IS NULL').get() as any).c,
    modGroups: (db.db.prepare('SELECT count(*) as c FROM modifier_groups').get() as any).c,
    users: (db.db.prepare('SELECT count(*) as c FROM users').get() as any).c,
    edc: (db.db.prepare('SELECT count(*) as c FROM edc_configurations').get() as any).c,
    shifts: (db.db.prepare('SELECT count(*) as c FROM shifts').get() as any).c,
    orders: (db.db.prepare('SELECT count(*) as c FROM orders').get() as any).c,
    orderItems: (db.db.prepare('SELECT count(*) as c FROM order_items').get() as any).c,
    printJobs: (db.db.prepare('SELECT count(*) as c FROM print_jobs').get() as any).c,
  });

  const first = counts();
  assert.equal(first.products, 26);
  assert.equal(first.nullStock, 0, 'Semua produk seed memiliki stock_qty non-null');
  assert.equal(first.modGroups, 5);
  assert.ok(first.users >= 6);
  assert.equal(first.edc, 2);
  assert.equal(first.shifts, 2);
  assert.ok(first.orders >= 14);
  assert.ok(first.orderItems >= 20);
  assert.ok(first.printJobs >= 10);

  // Pastikan order_sequence hari ini tetap kosong/0 (transaksi seed memakai tanggal historis)
  const todayKey = formatLocalDateKey(new Date());
  const todaySeq = db.db.prepare('SELECT current_seq FROM order_sequence WHERE date_key = ?').get(todayKey) as any;
  assert.equal(todaySeq, undefined);

  // Panggil seeder ulang (idempotency check)
  seedFullLocalDatabase(db.db, { includeTransactions: true });
  const second = counts();
  assert.deepEqual(second, first);

  cleanup();
});
