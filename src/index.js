#!/usr/bin/env node

import { Command } from 'commander';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { EtsyService } from './services/etsyService.js';
import { PinterestService } from './services/pinterestService.js';
import { ProductScheduler } from './scheduler.js';

const program = new Command();

program
  .name('veracaratjewels-scheduler')
  .description('Automated Etsy to Pinterest Daily Product & Pin Scheduler for Vera Carat Jewels')
  .version('1.0.0');

// Command: Start Daemon
program
  .command('start')
  .description('Start the daily cron scheduler daemon')
  .option('--dry-run', 'Run in simulation mode without calling live APIs', config.scheduler.dryRun)
  .action((options) => {
    const scheduler = new ProductScheduler({ dryRun: options.dryRun });
    scheduler.startDaemon();
  });

// Command: Post Next Product
program
  .command('post-next')
  .description('Post the next product from catalog to Pinterest immediately (creates 5 pins)')
  .option('--dry-run', 'Run in simulation mode without calling live APIs', false)
  .action(async (options) => {
    const isDryRun = options.dryRun || config.scheduler.dryRun;
    logger.info(`Running immediate post (dryRun: ${isDryRun})...`);
    const scheduler = new ProductScheduler({ dryRun: isDryRun });
    await scheduler.postNextProduct(true);
  });

// Command: Sync Etsy Catalog (via API)
program
  .command('sync')
  .description('Fetch and cache latest product catalog from Etsy store via API')
  .action(async () => {
    const etsyService = new EtsyService();
    const products = await etsyService.fetchShopListings();
    logger.success(`Etsy sync complete. Total products available: ${products.length}`);
  });

// Command: Sync Etsy Catalog from Active Browser Session
program
  .command('sync-browser')
  .description('Crawl and extract full catalog (images & videos) directly from open Etsy Chrome tab')
  .action(async () => {
    const { syncFromBrowser } = await import('./services/browserSync.js');
    await syncFromBrowser();
  });

// Command: Status
program
  .command('status')
  .description('Show current scheduling queue, progress, and catalog count')
  .action(async () => {
    const scheduler = new ProductScheduler();
    const state = await scheduler.loadState();
    const products = await scheduler.etsyService.loadLocalProducts();

    const total = products.length;
    const nextIdx = total > 0 ? (state.lastPostedProductIndex + 1) % total : 0;
    const nextProduct = products[nextIdx];

    console.log('\n=== Vera Carat Jewels Scheduler Status ===');
    console.log(`Total Products in Catalog : ${total}`);
    console.log(`Last Posted Index         : ${state.lastPostedProductIndex >= 0 ? state.lastPostedProductIndex + 1 : 'None'}`);
    console.log(`Last Posted At            : ${state.lastPostedAt || 'Never'}`);
    console.log(`Total Posts Run           : ${state.totalPostedCount || 0}`);
    console.log(`Next Product in Queue     : #${nextIdx + 1} - "${nextProduct?.title || 'None'}"`);
    console.log(`Pins Generated Per Product: ${config.scheduler.pinsPerProduct}`);
    console.log(`Scheduled Daily Cron      : "${config.scheduler.cron}" (${config.scheduler.timezone})`);
    console.log(`Dry Run Mode              : ${config.scheduler.dryRun ? 'ACTIVE' : 'DISABLED'}`);
    console.log('==========================================\n');
  });

// Command: Test Single Pin
program
  .command('test-pin')
  .description('Test creating a single Pinterest pin')
  .option('--dry-run', 'Simulate pin creation', false)
  .action(async (options) => {
    const isDryRun = options.dryRun || config.scheduler.dryRun;
    logger.info(`Testing single pin creation (dryRun: ${isDryRun})...`);
    const pinterest = new PinterestService({ dryRun: isDryRun });
    const res = await pinterest.createPin({
      pinNumber: 1,
      type: 'image',
      title: 'Diamond Halo Solitaire Ring | Vera Carat Jewels',
      description: 'Handcrafted with perfection. Discover timeless brilliance at Vera Carat Jewels on Etsy. #FineJewelry #DiamondRing',
      link: 'https://www.etsy.com/shop/VeraCaratJewels',
      imageUrl: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1200&q=80',
      productId: 'test_product'
    });
    logger.success(`Test pin result: ${JSON.stringify(res, null, 2)}`);
  });

program.parse(process.argv);
