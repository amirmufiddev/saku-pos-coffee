# Design Spec: Eiger Coffee POS 100% Local SQLite (Zero External API)

**Date:** 2026-11-27
**Status:** Ready for Approval
**Approach Selected:** Approach B — Hard-Strip Total Modul ERP & Outbox, Full Local SQLite (with Active Local Stock)

---

## 1. Intent & Why

Mengubah aplikasi **Eiger Coffee Grab & Go POS** agar beroperasi **100% lokal** di atas database SQLite (`data/outlet_pos.sqlite`), lengkap dengan *seed* data riil (master produk, grup modifier, pengguna/staff, konfigurasi EDC, shift, dan histori transaksi), serta menghapus seluruh `fetch` dan integrasi ke API eksternal (Cloud SSO & Cloud ERP) maupun *shadow bypass* `localStorage`.

Dengan arsitektur ini:
- Aplikasi langsung siap dipakai secara offline/lokal tanpa kredensial SSO, internet, atau server ERP.
- `data/outlet_pos.sqlite` menjadi satu-satunya *source of truth* bagi seluruh proses POS, KDS Barista, Customer Display, cetak struk/label, EDC, dan closing shift (EOD).

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
1. **Zero External API Calls:** Menghapus total seluruh kode `fetch` ke Cloud SSO (`api-sso.*`) dan Cloud ERP (`api-eagle.*`, `api-erp-dev.*`), termasuk modul `server/erp/*`, `OutboxSyncService`, `ErpGatewayService`, `MockErpService`, dan UI sinkronisasi ERP.
2. **Single Source of Truth in SQLite:** Menghapus *shadow fallback* `localStorage` di `src/services/api.ts` (`createOrder`, `payOrder`, `getCatalog`, `getOrders`) agar semua pembacaan dan penulisan data transaksi & master melalui server lokal (`localhost:3344`) dan tersimpan ke SQLite.
3. **Full Real Data Seeder:** Menyediakan mekanisme *seed* otomatis dan CLI yang idempoten untuk mengisi data riil Eiger Coffee secara penuh (master produk 26 SKU, 5 grup modifier, staff/user dengan PIN 5 digit, master EDC di SQLite, shift historis, serta transaksi lengkap dengan item dan print job).
4. **Local Hardware & LAN Intact:** Mempertahankan penuh fungsionalitas LAN WebSocket (KDS Barista & multi-terminal), Customer Display, antrean cetak struk & cup label (Electron/ESC-POS/Mock), serta integrasi mesin EDC serial/TCP-IP lokal.

### Non-Goals
- Menghapus server HTTP lokal Express (`localhost:3344`) atau WebSocket (`ws`). Frontend React tetap berkomunikasi dengan backend outlet lokal via HTTP & WS agar multi-terminal LAN dan KDS tetap berjalan.
- Mengubah alur visual utama kasir, KDS, Customer Display, atau protokol serial mesin EDC (`electron/edc/*`).

### Anti-Goals
- Menyisakan *fallback* tersembunyi ke `localStorage` untuk membuat/membayar order sehingga transaksi terlihat sukses di UI padahal tidak tersimpan di SQLite.
- Menyisakan *auto-seed* yang merusak penomoran order harian (`order_sequence` hari berjalan) atau bentrok dengan test unit yang membutuhkan database bersih.

---

## 3. Constraints

- **Runtime:** Node.js dengan `node:sqlite` (`DatabaseSync`, mode WAL), Express 5, TypeScript, React 19, Vite 8, Electron 45.
- **Database File:** `data/outlet_pos.sqlite` (dapat dioverride lewat `SQLITE_DB_PATH` atau `DATA_DIR` untuk isolasi test).
- **Backward Compatibility Data Lokal:** Data riil Eiger Coffee yang sudah ada (26 produk riil `PRD-*`, 5 grup modifier `mod_*`, user 5-digit PIN) harus dipertahankan dan dijadikan basis seeder resmi.
- **Test Verification:** Seluruh test suite (`yarn test`, `yarn build`) harus diperbarui dan lulus 100% setelah penghapusan modul ERP/Outbox.

---

## 4. Approaches Considered

### Approach A: Local-First SQLite + Outbox Tetap Lokal
Mematikan seluruh HTTP keluar ke ERP/SSO (`ERP_SYNC_ENABLED=false`) dan menghapus fetch cloud di frontend, namun mempertahankan tabel `outbox_events`, `OutboxSyncService`, `MockErpService`, dan UI status outbox secara lokal.
- **Tradeoff:** Risiko regresi sangat kecil terhadap test lama, tetapi menyisakan konsep dan tabel ERP/Outbox yang tidak lagi dibutuhkan di aplikasi 100% lokal.

### Approach B (Selected): Hard-Strip Total Modul ERP & Outbox
Menghapus seluruh fetch API eksternal **sekaligus** meniadakan folder `server/erp/*`, `OutboxSyncService`, `ErpGatewayService`, `MockErpService`, tabel `outbox_events`, kolom ERP di skema baru, UI ERP/Chaos ERP, serta memperbarui seluruh layanan dan test agar murni lokal.
- **Tradeoff:** Membutuhkan penyesuaian pada `PaymentService`, `ShiftService`, `SystemSettingsView`, `EdcSettingsSection`, dan test suite, namun menghasilkan arsitektur 100% lokal yang bersih tanpa sisa ketergantungan/istilah ERP.

---

## 5. Architecture & Detailed Design

### 5.1 Database Schema & Migrations (`server/db/schema.ts`, `server/db/database.ts`)

1. **Skema Bersih (`SCHEMA_SQL`):**
   - Pertahankan tabel inti: `order_sequence`, `orders`, `order_items`, `print_jobs`, `products`, `modifier_groups`, `users`, `shifts`.
   - **Hapus** tabel `outbox_events` dan indeksnya dari `SCHEMA_SQL`.
   - **Hapus** kolom terkait ERP dari definisi skema & migrasi `database.ts`:
     - `orders`: hapus `erp_trx_code`, `erp_sync_status`, `erp_sync_error`.
     - `products`: hapus `erp_product_id`.
     - `shifts`: hapus `erp_cashier_shift_id`.
     - `users`: hapus `erp_sso_pin`.
   - **Tambah** tabel `edc_configurations` di SQLite agar konfigurasi mesin EDC tersimpan permanen di `.sqlite` (tidak bergantung pada `localStorage`):
     ```sql
     CREATE TABLE IF NOT EXISTS edc_configurations (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       bank TEXT,
       connection_type TEXT NOT NULL, -- 'SERIAL' | 'TCP_IP'
       host TEXT,
       ip_pis TEXT,
       ip_terminal TEXT,
       port INTEGER,
       baud_rate INTEGER DEFAULT 115200,
       port_path TEXT,
       vendor_id TEXT,
       product_id TEXT,
       serial_number TEXT,
       manufacturer TEXT,
       is_default INTEGER NOT NULL DEFAULT 0,
       terminal_id TEXT,
       last_test_status TEXT,
       last_tested_at TEXT,
       last_test_error TEXT,
       is_active INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     );
     ```
2. **Inisialisasi `OutletDatabase`:**
   - Hapus `purgeLegacyDemoProducts()`, `shouldSyncProductModifiersFromErp()`, dan `purgeLegacyLocalModifierGroups()`.
   - Constructor menerima opsi opsional `{ skipAutoSeed?: boolean; seedTransactions?: boolean }`:
     - Default di runtime aplikasi (`skipAutoSeed = false`, `seedTransactions = true`): memanggil `ensureLocalModifierGroups(db)` dan `seedFullLocalDatabase(db, { includeTransactions: true })` secara idempoten (hanya mengisi jika tabel kosong / record belum ada).
     - Pada skrip/test tertentu yang butuh DB kosong atau minimal, pemanggil dapat mengoper `{ skipAutoSeed: true }`.
   - Jika database lama (`data/outlet_pos.sqlite`) dibuka atau di-reset via `yarn db:reset`, drop `outbox_events` jika masih ada (`DROP TABLE IF EXISTS outbox_events`) dan lakukan `seedFullLocalDatabase` agar `.sqlite` di repo bersih 100%.

### 5.2 Full Real Data Seeder (`server/db/seed.ts`)

Buat modul seeder terpusat `server/db/seed.ts` (yang dipanggil otomatis oleh `OutletDatabase` dan juga dapat dijalankan via CLI `yarn db:seed` / `yarn db:reset`):

1. **Master Grup Modifier (5 grup):**
   - `mod_sugar` (Sugar Level: 100%, 50%, 25%, 0%)
   - `mod_ice` (Ice Level: Normal, Less, No Ice)
   - `mod_milk` (Dairy & Plant Milk: Fresh Milk, Oatly Oat Milk +8000, Almond Milk +8000, Soy Milk +6000)
   - `mod_shots` (Espresso Shots: Extra 1x +6000, Double 2x +12000)
   - `mod_syrup` (Flavored Syrups: Vanilla/Hazelnut/Caramel +5000)
2. **Master Produk (26 SKU Real Eiger Coffee):**
   - Menggunakan katalog riil Eiger Coffee yang mencakup kategori `Espresso & Milk`, `Artisan Teas & Non-Coffee`, dan `Pastries & Snacks` (mis. `Ice Cappucino`, `Cappucino`, `Ice Latte`, `Caffe Latte`, `Long Black`, `Iced Long Black`, `Nutty Oat Latte`, `Eiger Mart Coffee`, `Clasic Mount Blanc`, `Butterscotch Sea Salt`, `Matcha Latte`, `Matcha Taro`, `Coconut Macha`, `Summer Eiger Tea`, `Forest Honey Lychee`, `Honey Lemon Tea`, `Berry Honey Lemon`, `Kiwi Lemonade`, `Strawberry Lemonade`, `Raspberry Lemonade`, `Yuzu Lemonade`, `Yuzu Jasmine Lemonade`, `Matcha Strawberry Cheese Cake`, dll.) dengan harga regular/large, stok realistis (`stock_qty`), dan pemetaan `modifier_group_ids_json` via `resolveLocalModifierGroupIdsForProduct`.
3. **Master Staff / Users (PIN 5 digit):**
   - `usr_asep`: Asep Hidayat (`asep`, `CASHIER`, PIN `12345`)
   - `usr_raka`: Raka Pratama (`raka`, `CASHIER`, PIN `11223`)
   - `usr_luthfia`: Luthfia (`luthfia`, `BARISTA`, PIN `20261`)
   - `usr_nadia`: Nadia Putri (`nadia`, `BARISTA`, PIN `33445`)
   - `usr_spv`: Supervisor Outlet (`spv`, `SUPERVISOR`, PIN `88888`)
   - `usr_mgr`: Manager Outlet (`manager`, `MANAGER`, PIN `99999`)
4. **Master Konfigurasi EDC (`edc_configurations`):**
   - 2 mesin EDC siap pakai (1 default Serial USB Bank Danamon `COM3` / `115200` baud; 1 cadangan TCP/IP Bank Mandiri `192.168.1.55:9000`).
5. **Shift & Transaksi Historis Real:**
   - Ditempatkan pada **tanggal historis (H-2 dan H-1 relatif atau timestamp historis tetap)** sehingga `order_sequence` hari berjalan tetap bersih mulai dari `000001`, namun tab **Riwayat** dan **Pager Barista (KDS)** langsung kaya data realistis:
     - **2 Shift CLOSED** (H-2 & H-1) dengan rekap penjualan tunai/QRIS/EDC, `expected_cash`, `actual_cash`, `cash_difference`, serta Z-Report `print_jobs`.
     - **14+ Orders historis & aktif** mencakup:
       - Pembayaran `CASH`, `QRIS`, `EDC_DEBIT`, `EDC_CREDIT`.
       - Status `COMPLETED` (`PAID`), `READY` (`PAID`), `PREPARING` (`PAID`), `PENDING` (`PENDING` — agar kasir bisa uji langsung tombol *"Bayar Sekarang"* di Riwayat), dan `CANCELLED` (`REFUNDED`).
       - Opsi `takeaway` & `dinein` (lengkap dengan `pager_number`), `order_items` beserta `modifiers_json` snapshot, dan `print_jobs` (`RECEIPT` & `CUP_LABEL`).
6. **NPM/Yarn Scripts (`package.json`):**
   - `db:seed`: menjalankan seeder secara idempoten ke `data/outlet_pos.sqlite`.
   - `db:reset`: menghapus `data/outlet_pos.sqlite*` lalu membuat ulang dan mengisi *seed* penuh dari nol.

### 5.3 Backend Removal of ERP & Local Endpoints (`server/`)

1. **Hapus Modul ERP & Outbox:**
   - Hapus direktori `server/erp/` beserta seluruh isinya.
   - Hapus `server/services/OutboxSyncService.ts`, `server/services/ErpGatewayService.ts`, `server/services/MockErpService.ts`.
   - Hapus `server/config/local-modifiers.config.ts`.
2. **Update Services (`OrderService.ts`, `PaymentService.ts`, `ShiftService.ts`):**
   - `OrderService.ts`:
     - Gunakan `getOutletEnvConfig().outletId` dan konstanta/env lokal `OUTLET_TAX_RATE` (default `0.1`) di `server/config/outlet-env.ts`.
     - **Manajemen Stok Lokal (`stock_qty`):**
       - Pada `createOrder()` di dalam transaksi SQLite (`BEGIN IMMEDIATE`): jika `prod.is_sold_out === 1`, tolak dengan error eksplisit; jika `prod.stock_qty !== null`, validasi `prod.stock_qty >= itemInput.quantity` (jika kurang, rollback dan lempar error stok tidak mencukupi) lalu kurangi `stock_qty = stock_qty - quantity` dan set `is_sold_out = CASE WHEN stock_qty - quantity <= 0 THEN 1 ELSE 0 END`.
       - Pada `updateOrderStatus(orderId, 'CANCELLED')`: kembalikan `stock_qty` untuk seluruh `order_items` produk yang memiliki `stock_qty !== null` dan reset `is_sold_out = 0` jika stok kembali `> 0`.
       - Broadcast event WebSocket `catalog:updated` setiap kali order dibuat, dibatalkan, atau stok diperbarui agar seluruh terminal LAN/kasir memperbarui badge stok secara real-time.
   - `PaymentService.ts`: hapus seluruh blok insert ke `outbox_events` saat payment `PAID`; tetap lakukan update status `PAID` + `PREPARING` secara atomik dalam transaksi SQLite (`BEGIN IMMEDIATE ... COMMIT`). `reconcilePayment(orderId, resolvedStatus, notes)` bekerja murni lokal (dan jika `resolvedStatus === 'FAILED'` pada order yang dibatalkan, kembalikan stok jika statusnya menjadi `CANCELLED`).
   - `ShiftService.ts`: hapus insert `POS_EOD_CLOSED` ke `outbox_events` pada `closeShift()`; tetap update record `shifts` dan buat job cetak `Z-REPORT CLOSING` di `print_jobs`.
   - Tambah `server/services/EdcConfigService.ts` untuk CRUD `edc_configurations` di SQLite (`list`, `save`, `delete`, `setDefault`, `updateTestResult`).
3. **Update Routes (`server/server.ts`):**
   - **Hapus route ERP/Outbox/Chaos ERP:** `/api/outbox/status`, `/api/outbox/sync`, `/api/chaos/toggle-erp`, `/api/erp/*`, `/api/catalog/sync-erp`.
   - **Sederhanakan route Auth & Reconcile:**
     - `POST /api/auth/pin`: hanya memanggil `shiftService.verifyPin(pinStr)` dari SQLite `users`.
     - `POST /api/orders/:id/reconcile-payment`: menerima `{ resolvedStatus: 'PAID' | 'FAILED', notes?: string }` dan memanggil `paymentService.reconcilePayment(...)` langsung ke SQLite (broadcast WS jika berubah ke `PAID`).
   - **Tambah route lokal Stok, EDC & DB:**
     - `PATCH /api/catalog/products/:id/stock` (ubah `stockQty` / toggle `isSoldOut`, lalu broadcast `catalog:updated`)
     - `POST /api/catalog/restock-all` (reset/isi ulang stok seluruh produk ke stok awal default, mis. `50` atau nilai seed awal, lalu broadcast `catalog:updated`)
     - `GET /api/edc-configurations`
     - `POST /api/edc-configurations`
     - `PUT /api/edc-configurations/:id`
     - `DELETE /api/edc-configurations/:id`
     - `POST /api/edc-configurations/:id/default`
     - `POST /api/edc-configurations/:id/test-result`
     - `GET /api/db/status` (mengembalikan path DB, mode WAL, jumlah baris `products`, `users`, `orders`, `shifts`, `edc_configurations`)
     - `POST /api/db/vacuum` (menjalankan `VACUUM;` pada SQLite)
4. **Update `.env` & `.env.example`:**
   - Hapus `ERP_BASE_URL`, `ERP_API_KEY`, `ERP_SYNC_ENABLED`, `ERP_SYNC_INTERVAL_MS`.
   - Tambahkan `OUTLET_TAX_RATE=0.1` bila perlu eksplisit.

### 5.4 Frontend Removal of External API & Shadow `localStorage` (`src/`)

1. **Hapus Modul ERP Frontend:**
   - Hapus `src/services/edcApi.service.ts` dan `src/services/edcErpSync.service.ts`.
2. **Bersihkan `src/services/api.ts`:**
   - Hapus seluruh konstanta/URL Cloud (`api-sso.*`, `api-eagle.*`) dan token `eal_sso_token` / `eal_erp_token`.
   - Hapus semua *shadow bypass* `localStorage` (`eiger_pos_orders`, `eiger_coffee_catalog_cache`) di `getCatalog`, `getOrders`, `getOrder`, `createOrder`, `payOrder`: semua request wajib langsung ke `${API_BASE}/api/...` (server outlet + SQLite lokal) dan melempar error yang jelas jika server lokal tidak terjangkau.
   - `loginPin(pin)` memanggil langsung `POST ${API_BASE}/api/auth/pin`.
   - Hapus method `getSyncStatus`, `toggleErpOnline`, `triggerOutboxSync`, `syncErpCatalog`; ganti dengan `getDbStatus()`, `vacuumDatabase()`, dan CRUD `edcConfigurations` ke `${API_BASE}/api/edc-configurations`.
   - Update `reconcileOrderPayment(orderId, resolvedStatus, notes)` ke `POST ${API_BASE}/api/orders/${orderId}/reconcile-payment`.
3. **Update `src/services/edcStorage.ts`:**
   - Sinkronkan dengan API lokal `/api/edc-configurations` (atau jadikan `EdcSettingsSection` & `PaymentModal` membaca/menulis ke SQLite via `api.getEdcConfigurations()` / `api.saveEdcConfiguration()`, dengan cache lokal di `edcStorage` untuk akses sinkron di komponen yang membutuhkan).
4. **Update Komponen UI:**
   - `src/App.tsx`: hapus `ensureEdcConfiguredFromErp`, ganti badge header `ERP` menjadi badge `SQLite` (status koneksi DB lokal), dan dengarkan event WS `catalog:updated` untuk memanggil `loadCatalog()`.
   - `src/components/PinLoginModal.tsx`: hapus `ensureEdcConfiguredFromErp`, ubah label menjadi `"Masukkan PIN Kasir Lokal (5 digit)"`.
   - `src/components/EdcSettingsSection.tsx`: hapus seluruh panel & tombol *"Sinkronisasi ERP Cloud"*, *"Push ke ERP"*, dan parameter `PosSalesErpConfig`; kelola mesin EDC murni dari SQLite lokal.
   - `src/components/SystemSettingsView.tsx`:
     - Hapus kartu *"Konektivitas ERP Cloud"* di tab Hardware.
     - Pada tab **Simulasi / Uji Perangkat** (sebelumnya `CHAOS`), hapus kotak *"Jalur Sinkronisasi ERP"* dan fokus pada uji ketahanan lokal (Printer Cup Label offline/online & antrean cetak SQLite).
     - Pada tab **DATABASE**, tampilkan statistik nyata dari `GET /api/db/status` (`outlet_pos.sqlite`, jumlah produk, user, order, shift), tombol **"Reset / Isi Ulang Stok Semua Menu"** (`POST /api/catalog/restock-all`) serta daftar kontrol cepat stok/habis produk lokal, dan tombol *"Vacuum & Re-index Database"* yang memanggil `POST /api/db/vacuum` asli.
   - `src/components/EodClosingModal.tsx`: perbarui teks sukses closing agar menyatakan data closing tersimpan di SQLite lokal & Z-Report masuk antrean cetak (tanpa menyebut outbox ERP).

### 5.5 Test Suite Alignment (`tests/`)

- `tests/p0-core.test.ts`:
  - Test schema & seeder memverifikasi database baru ter-seed otomatis dengan 26 produk riil (semuanya memiliki `stock_qty` non-null dan realistis), 5 grup modifier, 6 staff user, 2 EDC config, dan histori shift/order.
  - Test validasi & pengurangan stok atomik saat `createOrder()` (gagal & rollback bila stok tidak cukup; stok berkurang saat order dibuat; stok kembali saat order dibatalkan).
  - Test EOD closing memverifikasi shift tertutup, `print_jobs` Z-Report terbentuk, dan tidak bergantung pada `outbox_events`.
- `tests/p1-lan-outbox.test.ts`:
  - Fokus pada ketahanan LAN & SQLite lokal: multi-terminal order numbering tanpa tabrakan, persistensi order & print job setelah server restart, idempotensi seeder saat restart, serta CRUD `EdcConfigService` di SQLite.
- `tests/edc-integration.test.ts`:
  - Hapus verifikasi `outbox_events`, tetap uji `EDCManager`, `edcStorage` / `EdcConfigService`, `buildQrisPaymentFrame`, dan `PaymentService` (`EDC_DEBIT` & `QRIS`).

---

## 6. Left to the Builder

- Penentuan ID deterministik (UUID/slug) dan rincian variasi item pada 14+ order historis di `server/db/seed.ts`.
- Penyesuaian detail copywriting UI bahasa Indonesia agar konsisten 100% lokal (tanpa menyebut ERP/Cloud).
- Reset dan re-seed file `data/outlet_pos.sqlite` di workspace agar database siap langsung dipakai saat aplikasi dijalankan.
