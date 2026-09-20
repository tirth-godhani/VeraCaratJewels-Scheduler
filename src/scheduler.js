import cron from 'node-cron';
import fs from 'fs/promises';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { EtsyService } from './services/etsyService.js';
import { PinterestService } from './services/pinterestService.js';
import { buildPinsForProduct } from './services/pinBuilder.js';

export class ProductScheduler {
  constructor(options = {}) {
    this.etsyService = new EtsyService(options);
    this.pinterestService = new PinterestService(options);
    this.dryRun = options.dryRun !== undefined ? options.dryRun : config.scheduler.dryRun;
  }

  async loadState() {
    try {
      const data = await fs.readFile(config.stateFile, 'utf-8');
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
    await fs.writeFile(config.stateFile, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * Posts the next product in line (creating 5 pins)
   */
  async postNextProduct(manualTrigger = false) {
    const products = await this.etsyService.loadLocalProducts();
    if (!products || products.length === 0) {
      logger.error('No products found in catalog. Run "npm run sync" or populate data/products.json');
      return { success: false, reason: 'No products in catalog' };
    }

    const state = await this.loadState();
    const nextIndex = (state.lastPostedProductIndex + 1) % products.length;
    const product = products[nextIndex];

    logger.info(`=======================================================`);
    logger.info(`Processing Product #${nextIndex + 1} of ${products.length}:`);
    logger.info(`Title: "${product.title}"`);
    logger.info(`Price: ${product.price || 'N/A'}`);
    logger.info(`Images available: ${product.images?.length || 0}`);
    logger.info(`Video present: ${Boolean(product.video)}`);
    logger.info(`=======================================================`);

    // Generate 5 pins
    const pins = buildPinsForProduct(product, {
      pinsPerProduct: config.scheduler.pinsPerProduct
    });

    logger.info(`Generated ${pins.length} Pinterest pins:`);
    pins.forEach(p => {
      logger.info(`  • Pin #${p.pinNumber} [${p.type.toUpperCase()}]: ${p.title}`);
    });

    // Publish to Pinterest
    const pinResults = await this.pinterestService.publishProductPins(pins, config.scheduler.pinIntervalMinutes);

    const successCount = pinResults.filter(r => r.success).length;
    logger.info(`Published ${successCount}/${pins.length} pins successfully.`);

    // Record in state
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
      dryRun: this.dryRun
    });

    // Keep history clean (last 100 entries)
    if (state.history.length > 100) {
      state.history = state.history.slice(0, 100);
    }

    await this.saveState(state);
    logger.success(`State updated. Product #${nextIndex + 1} marked as completed.`);

    return {
      success: true,
      productIndex: nextIndex,
      productTitle: product.title,
      pinsCreated: pins.length,
      successCount
    };
  }

  /**
   * Starts continuous daily cron scheduler
   */
  startDaemon() {
    const cronExpr = config.scheduler.cron;
    const tz = config.scheduler.timezone;

    logger.info(`Starting Vera Carat Jewels Daily Scheduler Daemon...`);
    logger.info(`Cron expression: "${cronExpr}" (${tz})`);
    logger.info(`Pins per product: ${config.scheduler.pinsPerProduct}`);
    logger.info(`Dry Run: ${this.dryRun}`);

    cron.schedule(cronExpr, async () => {
      logger.info(`[CRON TRIGGER] Executing scheduled daily product post...`);
      try {
        await this.postNextProduct(false);
      } catch (err) {
        logger.error(`Error in scheduled daily job: ${err.message}`);
      }
    }, {
      timezone: tz
    });

    logger.success(`Scheduler is active and waiting for the next cron trigger.`);
  }
}
