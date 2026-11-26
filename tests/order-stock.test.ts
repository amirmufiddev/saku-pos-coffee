import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OutletDatabase } from '../server/db/database.js';
import { OrderService } from '../server/services/OrderService.js';

const TEST_DB = path.resolve(process.cwd(), 'data', 'test_stock.sqlite');

function setup() {
  OutletDatabase.resetInstance();
  for (const s of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${TEST_DB}${s}`)) fs.unlinkSync(`${TEST_DB}${s}`);
  }
  const db = new OutletDatabase(TEST_DB, { seedTransactions: false });
  const prod = db.db.prepare('SELECT id FROM products LIMIT 1').get() as { id: string };
  return { db, orderService: new OrderService(db), productId: prod.id };
}

test('Stok berkurang saat order dibuat, habis menandai is_sold_out=1, dan kembali saat CANCELLED (tanpa double restore)', () => {
  const { db, orderService, productId } = setup();
  orderService.updateProductStock(productId, 3, false);

  const o1 = orderService.createOrder({
    outletId: 'out_1',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Asep',
    items: [{ productId, variantSize: 'Regular', quantity: 3 }],
  });

  let row = db.db.prepare('SELECT stock_qty, is_sold_out FROM products WHERE id = ?').get(productId) as any;
  assert.equal(row.stock_qty, 0);
  assert.equal(row.is_sold_out, 1);

  assert.throws(() => {
    orderService.createOrder({
      outletId: 'out_1',
      terminalId: 'TERM-01',
      cashierId: 'usr_asep',
      cashierName: 'Asep',
      items: [{ productId, variantSize: 'Regular', quantity: 1 }],
    });
  }, /habis|stok/i);

  orderService.updateOrderStatus(o1.id, 'CANCELLED');
  row = db.db.prepare('SELECT stock_qty, is_sold_out FROM products WHERE id = ?').get(productId) as any;
  assert.equal(row.stock_qty, 3);
  assert.equal(row.is_sold_out, 0);

  // Double cancel tidak boleh menambah stok lagi
  orderService.updateOrderStatus(o1.id, 'CANCELLED');
  row = db.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(productId) as any;
  assert.equal(row.stock_qty, 3);
});

test('Multi-baris SKU sama melebihi stock_qty melakukan rollback penuh', () => {
  const { db, orderService, productId } = setup();
  orderService.updateProductStock(productId, 2, false);

  assert.throws(() => {
    orderService.createOrder({
      outletId: 'out_1',
      terminalId: 'TERM-01',
      cashierId: 'usr_asep',
      cashierName: 'Asep',
      items: [
        { productId, variantSize: 'Regular', quantity: 1 },
        { productId, variantSize: 'Large', quantity: 2 },
      ],
    });
  }, /stok/i);

  const row = db.db.prepare('SELECT stock_qty, is_sold_out FROM products WHERE id = ?').get(productId) as any;
  assert.equal(row.stock_qty, 2);
  assert.equal(row.is_sold_out, 0);
});

test('Order CANCELLED tidak dapat dibayar atau dikembalikan dari CANCELLED, dan quantity non-integer ditolak', async () => {
  const { db, orderService, productId } = setup();
  const { PaymentService } = await import('../server/services/PaymentService.js');
  const paymentService = new PaymentService(db);
  orderService.updateProductStock(productId, 5, false);

  assert.throws(() => {
    orderService.createOrder({
      outletId: 'out_1',
      terminalId: 'TERM-01',
      cashierId: 'usr_asep',
      cashierName: 'Asep',
      items: [{ productId, variantSize: 'Regular', quantity: Number.NaN as unknown as number }],
    });
  }, /integer|quantity/i);

  const afterBadQty = db.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(productId) as any;
  assert.equal(afterBadQty.stock_qty, 5);

  const o = orderService.createOrder({
    outletId: 'out_1',
    terminalId: 'TERM-01',
    cashierId: 'usr_asep',
    cashierName: 'Asep',
    items: [{ productId, variantSize: 'Regular', quantity: 2 }],
  });
  orderService.updateOrderStatus(o.id, 'CANCELLED');

  assert.throws(() => {
    paymentService.processPayment({ orderId: o.id, paymentMethod: 'CASH', amountPaid: o.totalAmount });
  }, /cancel/i);

  assert.throws(() => {
    orderService.updateOrderStatus(o.id, 'PREPARING');
  }, /cancel/i);
});
