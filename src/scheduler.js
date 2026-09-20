import cron from 'node-cron';
import fs from 'fs/promises';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { StoreManager } from './services/storeManager.js';
import { EtsyService } from './services/etsyService.js';
import { PinterestService } from './services/pinterestService.js';
import { buildPinsForProduct } from './services/pinBuilder.js';

export class ProductScheduler {
  constructor(options = {}) {
    this.storeId = options.storeId || 'veracaratjewel';
    this.storePaths = StoreManager.getStorePaths(this.storeId);
    this.overrideDryRun = options.dryRun;
  }

  async getStoreConfig() {
    let store = await StoreManager.getStore(this.storeId);
    if (!store) {
      // Fallback if not migrated yet
      await StoreManager.init();
      store = await StoreManager.getStore(this.storeId);
    }
    return store;
  }

  async loadProducts() {
    try {
      const data = await fs.readFile(this.storePaths.productsFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async saveProducts(products) {
    await fs.writeFile(this.storePaths.productsFile, JSON.stringify(products, null, 2), 'utf-8');
  }

  async loadState() {
    try {
      const data = await fs.readFile(this.storePaths.stateFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {
        lastPostedProductIndex: -1,
        lastPostedAt: null,
        totalPostedCount: 0,
        history: []
      };
    }
  }

  async saveState(state) {
    await fs.writeFile(this.storePaths.stateFile, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * Posts the next product for this specific store
   */
  async postNextProduct(manualTrigger = false) {
    const store = await this.getStoreConfig();
    const isDryRun = this.overrideDryRun !== undefined ? this.overrideDryRun : store.dryRun;
    const products = await this.loadProducts();

    if (!products || products.length === 0) {
      logger.error(`[${store?.name || this.storeId}] No products found in catalog.`);
      return { success: false, reason: 'No products in catalog' };
    }

    const state = await this.loadState();
    const nextIndex = (state.lastPostedProductIndex + 1) % products.length;
    const product = products[nextIndex];

    logger.info(`=======================================================`);
    logger.info(`Store: "${store.name}" (${this.storeId})`);
    logger.info(`Processing Product #${nextIndex + 1} of ${products.length}:`);
    logger.info(`Title: "${product.title}"`);
    logger.info(`Destination Board: "${store.pinterestBoardName || store.pinterestBoardId}"`);
    logger.info(`=======================================================`);

    // Generate 5 pins tailored to this store
    const pins = buildPinsForProduct(product, {
      pinsPerProduct: store.pinsPerProduct || 5,
      boardId: store.pinterestBoardId
    });

    // Publish to Pinterest
    let pinResults;
    if (!isDryRun && !store.pinterestAccessToken) {
      logger.info(`[${store.name}] Using Live Browser Poster to publish pins directly to Pinterest...`);
      const { BrowserPinPoster } = await import('./services/browserPinPoster.js');
      const browserPoster = new BrowserPinPoster();
      pinResults = [];
      for (const pin of pins) {
        try {
          const res = await browserPoster.publishPin(pin);
          pinResults.push({ pinNumber: pin.pinNumber, success: true, result: res });
          await new Promise(r => setTimeout(r, 4000));
        } catch (err) {
          logger.error(`Failed to publish pin #${pin.pinNumber}: ${err.message}`);
          pinResults.push({ pinNumber: pin.pinNumber, success: false, error: err.message });
        }
      }
    } else {
      const pinterestService = new PinterestService({
        accessToken: store.pinterestAccessToken,
        boardId: store.pinterestBoardId,
        dryRun: isDryRun
      });
      pinResults = await pinterestService.publishProductPins(pins, store.pinIntervalMinutes);
    }

    const successCount = pinResults.filter(r => r.success).length;
    logger.info(`[${store.name}] Published ${successCount}/${pins.length} pins successfully.`);

    // Record in store's state
    state.lastPostedProductIndex = nextIndex;
    state.lastPostedAt = new Date().toISOString();
    state.totalPostedCount = (state.totalPostedCount || 0) + 1;
    state.history.unshift({
      timestamp: state.lastPostedAt,
      productIndex: nextIndex,
      productId: product.id,
      productTitle: product.title,
      pinsCreated: pins.length,
      successCount: successCount,
      manual: manualTrigger,
      dryRun: isDryRun
    });

    if (state.history.length > 100) {
      state.history = state.history.slice(0, 100);
    }

    await this.saveState(state);
    logger.success(`[${store.name}] State updated. Product #${nextIndex + 1} marked as completed.`);

    return {
      success: true,
      storeId: this.storeId,
      storeName: store.name,
      productIndex: nextIndex,
      productTitle: product.title,
      pinsCreated: pins.length,
      successCount
    };
  }

  /**
   * Posts a specifically selected product (by productId)
   * If pinNumber is provided, only that specific pin is published.
   */
  async postProductById(productId, manualTrigger = true, pinNumber = null) {
    const store = await this.getStoreConfig();
    const isDryRun = this.overrideDryRun !== undefined ? this.overrideDryRun : store.dryRun;
    const products = await this.loadProducts();

    const productIndex = products.findIndex(p => p.id === productId);
    if (productIndex === -1) {
      throw new Error(`Product with ID "${productId}" not found in catalog.`);
    }
    const product = products[productIndex];

    logger.info(`=======================================================`);
    logger.info(`Store: "${store.name}" (${this.storeId}) [SPECIFIC PRODUCT SELECTION]`);
    logger.info(`Product #${productIndex + 1}: "${product.title}"`);
    logger.info(`Target Board: "${store.pinterestBoardName || store.pinterestBoardId}"`);
    logger.info(`Pin Target: ${pinNumber ? `Single Pin #${pinNumber}` : 'All 5 Pins'}`);
    logger.info(`=======================================================`);

    let pins = buildPinsForProduct(product, {
      pinsPerProduct: store.pinsPerProduct || 5,
      boardId: store.pinterestBoardId
    });

    if (pinNumber !== null) {
      const selected = pins.find(p => p.pinNumber === parseInt(pinNumber, 10));
      if (selected) {
        pins = [selected];
      }
    }

    let pinResults;
    if (!isDryRun && !store.pinterestAccessToken) {
      logger.info(`[${store.name}] Using Live Browser Poster to publish selected product pins...`);
      const { BrowserPinPoster } = await import('./services/browserPinPoster.js');
      const browserPoster = new BrowserPinPoster();
      pinResults = [];
      for (const pin of pins) {
        try {
          const res = await browserPoster.publishPin(pin);
          pinResults.push({ pinNumber: pin.pinNumber, success: true, result: res });
          await new Promise(r => setTimeout(r, 4000));
        } catch (err) {
          logger.error(`Failed to publish pin #${pin.pinNumber}: ${err.message}`);
          pinResults.push({ pinNumber: pin.pinNumber, success: false, error: err.message });
        }
      }
    } else {
      const pinterestService = new PinterestService({
        accessToken: store.pinterestAccessToken,
        boardId: store.pinterestBoardId,
        dryRun: isDryRun
      });
      pinResults = await pinterestService.publishProductPins(pins, store.pinIntervalMinutes);
    }

    const successCount = pinResults.filter(r => r.success).length;
    logger.info(`[${store.name}] Published ${successCount}/${pins.length} pins for "${product.title}".`);

    // Record in store's state history
    const state = await this.loadState();
    state.totalPostedCount = (state.totalPostedCount || 0) + 1;
    state.history.unshift({
      timestamp: new Date().toISOString(),
      productIndex: productIndex,
      productId: product.id,
      productTitle: product.title,
      pinsCreated: pins.length,
      successCount: successCount,
      manual: manualTrigger,
      dryRun: isDryRun,
      specificSelect: true
    });

    if (state.history.length > 100) state.history = state.history.slice(0, 100);
    await this.saveState(state);

    return {
      success: successCount > 0,
      storeId: this.storeId,
      storeName: store.name,
      productId: product.id,
      productTitle: product.title,
      pinsAttempted: pins.length,
      successCount,
      results: pinResults
    };
  }

  /**
   * Starts multi-store background cron daemon for all registered stores
   */
  static async startMultiStoreDaemon() {
    await StoreManager.init();
    const stores = await StoreManager.getAllStores();

    logger.info(`====================================================`);
    logger.info(`Starting Multi-Store Daily Scheduler Daemon`);
    logger.info(`Active Registered Stores: ${stores.length}`);
    logger.info(`====================================================`);

    for (const store of stores) {
      const cronExpr = store.cronSchedule || config.scheduler.cron;
      const tz = store.timezone || config.scheduler.timezone;

      logger.info(`Registering Cron for "${store.name}": "${cronExpr}" (${tz})`);

      cron.schedule(cronExpr, async () => {
        logger.info(`[CRON TRIGGER] Executing daily post for store: ${store.name} (${store.id})`);
        try {
          const scheduler = new ProductScheduler({ storeId: store.id });
          await scheduler.postNextProduct(false);
        } catch (err) {
          logger.error(`Error in scheduled job for ${store.name}: ${err.message}`);
        }
      }, {
        timezone: tz
      });
    }

    logger.success(`All stores scheduled and active!`);
  }
}
