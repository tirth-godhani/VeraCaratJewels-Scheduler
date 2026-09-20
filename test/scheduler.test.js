import test from 'node:test';
import assert from 'node:assert';
import { ProductScheduler } from '../src/scheduler.js';

test('ProductScheduler postNextProduct performs dry run and updates state correctly', async () => {
  const scheduler = new ProductScheduler({ dryRun: true });
  
  const initialState = await scheduler.loadState();
  const initialIndex = initialState.lastPostedProductIndex;

  const result = await scheduler.postNextProduct(true);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.pinsCreated, 5);
  assert.strictEqual(result.successCount, 5);

  const updatedState = await scheduler.loadState();
  assert.strictEqual(updatedState.lastPostedProductIndex, (initialIndex + 1) % 3);
  assert.ok(updatedState.lastPostedAt);
  assert.ok(updatedState.history.length > 0);
  assert.strictEqual(updatedState.history[0].productTitle, result.productTitle);
});
