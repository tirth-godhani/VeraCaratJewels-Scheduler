import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const storesDir = path.join(config.dataDir, 'stores');

export class StoreManager {
  /**
   * Initializes multi-store directory and migrates legacy single-store data
   */
  static async init() {
    await fs.mkdir(storesDir, { recursive: true });

    const entries = await fs.readdir(storesDir);
    if (entries.length === 0) {
      logger.info('No stores found in data/stores. Migrating Vera Carat Jewels as default store...');
      await this.migrateDefaultStore();
    }
  }

  static getStoreDir(storeId) {
    return path.join(storesDir, storeId);
  }

  static getStorePaths(storeId) {
    const dir = this.getStoreDir(storeId);
    return {
      dir,
      configFile: path.join(dir, 'config.json'),
      productsFile: path.join(dir, 'products.json'),
      stateFile: path.join(dir, 'schedule_state.json')
    };
  }

  /**
   * Migrates the existing single-store setup into data/stores/veracaratjewel
   */
  static async migrateDefaultStore() {
    const defaultStoreId = 'veracaratjewel';
    const paths = this.getStorePaths(defaultStoreId);
    await fs.mkdir(paths.dir, { recursive: true });

    const storeConfig = {
      id: defaultStoreId,
      name: 'Vera Carat Jewels',
      etsyShopId: config.etsy.shopId || 'VeraCaratJewel',
      etsyApiKey: config.etsy.apiKey || '',
      etsyAccessToken: config.etsy.accessToken || '',
      pinterestAccessToken: config.pinterest.accessToken || '',
      pinterestBoardId: config.pinterest.boardId || '',
      pinterestBoardName: 'Engagement Ring',
      pinterestProfileUrl: 'https://au.pinterest.com/veracaratjewels/',
      cronSchedule: config.scheduler.cron || '0 10 * * *',
      timezone: config.scheduler.timezone || 'Asia/Kolkata',
      pinsPerProduct: config.scheduler.pinsPerProduct || 5,
      pinIntervalMinutes: config.scheduler.pinIntervalMinutes || 30,
      dryRun: config.scheduler.dryRun,
      defaultHashtags: config.brand.defaultHashtags,
      createdAt: new Date().toISOString()
    };

    await fs.writeFile(paths.configFile, JSON.stringify(storeConfig, null, 2), 'utf-8');

    // Copy existing products.json if it exists
    try {
      const existingProducts = await fs.readFile(config.productsFile, 'utf-8');
      await fs.writeFile(paths.productsFile, existingProducts, 'utf-8');
      logger.success(`Migrated products.json to ${paths.productsFile}`);
    } catch {
      await fs.writeFile(paths.productsFile, '[]', 'utf-8');
    }

    // Copy existing schedule_state.json if it exists
    try {
      const existingState = await fs.readFile(config.stateFile, 'utf-8');
      await fs.writeFile(paths.stateFile, existingState, 'utf-8');
      logger.success(`Migrated schedule_state.json to ${paths.stateFile}`);
    } catch {
      await fs.writeFile(paths.stateFile, JSON.stringify({
        lastPostedProductIndex: -1,
        lastPostedAt: null,
        totalPostedCount: 0,
        history: []
      }, null, 2), 'utf-8');
    }

    logger.success(`Default store "${storeConfig.name}" successfully created!`);
  }

  /**
   * Retrieves all stores
   */
  static async getAllStores() {
    await this.init();
    const entries = await fs.readdir(storesDir, { withFileTypes: true });
    const stores = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const store = await this.getStore(entry.name);
        if (store) stores.push(store);
      }
    }

    return stores;
  }

  /**
   * Retrieves a single store by ID
   */
  static async getStore(storeId) {
    const paths = this.getStorePaths(storeId);
    try {
      const data = await fs.readFile(paths.configFile, 'utf-8');
      const store = JSON.parse(data);

      // Attach quick catalog counts
      let productCount = 0;
      try {
        const prodData = await fs.readFile(paths.productsFile, 'utf-8');
        productCount = JSON.parse(prodData).length;
      } catch {}
      store.productCount = productCount;

      return store;
    } catch (err) {
      return null;
    }
  }

  /**
   * Creates a new isolated store
   */
  static async createStore(data) {
    await this.init();
    const rawId = (data.id || data.name || data.etsyShopId || `store_${Date.now()}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
    
    let storeId = rawId;
    let count = 1;
    while (await this.getStore(storeId)) {
      storeId = `${rawId}_${count++}`;
    }

    const paths = this.getStorePaths(storeId);
    await fs.mkdir(paths.dir, { recursive: true });

    const newStore = {
      id: storeId,
      name: data.name || data.etsyShopId,
      etsyShopId: data.etsyShopId,
      etsyApiKey: data.etsyApiKey || '',
      etsyAccessToken: data.etsyAccessToken || '',
      pinterestAccessToken: data.pinterestAccessToken || '',
      pinterestBoardId: data.pinterestBoardId || '',
      pinterestBoardName: data.pinterestBoardName || 'General',
      pinterestProfileUrl: data.pinterestProfileUrl || '',
      cronSchedule: data.cronSchedule || '0 10 * * *',
      timezone: data.timezone || 'Asia/Kolkata',
      pinsPerProduct: parseInt(data.pinsPerProduct || '5', 10),
      pinIntervalMinutes: parseInt(data.pinIntervalMinutes || '30', 10),
      dryRun: data.dryRun !== undefined ? data.dryRun : true,
      defaultHashtags: data.defaultHashtags || [`#${data.name?.replace(/\s+/g, '') || 'Handmade'}`],
      createdAt: new Date().toISOString()
    };

    await fs.writeFile(paths.configFile, JSON.stringify(newStore, null, 2), 'utf-8');
    await fs.writeFile(paths.productsFile, '[]', 'utf-8');
    await fs.writeFile(paths.stateFile, JSON.stringify({
      lastPostedProductIndex: -1,
      lastPostedAt: null,
      totalPostedCount: 0,
      history: []
    }, null, 2), 'utf-8');

    logger.success(`New store "${newStore.name}" created at ${paths.dir}`);
    return newStore;
  }

  /**
   * Updates an existing store's configuration
   */
  static async updateStore(storeId, updates) {
    const existing = await this.getStore(storeId);
    if (!existing) throw new Error(`Store "${storeId}" not found`);

    const paths = this.getStorePaths(storeId);
    const updated = { ...existing, ...updates, id: storeId };
    delete updated.productCount; // computed property

    await fs.writeFile(paths.configFile, JSON.stringify(updated, null, 2), 'utf-8');
    logger.success(`Store "${storeId}" configuration updated.`);
    return await this.getStore(storeId);
  }

  /**
   * Deletes a store and its data
   */
  static async deleteStore(storeId) {
    const paths = this.getStorePaths(storeId);
    await fs.rm(paths.dir, { recursive: true, force: true });
    logger.success(`Store "${storeId}" deleted.`);
    return true;
  }
}
