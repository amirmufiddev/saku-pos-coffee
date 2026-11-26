import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { edcStorage } from '../src/services/edcStorage.js';
import { PaymentService } from '../server/services/PaymentService.js';
import { OrderService } from '../server/services/OrderService.js';
import { EdcConfigService } from '../server/services/EdcConfigService.js';
import { OutletDatabase } from '../server/db/database.js';
import { seedMinimalTestCatalog, TEST_PRODUCT_ID } from './helpers/test-catalog.js';

const require = createRequire(import.meta.url);
const TEST_EDC_DB = path.resolve(process.cwd(), 'data', 'test_edc_integration.sqlite');

function setupIsolatedDb(): OutletDatabase {
  OutletDatabase.resetInstance();
  for (const s of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${TEST_EDC_DB}${s}`)) fs.unlinkSync(`${TEST_EDC_DB}${s}`);
  }
  const db = new OutletDatabase(TEST_EDC_DB, { seedTransactions: false });
  seedMinimalTestCatalog(db.db);
  return db;
}

test('EDC Integration: Module loads and protocol frame verification', async () => {
  const edcModule = require('../electron/edc/edc-manager.cjs');
  assert.ok(edcModule.EDCManager, 'EDCManager class should exist');
  assert.ok(edcModule.edcManager, 'edcManager singleton instance should exist');

  const status = edcModule.edcManager.getStatus();
  assert.ok(status, 'getStatus should return status object');
  assert.strictEqual(status.state, 'DISCONNECTED', 'Initial EDC state should be DISCONNECTED');
});

test('EDC Integration: edcStorage & EdcConfigService local SQLite management', () => {
  const db = setupIsolatedDb();
  const edcService = new EdcConfigService(db);
  const seeded = edcService.listConfigs();
  assert.ok(seeded.length >= 2, 'Seeded EDC configurations must exist in SQLite');

  edcStorage.hydrateFromServer(seeded as any);
  const saved = edcStorage.saveEdcConfiguration({
    name: 'EDC Test Fixture',
    connectionType: 'SERIAL',
    bank: 'Danamon',
    baudRate: 115200,
    portPath: 'COM_TEST',
    isDefault: true,
  });

  const configs = edcStorage.getEdcConfigurations();
  assert.ok(configs.some((c) => c.id === saved.id));

  edcStorage.updateEdcTestResult(saved.id, {
    lastTestStatus: 'CONNECTED',
    lastTestedAt: new Date().toISOString(),
    terminalId: 'TEST-TID-01',
  });

  const updated = edcStorage.getEdcConfigurations().find((c) => c.id === saved.id);
  assert.strictEqual(updated?.lastTestStatus, 'CONNECTED');
  assert.strictEqual(updated?.terminalId, 'TEST-TID-01');
});

test('EDC Integration: Payment settlement with EDC metadata persists in SQLite', () => {
  const db = setupIsolatedDb();
  const orderService = new OrderService(db);
  const paymentService = new PaymentService(db);

  const order = orderService.createOrder({
    outletId: 'OUTLET-001',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Asep Barista',
    customerName: 'Bapak Hendra',
    diningOption: 'takeaway',
    items: [
      {
        productId: TEST_PRODUCT_ID,
        variantSize: 'Regular',
        quantity: 2,
        notes: 'Less Ice',
      },
    ],
  });

  assert.strictEqual(order.paymentStatus, 'PENDING');

  const edcApprovalCode = 'APPR:982341 | CARD:4111********1111 | RRN:000087654321 | TID:DANAMON-01';
  const paymentRes = paymentService.processPayment({
    orderId: order.id,
    paymentMethod: 'EDC_DEBIT',
    amountPaid: order.totalAmount,
    paymentRef: edcApprovalCode,
  });

  assert.strictEqual(paymentRes.success, true);
  assert.strictEqual(paymentRes.paymentStatus, 'PAID');
  assert.strictEqual(paymentRes.order.paymentStatus, 'PAID');
  assert.strictEqual(paymentRes.order.status, 'PREPARING');
  assert.strictEqual(paymentRes.order.paymentRef, edcApprovalCode);

  const persisted = orderService.getOrderById(order.id);
  assert.strictEqual(persisted?.paymentStatus, 'PAID');
  assert.strictEqual(persisted?.paymentMethod, 'EDC_DEBIT');
  assert.strictEqual(persisted?.paymentRef, edcApprovalCode);
});

test('EDC Integration: QRIS EDC frame generation and settlement workflow', async () => {
  const db = setupIsolatedDb();
  const orderService = new OrderService(db);
  const paymentService = new PaymentService(db);

  const { buildQrisPaymentFrame } = await import('../electron/edc/src/edc/edc-qris.js');
  assert.ok(buildQrisPaymentFrame, 'buildQrisPaymentFrame should exist');
  const frame = buildQrisPaymentFrame(35000);
  assert.ok(Buffer.isBuffer(frame), 'QRIS frame should be a Buffer');
  assert.strictEqual(frame[0], 0x02, 'Frame must start with STX (0x02)');

  const order = orderService.createOrder({
    outletId: 'OUTLET-001',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Asep Barista',
    customerName: 'Ibu Maya',
    diningOption: 'dinein',
    items: [
      {
        productId: TEST_PRODUCT_ID,
        variantSize: 'Regular',
        quantity: 1,
        notes: '',
      },
    ],
  });

  const qrisApprovalCode = 'APPR:QR88219 | RRN:000099881122 | TID:DANAMON-QRIS-01';
  const paymentRes = paymentService.processPayment({
    orderId: order.id,
    paymentMethod: 'QRIS',
    amountPaid: order.totalAmount,
    paymentRef: qrisApprovalCode,
  });

  assert.strictEqual(paymentRes.success, true);
  assert.strictEqual(paymentRes.paymentStatus, 'PAID');
  assert.strictEqual(paymentRes.order.paymentMethod, 'QRIS');
  assert.strictEqual(paymentRes.order.paymentRef, qrisApprovalCode);

  const persisted = orderService.getOrderById(order.id);
  assert.strictEqual(persisted?.paymentStatus, 'PAID');
  assert.strictEqual(persisted?.paymentRef, qrisApprovalCode);
});
