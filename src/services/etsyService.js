import axios from 'axios';
import fs from 'fs/promises';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class EtsyService {
  constructor(options = {}) {
    this.shopId = options.shopId || config.etsy.shopId;
    this.apiKey = options.apiKey || config.etsy.apiKey;
    this.accessToken = options.accessToken || config.etsy.accessToken;
    this.baseUrl = config.etsy.baseUrl;
  }

  get headers() {
    const h = { 'x-api-key': this.apiKey };
    if (this.accessToken) {
      h['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return h;
  }

  /**
   * Fetches active listings with images & videos from Etsy API v3
   */
  async fetchShopListings() {
    if (!this.apiKey) {
      logger.warn('No ETSY_API_KEY provided in .env. Falling back to local catalog in data/products.json');
      return await this.loadLocalProducts();
    }

    try {
      logger.info(`Fetching active listings for shop "${this.shopId}" from Etsy API v3...`);
      const url = `${this.baseUrl}/application/shops/${this.shopId}/listings/active?limit=100&includes=Images,Videos`;
      const res = await axios.get(url, { headers: this.headers });

      const rawListings = res.data?.results || [];
      logger.info(`Retrieved ${rawListings.length} listings from Etsy.`);

      const products = [];
      for (const item of rawListings) {
        const images = (item.images || []).map(img => img.url_fullxfull || img.url_570xN);
        const video = (item.videos && item.videos.length > 0)
          ? {
              url: item.videos[0].video_url,
              width: item.videos[0].width,
              height: item.videos[0].height,
              duration: item.videos[0].duration
            }
          : null;

        products.push({
          id: `etsy_${item.listing_id}`,
          title: item.title,
          description: item.description,
          price: item.price ? `${item.price.amount / item.price.divisor} ${item.price.currency_code}` : '',
          url: item.url,
          tags: item.tags || [],
          images: images,
          video: video
        });
      }

      await this.saveProducts(products);
      return products;
    } catch (err) {
      logger.error(`Error querying Etsy API: ${err.response?.data?.error || err.message}`);
      logger.info('Falling back to locally cached products...');
      return await this.loadLocalProducts();
    }
  }

  /**
   * Loads products from local JSON cache
   */
  async loadLocalProducts() {
    try {
      const data = await fs.readFile(config.productsFile, 'utf-8');
      const products = JSON.parse(data);
      logger.info(`Loaded ${products.length} products from ${config.productsFile}`);
      return products;
    } catch (err) {
      logger.error(`Could not read ${config.productsFile}: ${err.message}`);
      return [];
    }
  }

  /**
   * Saves products to local JSON cache
   */
  async saveProducts(products) {
    try {
      await fs.writeFile(config.productsFile, JSON.stringify(products, null, 2), 'utf-8');
      logger.success(`Saved ${products.length} products to ${config.productsFile}`);
    } catch (err) {
      logger.error(`Failed to save products cache: ${err.message}`);
    }
  }
}
