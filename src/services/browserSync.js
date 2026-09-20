import fs from 'fs/promises';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Syncs the full Etsy catalog directly from the open Chrome browser session.
 */
export async function syncFromBrowser() {
  logger.info('Connecting to Chrome via DevTools on port 9222...');

  // 1. Find the Etsy tab from CDP target list
  const targetsRes = await fetch('http://localhost:9222/json');
  const targets = await targetsRes.json();
  const etsyTarget = targets.find(t => t.type === 'page' && (t.url.includes('etsy.com') || t.title.includes('VeraCaratJewel')));

  if (!etsyTarget) {
    throw new Error('Could not find an open Etsy tab in Chrome. Please make sure VeraCaratJewel shop is open in Chrome.');
  }

  logger.info(`Found Etsy tab: "${etsyTarget.title}" (${etsyTarget.url})`);

  const ws = new WebSocket(etsyTarget.webSocketDebuggerUrl);

  const sendCommand = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 100000);
      const handler = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  // 2. Fetch listings from both Page 1 and Page 2
  const pages = [
    'https://www.etsy.com/au/shop/VeraCaratJewel?ref=items-pagination&page=1&sort_order=date_desc',
    'https://www.etsy.com/au/shop/VeraCaratJewel?ref=items-pagination&page=2&sort_order=date_desc'
  ];

  const allProductSummaries = [];
  const seenListingIds = new Set();

  for (let p = 0; p < pages.length; p++) {
    logger.info(`Navigating to Etsy Shop Page ${p + 1}...`);
    await sendCommand('Page.navigate', { url: pages[p] });
    await new Promise(r => setTimeout(r, 3000));

    const evalRes = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        const items = [];
        const cards = document.querySelectorAll(".v2-listing-card, [data-listing-id]");
        cards.forEach(card => {
          const id = card.getAttribute("data-listing-id") || card.dataset?.listingId;
          if (!id) return;
          const link = card.querySelector("a.listing-link, a[href*='/listing/']");
          const titleEl = card.querySelector("h3, .v2-listing-card__title, [data-listing-card-title]");
          const priceEl = card.querySelector(".currency-value, .money, .lc-price");
          const img = card.querySelector("img");

          items.push({
            id: id,
            title: (titleEl ? titleEl.innerText : link?.getAttribute("title") || "").trim(),
            url: link ? link.href.split("?")[0] : "",
            price: priceEl ? priceEl.innerText.trim() : "",
            thumbnail: img ? (img.getAttribute("data-src") || img.src) : ""
          });
        });
        return items;
      })()`,
      returnByValue: true
    });

    const pageItems = evalRes.result?.value || [];
    pageItems.forEach(item => {
      if (!seenListingIds.has(item.id)) {
        seenListingIds.add(item.id);
        allProductSummaries.push(item);
      }
    });

    logger.info(`Extracted ${pageItems.length} items from Page ${p + 1} (Total unique so far: ${allProductSummaries.length})`);
  }

  logger.info(`Total active listings identified: ${allProductSummaries.length}. Now crawling full media and gallery...`);

  // 3. For each listing, extract 5-6 high-res images and video
  const fullProducts = [];
  for (let i = 0; i < allProductSummaries.length; i++) {
    const summary = allProductSummaries[i];
    logger.info(`[${i + 1}/${allProductSummaries.length}] Fetching media for: "${summary.title.slice(0, 45)}..."`);

    await sendCommand('Page.navigate', { url: summary.url });
    await new Promise(r => setTimeout(r, 2200));

    const detailRes = await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        // High-res images
        const imgElements = Array.from(document.querySelectorAll("ul.carousel-pane-list img, .image-carousel img, [data-palette-listing-image] img, img.wt-max-width-full, .photos-carousel img"));
        const rawSrcs = imgElements.map(img => img.getAttribute("data-src-zoom-image") || img.getAttribute("data-full-image-href") || img.getAttribute("data-src") || img.src).filter(Boolean);
        const images = Array.from(new Set(rawSrcs.map(src => src.replace(/il_\\d+x\\w+/, "il_fullxfull")))).filter(s => s.includes("etsystatic.com"));

        // Video
        const html = document.documentElement.innerHTML;
        const mp4Matches = html.match(/https?:\\/\\/v\\.etsystatic\\.com\\/[^"\'\\s]+\\.mp4[^"\'\\s]*/g) || [];
        const videoSources = Array.from(document.querySelectorAll("video source, video")).map(v => v.src).filter(s => s.includes(".mp4"));
        const allVideos = Array.from(new Set([...mp4Matches, ...videoSources]));

        // Full description & tags
        const desc = document.querySelector("[data-id='description-text']")?.innerText.trim() || "";
        const tags = Array.from(document.querySelectorAll("[data-palette-listing-tags] a, a[href*='/search?q=']")).map(a => a.innerText.trim()).filter(Boolean);

        return {
          images,
          videoUrl: allVideos.length > 0 ? allVideos[0] : null,
          description: desc,
          tags: tags.slice(0, 10)
        };
      })()`,
      returnByValue: true
    });

    const details = detailRes.result?.value || {};
    
    // Ensure fallback thumbnail if gallery was lazy
    let images = details.images || [];
    if (images.length === 0 && summary.thumbnail) {
      images = [summary.thumbnail.replace(/il_\d+x\w+/, 'il_fullxfull')];
    }

    fullProducts.push({
      id: `etsy_${summary.id}`,
      title: summary.title,
      description: details.description || summary.title,
      price: summary.price ? `${summary.price} AUD` : '',
      url: summary.url,
      tags: details.tags && details.tags.length > 0 ? details.tags : ['engagement ring', 'diamond ring', 'fine jewelry'],
      images: images,
      video: details.videoUrl ? { url: details.videoUrl } : null
    });

    // Save incrementally every 10 products so progress is preserved
    if ((i + 1) % 10 === 0 || i === allProductSummaries.length - 1) {
      await fs.writeFile(config.productsFile, JSON.stringify(fullProducts, null, 2), 'utf-8');
      logger.success(`Progress saved: ${fullProducts.length}/${allProductSummaries.length} products written to data/products.json`);
    }
  }

  // Navigate back to shop home
  await sendCommand('Page.navigate', { url: 'https://www.etsy.com/au/shop/VeraCaratJewel' });
  ws.close();

  logger.success(`Catalog synchronization complete! Stored ${fullProducts.length} listings in data/products.json.`);
  return fullProducts;
}
