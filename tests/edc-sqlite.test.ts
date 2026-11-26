import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OutletDatabase } from '../server/db/database.js';
import { EdcConfigService } from '../server/services/EdcConfigService.js';

const TEST_DB = path.resolve(process.cwd(), 'data', 'test_edc_sql.sqlite');

test('EdcConfigService: CRUD, satu default aktif, dan penghapusan default mempromosikan cadangan', () => {
  OutletDatabase.resetInstance();
  for (const s of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${TEST_DB}${s}`)) fs.unlinkSync(`${TEST_DB}${s}`);
  }
  const db = new OutletDatabase(TEST_DB, { seedTransactions: false });
  const edcService = new EdcConfigService(db);

  const initial = edcService.listConfigs();
  assert.equal(initial.length, 2);
  assert.equal(initial.filter((c) => c.isDefault).length, 1);

  const added = edcService.saveConfig({
    name: 'EDC BCA Counter 2',
    bank: 'BCA',
    connectionType: 'TCP_IP',
    host: '192.168.1.99',
    port: 2001,
    isDefault: true,
  });

  let all = edcService.listConfigs();
  assert.equal(all.filter((c) => c.isDefault).length, 1);
  assert.equal(all.find((c) => c.isDefault)?.id, added.id);

  edcService.deleteConfig(added.id);
  all = edcService.listConfigs();
  assert.equal(
    all.filter((c) => c.isDefault).length,
    1,
    'Setelah default dihapus, satu konfigurasi tersisa otomatis menjadi default',
  );

  // Uncheck default pada active default harus tetap menjaga 1 default aktif
  const currentDefault = all.find((c) => c.isDefault)!;
  edcService.saveConfig({
    id: currentDefault.id,
    name: currentDefault.name,
    connectionType: currentDefault.connectionType,
    isDefault: false,
  });
  all = edcService.listConfigs();
  assert.equal(all.filter((c) => c.isDefault).length, 1, 'Uncheck default harus mempromosikan/menjaga 1 default aktif');

  // Deaktivasi default harus mempromosikan aktif lainnya; setDefault pada non-aktif harus ditolak
  const def2 = all.find((c) => c.isDefault)!;
  edcService.saveConfig({
    id: def2.id,
    name: def2.name,
    connectionType: def2.connectionType,
    isActive: false,
    isDefault: true,
  });
  all = edcService.listConfigs();
  assert.equal(all.filter((c) => c.isDefault).length, 1, 'Deaktivasi default mempromosikan konfigurasi aktif tersisa');
  assert.throws(() => {
    edcService.setDefault(def2.id);
  }, /inactive|nonaktif/i);
});
