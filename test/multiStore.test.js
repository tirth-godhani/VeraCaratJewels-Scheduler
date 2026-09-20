import test from 'node:test';
import assert from 'node:assert';
import { StoreManager } from '../src/services/storeManager.js';
import { ProductScheduler } from '../src/scheduler.js';

test('Multi-Store: initializes and ensures default store exists', async () => {
  await StoreManager.init();
  const stores = await StoreManager.getAllStores();
  assert.ok(stores.length >= 1, 'Should have at least 1 store');

  const defaultStore = stores.find(s => s.id === 'veracaratjewel');
  assert.ok(defaultStore, 'Default store veracaratjewel should exist');
  assert.strictEqual(defaultStore.etsyShopId, 'VeraCaratJewel');
});

test('Multi-Store: creates a new separate store with isolated configuration', async () => {
  const storeData = {
    name: 'Artisan Leather Goods',
    etsyShopId: 'ArtisanLeatherShop',
    pinterestBoardId: '998877665544',
    pinterestBoardName: 'Handmade Bags',
    pinsPerProduct: 5,
    dryRun: true
  };

  const scheduler1 = new ProductScheduler({ storeId: 'veracaratjewel' });
  const state1Before = await scheduler1.loadState();

  const newStore = await StoreManager.createStore(storeData);
  assert.ok(newStore.id);
  assert.strictEqual(newStore.name, 'Artisan Leather Goods');
  assert.strictEqual(newStore.etsyShopId, 'ArtisanLeatherShop');
  assert.strictEqual(newStore.pinterestBoardId, '998877665544');

  // Verify paths exist
  const fetched = await StoreManager.getStore(newStore.id);
  assert.strictEqual(fetched.name, 'Artisan Leather Goods');

  // Add a sample product to Store 2
  const scheduler2 = new ProductScheduler({ storeId: newStore.id, dryRun: true });
  await scheduler2.saveProducts([
    {
      id: 'leather_bag_101',
      title: 'Full Grain Leather Messenger Bag',
      description: 'Handcrafted leather laptop bag.',
      price: '185.00 USD',
      url: 'https://www.etsy.com/listing/999999/leather-bag',
      tags: ['leather bag', 'messenger bag'],
      images: [
        'https://example.com/bag1.jpg',
        'https://example.com/bag2.jpg',
        'https://example.com/bag3.jpg',
        'https://example.com/bag4.jpg',
        'https://example.com/bag5.jpg'
      ],
      video: null
    }
  ]);

  // Execute post for Store 2
  const result = await scheduler2.postNextProduct(true);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.storeId, newStore.id);
  assert.strictEqual(result.productTitle, 'Full Grain Leather Messenger Bag');

  // Check state for Store 2
  const state2 = await scheduler2.loadState();
  assert.strictEqual(state2.lastPostedProductIndex, 0);
  assert.strictEqual(state2.totalPostedCount, 1);

  // Check state for Store 1 (Vera Carat Jewels) - MUST NOT BE TOUCHED by Store 2
  const state1After = await scheduler1.loadState();
  assert.strictEqual(state1After.lastPostedProductIndex, state1Before.lastPostedProductIndex, 'Store 1 state should remain unchanged');

  // Clean up test store
  await StoreManager.deleteStore(newStore.id);
  const deletedCheck = await StoreManager.getStore(newStore.id);
  assert.strictEqual(deletedCheck, null, 'Test store should be cleanly removed');
});
