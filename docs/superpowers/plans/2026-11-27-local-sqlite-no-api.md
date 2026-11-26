# Eiger Coffee POS 100% Local SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah Eiger Coffee POS menjadi aplikasi 100% lokal berbasis SQLite (`data/outlet_pos.sqlite`) dengan *seed* data riil penuh (master, user, EDC, shift, transaksi), manajemen stok lokal aktif, serta menghapus total seluruh `fetch` ke API eksternal, modul ERP/Outbox, dan *shadow bypass* `localStorage`.

**Architecture:** Server outlet lokal (Express 5 + WebSocket + `node:sqlite` mode WAL) menjadi satu-satunya sumber kebenaran untuk katalog, stok, auth PIN lokal, order, pembayaran, cetak struk/label, shift/EOD, dan konfigurasi EDC. Seluruh kode `server/erp/*`, `OutboxSyncService`, `ErpGatewayService`, `MockErpService`, serta fetch ke Cloud SSO/ERP di frontend dan backend dihapus penuh. Seeder idempoten di `server/db/seed.ts` mengisi data riil Eiger Coffee secara otomatis pada DB kosong maupun lewat perintah `yarn db:seed` / `yarn db:reset`.

**Tech Stack:** Node.js (`node:sqlite`, `node:test`), TypeScript, Express 5, WebSocket (`ws`), React 19, Vite 8, Tailwind CSS 4, Electron 45.

**Spec:** [2026-11-27-local-sqlite-no-api-design.md](file:///home/amirmufid/projects/eal/en-eiger-coffee/docs/superpowers/specs/2026-11-27-local-sqlite-no-api-design.md)

## Global Constraints

- Nol panggilan jaringan / `fetch()` ke API eksternal (Cloud SSO `api-sso.*` maupun Cloud ERP `api-eagle.*` / `api-erp-dev.*`) di `src/`, `server/`, dan `electron/`.
- Hapus total direktori `server/erp/`, `OutboxSyncService.ts`, `ErpGatewayService.ts`, `MockErpService.ts`, `local-modifiers.config.ts`, `edcApi.service.ts`, `edcErpSync.service.ts`, serta tabel `outbox_events` dan kolom `erp_*` dari `SCHEMA_SQL`.
- Frontend (`src/services/api.ts`) wajib berkomunikasi langsung ke server outlet lokal (`API_BASE`, default `http://localhost:3344`) tanpa *shadow fallback* `localStorage` pada `getCatalog`, `getOrders`, `getOrder`, `createOrder`, dan `payOrder`.
- Database file default adalah `data/outlet_pos.sqlite` (overrideable via `SQLITE_DB_PATH` atau `DATA_DIR` untuk isolasi test).
- Seeder otomatis mengisi 26 produk riil Eiger Coffee (semuanya dengan `stock_qty` non-null realistis), 5 grup modifier (`mod_*`), 6 staff user ber-PIN 5 digit, 2 konfigurasi EDC di SQLite, 2 shift historis `CLOSED`, dan 14+ transaksi historis (tanggal `H-2` & `H-1`) agar `order_sequence` hari berjalan mulai bersih dari `000001`.
- Seluruh `yarn test` dan `yarn build` wajib lulus 100% setelah semua perubahan.

## Review Focus

- **Oversell multi-baris SKU sama dalam satu order:** Satu order berisi 2 baris produk yang sama (mis. `Regular` + `Large`) dengan total kuantitas melebihi `stock_qty` harus gagal dan melakukan rollback penuh tanpa mengurangi sebagian stok. -> Diuji pada Task 3 (`OrderService`).
- **Double cancellation / refund tidak menggandakan stok:** Memanggil `updateOrderStatus(orderId, 'CANCELLED')` dua kali pada order yang sama tidak boleh mengembalikan `stock_qty` dua kali. -> Diuji pada Task 3 (`OrderService`).
- **Sinkronisasi `is_sold_out` saat stok habis & restock:** Order yang menghabiskan `stock_qty` hingga `0` wajib menandai `is_sold_out = 1` dan menolak order berikutnya; pembatalan atau restock (`> 0`) wajib mengembalikan `is_sold_out = 0`. -> Diuji pada Task 3 (`OrderService`).
- **Idempotensi seeder & keamanan `order_sequence` hari berjalan:** Memanggil `seedFullLocalDatabase()` atau membuka ulang `OutletDatabase` pada DB yang sudah berisi order hari ini tidak boleh menggandakan produk, user, EDC, shift, atau transaksi historis. -> Diuji pada Task 2 (`seedFullLocalDatabase`).
- **Konsistensi flag `isDefault` pada `edc_configurations`:** Menyimpan EDC baru dengan `isDefault: true` atau menghapus EDC default harus selalu menyisakan tepat maksimal satu konfigurasi default aktif di SQLite. -> Diuji pada Task 4 (`EdcConfigService`).

---

### Task 1: Clean SQLite Schema, Config & Remove ERP/Outbox Backend Modules

**Files:**
- Delete: `server/erp/` (seluruh file), `server/services/OutboxSyncService.ts`, `server/services/ErpGatewayService.ts`, `server/services/MockErpService.ts`, `server/config/local-modifiers.config.ts`
- Modify: `server/db/schema.ts`, `server/db/database.ts`, `server/config/outlet-env.ts`, `server/types/index.ts`, `.env`, `.env.example`
- Test: `tests/p0-core.test.ts` (bagian skema awal — akan dilengkapi pada Task 6, di task ini pakai verifikasi inline `tsx --test` sementara atau test skema terfokus)

**Interfaces:**
- Produces:
  - `SCHEMA_SQL` di `server/db/schema.ts` (tanpa `outbox_events` dan tanpa kolom `erp_*`, dengan tabel `edc_configurations`).
  - `OutletDatabase(customPath?: string, options?: { skipAutoSeed?: boolean; seedTransactions?: boolean })` di `server/db/database.ts`.
  - `resolveOrderTaxRate(): number` dan `getOutletEnvConfig()` di `server/config/outlet-env.ts`.
  - `EdcConfigurationRecord` di `server/types/index.ts` (dan hapus `OutboxEventRecord`).

- [ ] **Step 1: Hapus direktori dan file ERP/Outbox backend yang tidak lagi dipakai**

```bash
rm -rf server/erp server/services/OutboxSyncService.ts server/services/ErpGatewayService.ts server/services/MockErpService.ts server/config/local-modifiers.config.ts
```

- [ ] **Step 2: Perbarui `server/types/index.ts` dan `server/config/outlet-env.ts`**
  - Di `server/types/index.ts`: hapus `OutboxEventRecord` dan properti `syncedAt` di `OrderRecord` (opsional, bersihkan agar tidak ada referensi outbox), lalu tambahkan `EdcConfigurationRecord` sesuai kolom tabel `edc_configurations`.
  - Di `server/config/outlet-env.ts`: tambahkan `resolveOrderTaxRate(): number` yang membaca `process.env.OUTLET_TAX_RATE` (valid `0..1`, fallback `0.1`).

- [ ] **Step 3: Perbarui `server/db/schema.ts`**
  - Hapus definisi tabel `outbox_events` dan `idx_outbox_status_retry`.
  - Hapus kolom `erp_product_id` dari tabel `products`, dan hapus `synced_at` dari `orders` (atau pastikan kolom tabel bersih tanpa `erp_*`).
  - Tambahkan tabel `edc_configurations` lengkap dengan `created_at` dan `updated_at`.

- [ ] **Step 4: Perbarui `server/db/database.ts`**
  - Hapus import `shouldSyncProductModifiersFromErp` dan `purgeLegacyLocalModifierGroups`.
  - Hapus `purgeLegacyDemoProducts()`, migrasi kolom `erp_*`, dan `seedUsersIfEmpty()` lama.
  - Tambah opsi constructor: `constructor(customPath?: string, options?: { skipAutoSeed?: boolean; seedTransactions?: boolean })`.
  - Pada `initSchema()`: tetap jalankan `this.db.exec(SCHEMA_SQL)` dan bersihkan legacy table `DROP TABLE IF EXISTS outbox_events;` agar DB eksisting bersih saat dibuka.
  - Selalu panggil `ensureLocalModifierGroups(this.db)` kecuali `options?.skipAutoSeed === true` (akan disambungkan ke `seedFullLocalDatabase` pada Task 2).

- [ ] **Step 5: Bersihkan `.env` dan `.env.example`**
  - Hapus `ERP_BASE_URL`, `ERP_API_KEY`, `ERP_SYNC_ENABLED`, `ERP_SYNC_INTERVAL_MS`.
  - Tambahkan `OUTLET_TAX_RATE=0.1`.

- [ ] **Step 6: Verifikasi kompilasi modul DB & schema dengan `tsx`**

Run: `npx tsx -e "import { OutletDatabase } from './server/db/database.js'; const db = new OutletDatabase(':memory:', { skipAutoSeed: true }); console.log(db.db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all().map(r => r.name));"`
Expected: Daftar tabel berisi `edc_configurations`, `modifier_groups`, `order_items`, `order_sequence`, `orders`, `print_jobs`, `products`, `shifts`, `users` — dan TIDAK ada `outbox_events`.

---

### Task 2: Full Real Data Seeder & CLI Scripts

**Files:**
- Create: `server/db/seed.ts`, `scripts/db-seed.ts`
- Modify: `server/db/database.ts`, `package.json`
- Test: `tests/seed.test.ts` (atau bagian test di `tests/p0-core.test.ts` — buat `tests/seed.test.ts` untuk memisahkan siklus TDD Task 2)

**Interfaces:**
- Consumes: `OutletDatabase` (`server/db/database.ts`), `ensureLocalModifierGroups` & `resolveLocalModifierGroupIdsForProduct` (`server/catalog/local-modifier-groups.service.ts`).
- Produces:
  - `seedFullLocalDatabase(db: DatabaseSync, options?: { includeTransactions?: boolean }): SeedSummary` di `server/db/seed.ts`.
  - `REAL_SEED_PRODUCTS` (26 SKU riil), `REAL_SEED_USERS` (6 staff), `REAL_SEED_EDC_CONFIGS` (2 mesin EDC).
  - Scripts `yarn db:seed` dan `yarn db:reset` di `package.json`.

- [ ] **Step 1: Tulis test yang gagal di `tests/seed.test.ts`**

```ts
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
```

- [ ] **Step 2: Jalankan test untuk memverifikasi gagal**

Run: `npx tsx --test tests/seed.test.ts`
Expected: FAIL karena `server/db/seed.ts` belum ada.

- [ ] **Step 3: Implementasikan `server/db/seed.ts`**
  - Definisikan 26 produk riil Eiger Coffee (`Berry Honey Lemon`, `Coconut Macha`, `Forest Honey Lychee`, `Honey Lemon Tea`, `Kiwi Lemonade`, `Matcha Latte`, `Matcha Taro`, `Raspberry Lemonade`, `Strawberry Lemonade`, `Summer Eiger Tea`, `Summit Peach Mango Tea`, `Yuzu Jasmine Lemonade`, `Yuzu Lemonade`, `Butterscotch Sea Salt`, `Caffe Latte`, `Cappucino`, `Clasic Mount Blanc`, `Classic Montblanc`, `Eiger Mart Coffee`, `Ice Cappucino`, `Ice Latte`, `Iced Long Black`, `Iced Palm Sugar Latte (Dev Test)`, `Long Black`, `Nutty Oat Latte`, `Matcha Strawberry Cheese Cake`) dengan harga riil, `stock_qty` awal realistis (`30` s.d. `80`), dan `modifier_group_ids_json` via `resolveLocalModifierGroupIdsForProduct`.
  - Definisikan 6 user (`usr_asep` PIN `12345`, `usr_raka` PIN `11223`, `usr_luthfia` PIN `20261`, `usr_nadia` PIN `33445`, `usr_spv` PIN `88888`, `usr_mgr` PIN `99999`).
  - Definisikan 2 konfigurasi EDC (`edc_danamon_serial` default `SERIAL`, `edc_mandiri_tcp` cadangan `TCP_IP`).
  - Jika `includeTransactions !== false` dan tabel `shifts` & `orders` masih kosong, seed:
    - 2 shift `CLOSED` pada `H-2` dan `H-1` (relatif terhadap `new Date()`, gunakan helper tanggal agar selalu di masa lalu dan tidak menyentuh `dateKey` hari ini!) beserta Z-Report `print_jobs` (`COMPLETED`).
    - 14 order historis pada `H-2` dan `H-1` dengan variasi `CASH`, `QRIS`, `EDC_DEBIT`, `EDC_CREDIT`, status `COMPLETED`, `READY`, `PREPARING`, `PENDING` (2 order belum bayar agar tab *Belum Bayar* langsung punya contoh), dan `CANCELLED` (`REFUNDED`), lengkap dengan `order_items` (termasuk snapshot modifier dari `mod_*`), `print_jobs` (`RECEIPT` + `CUP_LABEL`), dan entri `order_sequence` untuk `H-2` & `H-1`.
  - Pastikan semua operasi seed terbungkus transaksi atomik (`BEGIN IMMEDIATE ... COMMIT`) dan idempoten (`COUNT(*)` check / `INSERT OR IGNORE`).

- [ ] **Step 4: Sambungkan `seedFullLocalDatabase` ke `OutletDatabase` dan buat `scripts/db-seed.ts`**
  - Di `server/db/database.ts`: panggil `ensureLocalModifierGroups(this.db)` lalu `seedFullLocalDatabase(this.db, { includeTransactions: options?.seedTransactions !== false })` saat `!options?.skipAutoSeed`.
  - Buat `scripts/db-seed.ts` mendukung argumen `--reset` (hapus `data/outlet_pos.sqlite*` terlebih dahulu sebelum inisialisasi `OutletDatabase`).
  - Tambahkan ke `package.json`: `"db:seed": "tsx scripts/db-seed.ts"` dan `"db:reset": "tsx scripts/db-seed.ts --reset"`.

- [ ] **Step 5: Jalankan `tests/seed.test.ts`**

Run: `npx tsx --test tests/seed.test.ts`
Expected: PASS (1/1).

---

### Task 3: Local Stock Validation/Decrement, Payment & Shift Service Cleanup

**Files:**
- Modify: `server/services/OrderService.ts`, `server/services/PaymentService.ts`, `server/services/ShiftService.ts`
- Test: `tests/order-stock.test.ts`

**Interfaces:**
- Consumes: `OutletDatabase`, `getOutletEnvConfig`, `resolveOrderTaxRate` (`server/config/outlet-env.ts`).
- Produces:
  - `OrderService.createOrder(req: CreateOrderRequest): OrderRecord` (cek `is_sold_out` & akumulasi kuantitas per `productId` sebelum kurangi `stock_qty`; auto-set `is_sold_out = 1` jika `stock_qty === 0`).
  - `OrderService.updateOrderStatus(orderId: string, status: OrderStatus): OrderRecord` (kembalikan stok atomik jika transisi dari non-`CANCELLED` ke `CANCELLED`).
  - `OrderService.updateProductStock(productId: string, stockQty: number | null, isSoldOut?: boolean): ProductStockResult`.
  - `OrderService.restockAllProducts(defaultQty?: number): number`.
  - `PaymentService.processPayment(...)` dan `PaymentService.reconcilePayment(...)` tanpa `outbox_events`.
  - `ShiftService.openShift(...)` dan `ShiftService.closeShift(...)` tanpa `outbox_events`.

- [ ] **Step 1: Tulis unit test untuk stok lokal & rollback di `tests/order-stock.test.ts`**

```ts
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
    outletId: 'out_1', terminalId: 'TERM-01', cashierId: 'usr_asep', cashierName: 'Asep',
    items: [{ productId, variantSize: 'Regular', quantity: 3 }],
  });

  let row = db.db.prepare('SELECT stock_qty, is_sold_out FROM products WHERE id = ?').get(productId) as any;
  assert.equal(row.stock_qty, 0);
  assert.equal(row.is_sold_out, 1);

  assert.throws(() => {
    orderService.createOrder({
      outletId: 'out_1', terminalId: 'TERM-01', cashierId: 'usr_asep', cashierName: 'Asep',
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
      outletId: 'out_1', terminalId: 'TERM-01', cashierId: 'usr_asep', cashierName: 'Asep',
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
```

- [ ] **Step 2: Jalankan test untuk memverifikasi gagal**

Run: `npx tsx --test tests/order-stock.test.ts`
Expected: FAIL karena `updateProductStock` & validasi stok belum ada.

- [ ] **Step 3: Implementasikan perubahan di `OrderService.ts`, `PaymentService.ts`, dan `ShiftService.ts`**
  - `OrderService.ts`:
    - Ganti import ERP dengan `resolveOrderTaxRate` dari `../config/outlet-env.js`.
    - Di `createOrder()` dalam `BEGIN IMMEDIATE`: hitung total kuantitas per `productId` terlebih dahulu atau validasi stok langsung setelah `SELECT * FROM products WHERE id = ? AND is_active = 1` lalu kurangi stok di SQLite (`UPDATE products SET stock_qty = ?, is_sold_out = ?, updated_at = ? WHERE id = ?`). Karena berada di dalam transaksi `BEGIN IMMEDIATE`, jika item kedua dalam order yang sama gagal (stok tak cukup), `ROLLBACK` membatalkan pengurangan stok item pertama secara atomik.
    - Di `updateOrderStatus()`: bungkus dengan `BEGIN IMMEDIATE`, baca status order sebelumnya; jika `existing.status !== 'CANCELLED' && status === 'CANCELLED'`, kembalikan `stock_qty` per `order_items` dan set `is_sold_out = 0` bila `stock_qty > 0`.
    - Tambah `updateProductStock(productId, stockQty, isSoldOut)` dan `restockAllProducts(defaultQty = 50)`.
  - `PaymentService.ts`: hapus import `resolveOutletIdForErp` dan seluruh insert ke `outbox_events` pada `processPayment()`.
  - `ShiftService.ts`: ganti `resolveOutletIdForErp(req.outletId)` dengan `req.outletId || getOutletEnvConfig().outletId`, dan hapus insert `POS_EOD_CLOSED` ke `outbox_events` pada `closeShift()`.

- [ ] **Step 4: Jalankan `tests/order-stock.test.ts`**

Run: `npx tsx --test tests/order-stock.test.ts`
Expected: PASS (2/2).

---

### Task 4: Local EdcConfigService & Clean Express Server Routes

**Files:**
- Create: `server/services/EdcConfigService.ts`
- Modify: `server/server.ts`
- Test: `tests/edc-sqlite.test.ts`

**Interfaces:**
- Consumes: `OutletDatabase`, `EdcConfigurationRecord`, `OrderService`, `PaymentService`, `ShiftService`, `PrintQueueService`.
- Produces:
  - `EdcConfigService` (`listConfigs`, `saveConfig`, `deleteConfig`, `setDefault`, `updateTestResult`).
  - Route lokal baru di `server/server.ts`:
    - `PATCH /api/catalog/products/:id/stock`
    - `POST /api/catalog/restock-all`
    - `GET /api/edc-configurations`, `POST /api/edc-configurations`, `PUT /api/edc-configurations/:id`, `DELETE /api/edc-configurations/:id`, `POST /api/edc-configurations/:id/default`, `POST /api/edc-configurations/:id/test-result`
    - `GET /api/db/status`, `POST /api/db/vacuum`
  - Penghapusan penuh route `/api/erp/*`, `/api/outbox/*`, `/api/chaos/toggle-erp`, `/api/catalog/sync-erp`.

- [ ] **Step 1: Tulis test untuk `EdcConfigService` di `tests/edc-sqlite.test.ts`**

```ts
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
  assert.equal(initial.filter(c => c.isDefault).length, 1);

  const added = edcService.saveConfig({
    name: 'EDC BCA Counter 2',
    bank: 'BCA',
    connectionType: 'TCP_IP',
    host: '192.168.1.99',
    port: 2001,
    isDefault: true,
  });

  let all = edcService.listConfigs();
  assert.equal(all.filter(c => c.isDefault).length, 1);
  assert.equal(all.find(c => c.isDefault)?.id, added.id);

  edcService.deleteConfig(added.id);
  all = edcService.listConfigs();
  assert.equal(all.filter(c => c.isDefault).length, 1, 'Setelah default dihapus, satu konfigurasi tersisa otomatis menjadi default');
});
```

- [ ] **Step 2: Jalankan test untuk memverifikasi gagal**

Run: `npx tsx --test tests/edc-sqlite.test.ts`
Expected: FAIL karena `EdcConfigService` belum ada.

- [ ] **Step 3: Implementasikan `server/services/EdcConfigService.ts`**
  - Semua write (`saveConfig`, `setDefault`, `deleteConfig`) berada dalam transaksi `BEGIN IMMEDIATE ... COMMIT` untuk menjaga invarian maksimal satu `is_default = 1`.
  - Saat `deleteConfig` menghapus baris dengan `is_default = 1`, otomatis promosikan baris aktif tertua menjadi `is_default = 1`.

- [ ] **Step 4: Perbarui `server/server.ts`**
  - Hapus semua import dan inisialisasi `OutboxSyncService`, `MockErpService`, `ErpGatewayService`, dan seluruh modul `./erp/*` serta `./config/local-modifiers.config.js`.
  - Sederhanakan `createServer(options?)` (`dbPath`, `receiptPrinter`, `cupLabelPrinter`).
  - Hapus semua route ERP, outbox, dan `toggle-erp`.
  - Perbarui `POST /api/auth/pin` agar murni memverifikasi ke `shiftService.verifyPin(pinStr)` (`authMode: 'local'`).
  - Perbarui `POST /api/orders`, `POST /api/orders/:id/status`, `PATCH /api/catalog/products/:id/stock`, dan `POST /api/catalog/restock-all` agar mem-broadcast `catalog:updated` via WebSocket saat stok berubah.
  - Perbarui `POST /api/orders/:id/reconcile-payment` agar menerima `{ resolvedStatus: 'PAID' | 'FAILED', notes?: string }` dan langsung memanggil `paymentService.reconcilePayment(...)`.
  - Tambahkan route `/api/edc-configurations/*`, `/api/db/status`, dan `/api/db/vacuum`.

- [ ] **Step 5: Jalankan `tests/edc-sqlite.test.ts`**

Run: `npx tsx --test tests/edc-sqlite.test.ts`
Expected: PASS (1/1).

---

### Task 5: Frontend Removal of External API & Shadow `localStorage`

**Files:**
- Delete: `src/services/edcApi.service.ts`, `src/services/edcErpSync.service.ts`
- Modify: `src/services/api.ts`, `src/services/edcStorage.ts`, `src/App.tsx`, `src/components/PinLoginModal.tsx`, `src/components/EdcSettingsSection.tsx`, `src/components/SystemSettingsView.tsx`, `src/components/EodClosingModal.tsx`

**Interfaces:**
- Consumes: Endpoint lokal di `server/server.ts` (`/api/catalog`, `/api/orders`, `/api/auth/pin`, `/api/shifts/*`, `/api/edc-configurations/*`, `/api/db/*`, `/api/catalog/restock-all`, `/api/catalog/products/:id/stock`).
- Produces:
  - `api` di `src/services/api.ts` (100% ke `API_BASE`, nol fetch eksternal, nol shadow `localStorage`, tipe baru `DbStatus`).
  - `edcStorage` di `src/services/edcStorage.ts` (tetap menyediakan API sinkron untuk `PaymentModal`/`edc-integration.test` plus method sinkronisasi dengan `/api/edc-configurations`).

- [ ] **Step 1: Hapus `src/services/edcApi.service.ts` dan `src/services/edcErpSync.service.ts`**

```bash
rm -f src/services/edcApi.service.ts src/services/edcErpSync.service.ts
```

- [ ] **Step 2: Bersihkan `src/services/api.ts`**
  - Hapus semua URL `api-sso.*`, `api-eagle.*`, dan `localStorage` token/cache (`eal_sso_token`, `eal_erp_token`, `eiger_pos_orders`, `eiger_coffee_catalog_cache`).
  - `getCatalog`, `getOrders`, `getOrder`, `createOrder`, `payOrder`, `loginPin` langsung memanggil `${API_BASE}/api/...` dan melempar error HTTP bila gagal (tidak lagi membuat order palsu di `localStorage`).
  - Hapus `getSyncStatus`, `toggleErpOnline`, `triggerOutboxSync`, `syncErpCatalog`.
  - Tambah `getDbStatus(): Promise<DbStatus>`, `vacuumDatabase()`, `updateProductStock(productId, stockQty, isSoldOut?)`, `restockAllProducts(defaultQty?)`, serta method CRUD EDC ke `/api/edc-configurations`.
  - Perbarui `reconcileOrderPayment(orderId, resolvedStatus, notes)` ke `/api/orders/${orderId}/reconcile-payment`.

- [ ] **Step 3: Perbarui `src/services/edcStorage.ts` dan `src/components/EdcSettingsSection.tsx`**
  - `edcStorage.ts`: tambahkan `hydrateFromServer(configs: EdcConfiguration[])` agar cache lokal selalu mencerminkan isi tabel SQLite `edc_configurations`.
  - `EdcSettingsSection.tsx`: hapus seluruh tombol *"Sync dari ERP"*, *"Push ke ERP"*, banner `PosSalesErpConfig`, dan `EdcApiService`; muat daftar EDC dari `api.getEdcConfigurations()` (lalu `edcStorage.hydrateFromServer(...)`) dan simpan/hapus/set-default/update-test-result lewat `api` ke SQLite.

- [ ] **Step 4: Perbarui `src/App.tsx`, `PinLoginModal.tsx`, `SystemSettingsView.tsx`, dan `EodClosingModal.tsx`**
  - `src/App.tsx`: hapus `ensureEdcConfiguredFromErp`, ganti status `syncStatus` / badge `ERP` di navbar menjadi `dbStatus` / badge `SQLite` (hijau saat terhubung ke server lokal), dan dengarkan pesan WS `catalog:updated` untuk memanggil `loadCatalog()`.
  - `src/components/PinLoginModal.tsx`: hapus `ensureEdcConfiguredFromErp`, ubah copy `"PIN SSO Kasir"` menjadi `"PIN Kasir Lokal"`.
  - `src/components/SystemSettingsView.tsx`:
    - Hapus kartu *"Konektivitas ERP Cloud"* di tab Hardware.
    - Di tab `CHAOS` (ubah judul menjadi *Uji Ketahanan Perangkat Lokal*), hapus kotak *"Jalur Sinkronisasi ERP"* dan sisakan panel *Printer Stiker Cup Label* (simulasi kabel lepas/sambung & antrean cetak SQLite).
    - Di tab `DATABASE`, tampilkan data nyata dari `api.getDbStatus()` (`outlet_pos.sqlite`, total produk, user, order, shift, EDC), tombol *"Vacuum & Re-index Database"* memanggil `api.vacuumDatabase()`, dan tambahkan panel **Kontrol Stok Menu Lokal** berisi tombol *"Isi Ulang Stok Semua Menu (50)"* (`api.restockAllProducts(50)`) serta daftar ringkas produk untuk mengubah stok / status habis.
  - `src/components/EodClosingModal.tsx`: hapus kalimat *"event POS_EOD_CLOSED masuk outbox ERP"* dan ubah menjadi *"Data closing tersimpan di SQLite lokal dan Z-Report masuk antrean cetak."*

- [ ] **Step 5: Verifikasi build TypeScript + Vite dan cek tidak ada fetch eksternal**

Run: `yarn build && ! grep -rnE "api-sso|api-eagle|api-erp|eigeradventureland|eigernature" src/ server/ electron/`
Expected: `yarn build` exit 0 dan grep tidak menemukan URL API eksternal apa pun.

---

### Task 6: Align Test Suite, Reset Workspace `.sqlite`, and Full Verification

**Files:**
- Modify: `tests/helpers/test-catalog.ts`, `tests/p0-core.test.ts`, `tests/edc-integration.test.ts`
- Replace: `tests/p1-lan-outbox.test.ts` -> `tests/p1-lan-sqlite.test.ts`
- Regenerate: `data/outlet_pos.sqlite` (via `yarn db:reset`)

- [ ] **Step 1: Perbarui `tests/helpers/test-catalog.ts`**
  - Hapus kolom `erp_product_id` dari `INSERT INTO products` agar selaras skema SQLite baru.

- [ ] **Step 2: Perbarui `tests/p0-core.test.ts`, `tests/p1-lan-sqlite.test.ts`, dan `tests/edc-integration.test.ts`**
  - `tests/p0-core.test.ts`:
    - Test pertama memverifikasi `OutletDatabase(TEST_DB_PATH)` auto-seed penuh (26 produk dengan `stock_qty` terisi, 5 modifier groups, 6 staff users, 2 EDC configs, 2 shifts, 14+ orders).
    - Test `P0 Item 12` (EOD Closing) menghapus assertion `outbox_events` dan tetap memverifikasi shift `CLOSED`, Z-Report `print_jobs`, serta `cashDifference`.
  - Hapus `tests/p1-lan-outbox.test.ts` dan buat `tests/p1-lan-sqlite.test.ts` yang menguji:
    - Konkurensi penomoran order 2 kasir LAN tanpa tabrakan.
    - Persistensi order, modifier, dan urutan nomor order setelah `OutletDatabase.resetInstance()`.
    - Ketahanan antrean cetak saat printer cup label offline lalu pulih (`MockPrinterAdapter`).
  - `tests/edc-integration.test.ts`:
    - Hapus assertion `outbox_events`, tambahkan verifikasi bahwa transaksi `EDC_DEBIT` dan `QRIS` tersimpan `PAID` di SQLite beserta `payment_ref`, dan `EdcConfigService` membaca konfigurasi default dari SQLite.

- [ ] **Step 3: Reset & seed ulang `data/outlet_pos.sqlite` serta jalankan semua verifikasi**

Run: `yarn db:reset && yarn test && yarn build`
Expected:
- `yarn db:reset` selesai dengan ringkasan 26 produk, 5 modifier groups, 6 users, 2 EDC configs, 2 closed shifts, 14+ orders.
- `yarn test` seluruh test lulus (0 fail, 0 skipped).
- `yarn build` exit 0.
- Cek cepat `data/outlet_pos.sqlite` memakai `node -e` bahwa tabel `outbox_events` tidak ada dan semua tabel master + transaksi terisi penuh.
