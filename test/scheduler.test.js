import test from 'node:test';
import assert from 'node:assert';
import { StoreManager } from '../src/services/storeManager.js';
import { ProductScheduler } from '../src/scheduler.js';

test('ProductScheduler postNextProduct performs dry run and updates state correctly', async () => {
  const storeId = 'test_sched_store';
  await StoreManager.createStore({
    id: storeId,
    name: 'Test Sched Store',
    etsyShopId: 'TestShop',
    dryRun: true
  });

  const scheduler = new ProductScheduler({ storeId, dryRun: true });
  await scheduler.saveProducts([
    {
      id: 'item_1',
      title: 'Sample Item 1',
      url: 'https://www.etsy.com/listing/111',
      images: ['https://example.com/1.jpg']
    },
    {
      id: 'item_2',
      title: 'Sample Item 2',
      url: 'https://www.etsy.com/listing/222',
      images: ['https://example.com/2.jpg']
    }
  ]);

  const initialState = await scheduler.loadState();
  assert.strictEqual(initialState.lastPostedProductIndex, -1);

  const result = await scheduler.postNextProduct(true);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.productIndex, 0);

  const updatedState = await scheduler.loadState();
  assert.strictEqual(updatedState.lastPostedProductIndex, 0);
  assert.strictEqual(updatedState.totalPostedCount, 1);

  // Clean up
  await StoreManager.deleteStore(storeId);
});
