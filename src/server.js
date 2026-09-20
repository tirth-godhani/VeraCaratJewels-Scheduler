import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger } from './utils/logger.js';
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

const scheduler = new ProductScheduler();

// API: Get products catalog
app.get('/api/products', async (req, res) => {
  try {
    const products = await scheduler.etsyService.loadLocalProducts();
    res.json({ success: true, count: products.length, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get scheduler state & status
app.get('/api/status', async (req, res) => {
  try {
    const state = await scheduler.loadState();
    const products = await scheduler.etsyService.loadLocalProducts();
    const total = products.length;
    const nextIndex = total > 0 ? (state.lastPostedProductIndex + 1) % total : 0;
    const nextProduct = products[nextIndex] || null;

    res.json({
      success: true,
      totalProducts: total,
      lastPostedProductIndex: state.lastPostedProductIndex,
      lastPostedAt: state.lastPostedAt,
      totalPostedCount: state.totalPostedCount,
      nextIndex,
      nextProduct,
      cron: config.scheduler.cron,
      timezone: config.scheduler.timezone,
      dryRun: config.scheduler.dryRun,
      history: state.history || []
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Generate 5 Pins preview for a specific product
app.get('/api/products/:id/pins', async (req, res) => {
  try {
    const products = await scheduler.etsyService.loadLocalProducts();
    const product = products.find(p => p.id === req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    const pins = buildPinsForProduct(product);
    res.json({ success: true, product, pins });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Trigger immediate post
app.post('/api/post-next', async (req, res) => {
  try {
    const dryRun = req.body.dryRun !== undefined ? req.body.dryRun : config.scheduler.dryRun;
    const localScheduler = new ProductScheduler({ dryRun });
    const result = await localScheduler.postNextProduct(true);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Trigger sync from open browser
app.post('/api/sync-browser', async (req, res) => {
  try {
    logger.info('API triggered browser sync...');
    // Run async so request does not timeout
    syncFromBrowser().catch(err => logger.error('Sync failed: ' + err.message));
    res.json({ success: true, message: 'Browser synchronization initiated in background' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  logger.success(`💎 Vera Carat Jewels Scheduler Dashboard running at http://localhost:${PORT}`);
});
