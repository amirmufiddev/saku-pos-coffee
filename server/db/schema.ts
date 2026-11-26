// server/db/schema.ts

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- 1. Daily monotonic order sequence for atomic collision-free numbering
CREATE TABLE IF NOT EXISTS order_sequence (
  date_key TEXT PRIMARY KEY,
  current_seq INTEGER NOT NULL DEFAULT 0
);

-- 2. Orders table
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  outlet_id TEXT NOT NULL,
  outlet_name TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  cashier_name TEXT NOT NULL,
  shift_id TEXT,
  customer_name TEXT DEFAULT 'Walk-in',
  dining_option TEXT NOT NULL DEFAULT 'takeaway',
  pager_number TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, PREPARING, READY, COMPLETED, CANCELLED
  payment_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, PAID, FAILED, UNKNOWN, REFUNDED
  payment_method TEXT,
  payment_ref TEXT,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index for cashier and status querying
CREATE INDEX IF NOT EXISTS idx_orders_outlet_date ON orders(outlet_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);

-- 3. Order line items with modifier snapshot
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  variant_size TEXT NOT NULL, -- 'Regular' | 'Large'
  base_price INTEGER NOT NULL,
  modifiers_price INTEGER NOT NULL DEFAULT 0,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  notes TEXT,
  modifiers_json TEXT NOT NULL, -- JSON snapshot of modifiers
  cup_count INTEGER NOT NULL, -- Total cups for this line
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- 4. Persistent Print Queue (Receipts & Individual Cup Stickers)
CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  job_type TEXT NOT NULL, -- 'RECEIPT', 'CUP_LABEL'
  label_index INTEGER NOT NULL DEFAULT 1,
  total_labels INTEGER NOT NULL DEFAULT 1,
  item_name TEXT,
  variant_size TEXT,
  modifiers_summary TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, PRINTING, COMPLETED, FAILED
  is_reprint INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  printed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_order_id ON print_jobs(order_id);

-- 6. Local Product Catalog Cache
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  base_price_regular INTEGER NOT NULL,
  base_price_large INTEGER NOT NULL,
  image_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_sold_out INTEGER NOT NULL DEFAULT 0,
  stock_qty INTEGER,
  modifier_group_ids_json TEXT,
  updated_at TEXT NOT NULL
);

-- 7. Modifier Groups Cache
CREATE TABLE IF NOT EXISTS modifier_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'SUGAR', 'ICE', 'MILK', 'EXTRA_SHOT', 'SYRUP', 'TOPPING'
  required INTEGER NOT NULL DEFAULT 0,
  min_selection INTEGER NOT NULL DEFAULT 0,
  max_selection INTEGER NOT NULL DEFAULT 1,
  options_json TEXT NOT NULL
);

-- 8. Users & Staff with PIN Authentication
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CASHIER', -- 'CASHIER', 'BARISTA', 'SUPERVISOR', 'MANAGER'
  pin TEXT NOT NULL, -- 4 to 6 digit numeric PIN
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- 9. Shift Sessions & End Of Day (EOD) Closing
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  cashier_name TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'CLOSED'
  starting_cash INTEGER NOT NULL DEFAULT 0,
  expected_cash INTEGER NOT NULL DEFAULT 0,
  actual_cash INTEGER,
  cash_difference INTEGER,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_cups INTEGER NOT NULL DEFAULT 0,
  total_gross_sales INTEGER NOT NULL DEFAULT 0,
  total_discount INTEGER NOT NULL DEFAULT 0,
  total_tax INTEGER NOT NULL DEFAULT 0,
  total_net_sales INTEGER NOT NULL DEFAULT 0,
  payment_summary_json TEXT, -- JSON: { CASH: number, QRIS: number, EDC: number }
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status, terminal_id);

-- 10. Local EDC Configurations
CREATE TABLE IF NOT EXISTS edc_configurations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bank TEXT,
  connection_type TEXT NOT NULL, -- 'SERIAL' | 'TCP_IP'
  host TEXT,
  ip_pis TEXT,
  ip_terminal TEXT,
  port INTEGER,
  baud_rate INTEGER NOT NULL DEFAULT 115200,
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
`;

