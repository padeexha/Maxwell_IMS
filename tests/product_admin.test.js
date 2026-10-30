import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProduct } from '../src/domain.js';
import { demoCommand } from '../src/demo.js';

test('validateProduct allows updating same product with its current SKU', () => {
  const existing = [
    { id: 'p1', name: 'Original Name', sku: 'SKU-001', reorderLevel: 2, unitValue: 100 },
    { id: 'p2', name: 'Other Name', sku: 'SKU-002', reorderLevel: 5, unitValue: 200 }
  ];

  // Updating p1 with SKU-001 should be valid
  const errSelf = validateProduct({ name: 'New Name', sku: 'SKU-001', reorderLevel: 3, unitValue: 150 }, existing, 'p1');
  assert.equal(errSelf, '');

  // Updating p1 to SKU-002 should conflict with p2
  const errCollision = validateProduct({ name: 'New Name', sku: 'SKU-002', reorderLevel: 3, unitValue: 150 }, existing, 'p1');
  assert.match(errCollision, /already exists/i);

  // Creating new product with SKU-001 should conflict
  const errNew = validateProduct({ name: 'Brand New', sku: 'SKU-001', reorderLevel: 1, unitValue: 50 }, existing);
  assert.match(errNew, /already exists/i);
});

test('demoCommand allows administrator to update and delete products safely', () => {
  const dummyStorage = {
    getItem: () => null,
    setItem: () => {}
  };
  const admin = { name: 'Admin User', role: 'Administrator' };
  const worker = { name: 'Worker User', role: 'Worker' };

  let db = {
    products: [
      { id: 'prod-1', name: 'Fridge', sku: 'FR-01', category: 'Appliances', brand: 'LG', model: '2024', unitValue: 50000, reorderLevel: 2 },
      { id: 'prod-2', name: 'Kettle', sku: 'KT-01', category: 'Appliances', brand: 'Singer', model: 'X', unitValue: 5000, reorderLevel: 1 }
    ],
    units: [
      { id: 'u1', productId: 'prod-1', code: 'MSM-001', status: 'Available' }
    ],
    activities: [],
    users: [admin, worker]
  };

  // Worker cannot update product
  assert.throws(() => {
    demoCommand(db, 'update_product', { id: 'prod-1', name: 'Hacked', sku: 'FR-01', category: 'Appliances', brand: '', model: '', unitValue: 100, reorderLevel: 1 }, worker, dummyStorage);
  }, /Administrator access required/i);

  // Administrator can update product name and details
  const updateResult = demoCommand(db, 'update_product', {
    id: 'prod-1',
    name: 'Smart Refrigerator',
    sku: 'FR-01',
    category: 'Appliances',
    brand: 'LG Electronics',
    model: 'InstaView',
    unitValue: 65000,
    reorderLevel: 3
  }, admin, dummyStorage);

  const updatedProd = updateResult.db.products.find(p => p.id === 'prod-1');
  assert.equal(updatedProd.name, 'Smart Refrigerator');
  assert.equal(updatedProd.brand, 'LG Electronics');
  assert.equal(updatedProd.unitValue, 65000);
  assert.equal(updateResult.db.activities[0].actionType || updateResult.db.activities[0].type, 'product');

  // Deleting product with units fails
  assert.throws(() => {
    demoCommand(updateResult.db, 'delete_product', { id: 'prod-1' }, admin, dummyStorage);
  }, /Cannot delete product because it has existing stock units/i);

  // Deleting product without units succeeds
  const deleteResult = demoCommand(updateResult.db, 'delete_product', { id: 'prod-2' }, admin, dummyStorage);
  assert.equal(deleteResult.db.products.some(p => p.id === 'prod-2'), false);
  assert.equal(deleteResult.db.activities[0].text, 'Deleted product KT-01');
});
