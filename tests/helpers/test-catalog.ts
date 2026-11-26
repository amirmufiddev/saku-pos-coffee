import type { DatabaseSync } from 'node:sqlite';

/** Produk minimal untuk unit test. */
export const TEST_PRODUCT_ID = 'test_prod_latte';

export const TEST_MOD_GROUP_MILK = 'bbbbbbbb-cccc-4ddd-eeee-ffffffff0001';
export const TEST_MOD_OPTION_ALMOND = 'cccccccc-dddd-4eee-ffff-000000000001';
export const TEST_MOD_OPTION_OAT = 'cccccccc-dddd-4eee-ffff-000000000002';
export const TEST_MOD_GROUP_SUGAR = 'bbbbbbbb-cccc-4ddd-eeee-ffffffff0002';
export const TEST_MOD_OPTION_SUGAR_50 = 'cccccccc-dddd-4eee-ffff-000000000003';
export const TEST_MOD_GROUP_SHOTS = 'bbbbbbbb-cccc-4ddd-eeee-ffffffff0003';
export const TEST_MOD_OPTION_SHOT_1 = 'cccccccc-dddd-4eee-ffff-000000000004';

export function seedTestModifierGroups(db: DatabaseSync): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO modifier_groups (id, name, type, required, min_selection, max_selection, options_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    TEST_MOD_GROUP_SUGAR,
    'Sugar Level',
    'SUGAR',
    1,
    1,
    1,
    JSON.stringify([
      { id: TEST_MOD_OPTION_SUGAR_50, name: 'Less Sugar (50%)', price: 0, default: true },
    ]),
  );

  insert.run(
    TEST_MOD_GROUP_MILK,
    'Dairy & Plant Milk',
    'MILK',
    0,
    0,
    1,
    JSON.stringify([
      { id: 'milk_fresh_fixture', name: 'Fresh Milk', price: 0, default: true },
      { id: TEST_MOD_OPTION_OAT, name: 'Oatly Oat Milk', price: 8000 },
      { id: TEST_MOD_OPTION_ALMOND, name: 'Almond Milk', price: 8000 },
    ]),
  );

  insert.run(
    TEST_MOD_GROUP_SHOTS,
    'Espresso Shots',
    'EXTRA_SHOT',
    0,
    0,
    3,
    JSON.stringify([
      { id: TEST_MOD_OPTION_SHOT_1, name: 'Extra Shot (1x)', price: 6000 },
    ]),
  );
}

export function seedMinimalTestCatalog(db: DatabaseSync): void {
  seedTestModifierGroups(db);
  const now = new Date().toISOString();
  const modifierIds = JSON.stringify([
    TEST_MOD_GROUP_SUGAR,
    TEST_MOD_GROUP_MILK,
    TEST_MOD_GROUP_SHOTS,
  ]);
  db.prepare(`
    INSERT OR REPLACE INTO products (
      id, sku, name, category, description,
      base_price_regular, base_price_large, image_url,
      is_active, is_sold_out, stock_qty, modifier_group_ids_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, ?, ?, ?)
  `).run(
    TEST_PRODUCT_ID,
    'TEST-LATTE',
    'Test Latte',
    'Espresso & Milk',
    'Fixture for automated tests',
    25000,
    30000,
    50,
    modifierIds,
    now,
  );
}
