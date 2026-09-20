import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { StoreManager } from './services/storeManager.js';
import { ProductScheduler } from './scheduler.js';
import { buildPinsForProduct } from './services/pinBuilder.js';
import { syncFromBrowser } from './services/browserSync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(rootDir, 'public')));

// Initialize StoreManager on startup
await StoreManager.init();

// --- MULTI-STORE MANAGEMENT APIS ---

// List all stores
app.get('/api/stores', async (req, res) => {
  try {
    const stores = await StoreManager.getAllStores();
    res.json({ success: true, count: stores.length, stores });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new store
app.post('/api/stores', async (req, res) => {
  try {
    const newStore = await StoreManager.createStore(req.body);
    res.json({ success: true, store: newStore });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single store details
app.get('/api/stores/:storeId', async (req, res) => {
  try {
    const store = await StoreManager.getStore(req.params.storeId);
    if (!store) return res.status(404).json({ success: false, error: 'Store not found' });
    res.json({ success: true, store });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update store
app.put('/api/stores/:storeId', async (req, res) => {
  try {
    const updated = await StoreManager.updateStore(req.params.storeId, req.body);
    res.json({ success: true, store: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete store
app.delete('/api/stores/:storeId', async (req, res) => {
  try {
    await StoreManager.deleteStore(req.params.storeId);
    res.json({ success: true, message: 'Store deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- STORE-SPECIFIC CATALOG & SCHEDULING APIS ---

// Store status
app.get('/api/stores/:storeId/status', async (req, res) => {
  try {
    const { storeId } = req.params;
    const store = await StoreManager.getStore(storeId);
    if (!store) return res.status(404).json({ success: false, error: 'Store not found' });

    const scheduler = new ProductScheduler({ storeId });
    const state = await scheduler.loadState();
    const products = await scheduler.loadProducts();

    const total = products.length;
    const nextIndex = total > 0 ? (state.lastPostedProductIndex + 1) % total : 0;
    const nextProduct = products[nextIndex] || null;

    res.json({
      success: true,
      store,
      totalProducts: total,
      lastPostedProductIndex: state.lastPostedProductIndex,
      lastPostedAt: state.lastPostedAt,
      totalPostedCount: state.totalPostedCount,
      nextIndex,
      nextProduct,
      cron: store.cronSchedule,
      timezone: store.timezone,
      dryRun: store.dryRun,
      history: state.history || []
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Store products
app.get('/api/stores/:storeId/products', async (req, res) => {
  try {
    const scheduler = new ProductScheduler({ storeId: req.params.storeId });
    const products = await scheduler.loadProducts();
    res.json({ success: true, count: products.length, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5-Pin preview for store product
app.get('/api/stores/:storeId/products/:productId/pins', async (req, res) => {
  try {
    const { storeId, productId } = req.params;
    const store = await StoreManager.getStore(storeId);
    const scheduler = new ProductScheduler({ storeId });
    const products = await scheduler.loadProducts();

    const product = products.find(p => p.id === productId);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    const pins = buildPinsForProduct(product, {
      pinsPerProduct: store.pinsPerProduct || 5,
      boardId: store.pinterestBoardId
    });

    res.json({ success: true, store, product, pins });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Post next product for store
app.post('/api/stores/:storeId/post-next', async (req, res) => {
  try {
    const { storeId } = req.params;
    const dryRun = req.body.dryRun;
    const scheduler = new ProductScheduler({ storeId, dryRun });
    const result = await scheduler.postNextProduct(true);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sync store catalog (Browser Crawler or Etsy API)
app.post('/api/stores/:storeId/sync', async (req, res) => {
  try {
    const { storeId } = req.params;
    const store = await StoreManager.getStore(storeId);
    if (!store) return res.status(404).json({ success: false, error: 'Store not found' });

    logger.info(`Sync triggered for store: ${store.name}`);
    if (req.body.useBrowser) {
      syncFromBrowser().catch(err => logger.error('Sync failed: ' + err.message));
      res.json({ success: true, message: `Browser synchronization initiated for ${store.name}` });
    } else {
      res.json({ success: true, message: `Catalog ready for ${store.name}` });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- BACKWARDS COMPATIBILITY ROUTES (Default Store) ---
app.get('/api/status', async (req, res) => {
  const stores = await StoreManager.getAllStores();
  const defaultStoreId = stores[0]?.id || 'veracaratjewel';
  res.redirect(`/api/stores/${defaultStoreId}/status`);
});

app.get('/api/products', async (req, res) => {
  const stores = await StoreManager.getAllStores();
  const defaultStoreId = stores[0]?.id || 'veracaratjewel';
  res.redirect(`/api/stores/${defaultStoreId}/products`);
});

app.listen(PORT, () => {
  logger.success(`💎 Multi-Store Scheduler Dashboard running at http://localhost:${PORT}`);
});
