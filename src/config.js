import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from .env
dotenv.config({ path: path.join(rootDir, '.env') });

export const config = {
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  productsFile: path.join(rootDir, 'data', 'products.json'),
  stateFile: path.join(rootDir, 'data', 'schedule_state.json'),
  
  // Etsy
  etsy: {
    shopId: process.env.ETSY_SHOP_ID || 'VeraCaratJewel',
    apiKey: process.env.ETSY_API_KEY || '',
    accessToken: process.env.ETSY_ACCESS_TOKEN || '',
    baseUrl: 'https://openapi.etsy.com/v3'
  },

  // Pinterest
  pinterest: {
    accessToken: process.env.PINTEREST_ACCESS_TOKEN || '',
    boardId: process.env.PINTEREST_BOARD_ID || '',
    baseUrl: 'https://api.pinterest.com/v5'
  },

  // Scheduling
  scheduler: {
    cron: process.env.SCHEDULE_CRON || '0 10 * * *',
    timezone: process.env.TZ || 'Asia/Kolkata',
    pinsPerProduct: parseInt(process.env.PINS_PER_PRODUCT || '5', 10),
    pinIntervalMinutes: parseInt(process.env.PIN_INTERVAL_MINUTES || '30', 10),
    dryRun: process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1'
  },

  // Brand defaults for Pinterest Pins
  brand: {
    name: 'Vera Carat Jewels',
    defaultHashtags: [
      '#VeraCaratJewels',
      '#FineJewelry',
      '#HandmadeJewelry',
      '#DiamondJewelry',
      '#GoldJewelry',
      '#EtsyJewelry',
      '#JewelryInspiration',
      '#LuxuryJewelry',
      '#EngagementRing',
      '#GiftForHer'
    ]
  }
};
