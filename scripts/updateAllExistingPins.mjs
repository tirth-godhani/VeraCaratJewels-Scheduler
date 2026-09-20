import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('====================================================');
  console.log('💎 VeraCaratJewels: Automated SEO Pin Updater');
  console.log('====================================================');

  // 1. Connect to Chrome via CDP on port 9222
  const listRes = await fetch('http://localhost:9222/json/list');
  const tabs = await listRes.json();
  const pTab = tabs.find(t => t.url && t.url.includes('pinterest.com'));

  if (!pTab) {
    console.error('❌ No Pinterest tab found in Chrome. Please ensure Chrome is running on port 9222.');
    process.exit(1);
  }

  console.log(`🔗 Connected to Chrome tab: "${pTab.title}"`);
  const ws = new WebSocket(pTab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 1;
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const curId = id++;
      const timeout = setTimeout(() => {
        ws.removeEventListener('message', handler);
        reject(new Error(`CDP command ${method} timed out`));
      }, 35000);

      const handler = (msg) => {
        const parsed = JSON.parse(msg.data);
        if (parsed.id === curId) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          resolve(parsed.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id: curId, method, params }));
    });
  }

  // 2. Load catalog products
  const productsPath = path.resolve(__dirname, '../data/stores/veracaratjewel/products.json');
  const rawProducts = await fs.readFile(productsPath, 'utf-8');
  const products = JSON.parse(rawProducts);
  console.log(`📦 Loaded ${products.length} products from Etsy catalog.`);

  await send('Page.bringToFront');

  // 3. Discover all pins from Board
  console.log('🔎 Scraping all pins from "Engagement Ring" board...');
  await send('Page.navigate', { url: 'https://au.pinterest.com/veracaratjewels/engagement-ring/' });
  await new Promise(r => setTimeout(r, 6000));

  // Scroll down to load all lazy-loaded pins
  for (let s = 0; s < 6; s++) {
    await send('Runtime.evaluate', { expression: `window.scrollBy(0, 1800)` });
    await new Promise(r => setTimeout(r, 1200));
  }

  const collectedPins = await send('Runtime.evaluate', {
    expression: `(() => {
      const pinLinks = Array.from(document.querySelectorAll('a[href*="/pin/"]')).map(a => a.href);
      const uniquePins = Array.from(new Set(pinLinks.map(h => {
        const match = h.match(/\\/pin\\/(\\d+)/);
        return match ? match[1] : null;
      }))).filter(Boolean);

      return uniquePins;
    })()`,
    returnByValue: true
  });

  const pinIds = collectedPins.result?.value || [];
  console.log(`📌 Found ${pinIds.length} total pins on "Engagement Ring" board.`);

  if (pinIds.length === 0) {
    console.log('No pins found on board to update.');
    ws.close();
    process.exit(0);
  }

  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // 4. Process each pin
  for (let idx = 0; idx < pinIds.length; idx++) {
    const pinId = pinIds[idx];
    const pinUrl = `https://au.pinterest.com/pin/${pinId}/`;
    console.log(`\n----------------------------------------------------`);
    console.log(`[${idx + 1}/${pinIds.length}] Inspecting Pin ID: ${pinId}`);

    try {
      await send('Page.bringToFront');
      await send('Page.navigate', { url: pinUrl });
      await new Promise(r => setTimeout(r, 4500));

      // Read current title and description
      const pinInfo = await send('Runtime.evaluate', {
        expression: `(() => {
          const title = document.querySelector('h1')?.innerText || document.title || '';
          const desc = document.querySelector('[data-test-id="pin-description"], [data-test-id="truncated-description"], div[data-test-id="description"]')?.innerText || '';
          const link = document.querySelector('a[href*="etsy.com"]')?.href || '';
          return { title, desc, link };
        })()`,
        returnByValue: true
      });

      const current = pinInfo.result?.value || {};
      const currentTitle = current.title.replace(' | Pinterest', '').trim();
      console.log(`  Current Title: "${currentTitle.slice(0, 55)}..."`);
      console.log(`  Current Desc:  ${current.desc ? `"${current.desc.slice(0, 60)}..."` : '(EMPTY/BLANK)'}`);

      // Check if description already has full rich SEO copy
      if (current.desc && current.desc.includes('✨') && current.desc.includes('#EngagementRing') && current.desc.length > 120) {
        console.log(`  ⚡ Pin already has rich SEO description. Skipping.`);
        skippedCount++;
        continue;
      }

      // Match product from title keywords or link
      let matchedProduct = null;
      if (current.link) {
        matchedProduct = products.find(p => current.link.includes(p.id) || (p.url && current.link.includes(p.url.split('?')[0])));
      }

      if (!matchedProduct) {
        const titleWords = currentTitle.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 3 && !['pinterest', 'carat', 'diamond', 'ring'].includes(w));
        let bestScore = 0;
        for (const p of products) {
          const pTitle = p.title.toLowerCase();
          let score = 0;
          for (const w of titleWords) {
            if (pTitle.includes(w)) score++;
          }
          if (score > bestScore) {
            bestScore = score;
            matchedProduct = p;
          }
        }
      }

      const cleanTitle = (matchedProduct ? matchedProduct.title : currentTitle.split('|')[0]).trim();
      const destinationUrl = current.link || (matchedProduct?.url) || `https://www.etsy.com/shop/VeraCaratJewel?utm_source=pinterest&utm_medium=social&utm_campaign=daily_scheduler`;

      // Build rich SEO description
      const newDesc = `✨ ${cleanTitle}\n\n💎 Certified Lab Grown Diamond\n💍 Handcrafted in 14K / 18K Solid Gold & Platinum\n✨ Ethical stones with exceptional brilliance and fire\n\n🎁 Perfect for engagements, wedding proposals, promise rings & anniversaries.\n\nShop directly on Etsy: ${destinationUrl}\n\n#VeraCaratJewels #EngagementRing #LabGrownDiamond #UniqueEngagementRing #BridalJewelry #PromiseRing #AnniversaryGift #DiamondRing`;

      // 5. Scroll to More actions button & get coordinates
      const rectRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const btn = document.querySelector('div[role="main"] button[aria-label="More actions"], button[aria-label="More actions"]');
          if (!btn) return null;
          btn.scrollIntoView({ block: 'center', inline: 'center' });
          const r = btn.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`,
        returnByValue: true
      });

      const coords = rectRes.result?.value;
      if (!coords) {
        console.warn(`  ⚠️ Could not find "More actions" button on pin ${pinId}. Skipping.`);
        failedCount++;
        continue;
      }

      // Click More actions button via CDP mouse events
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 1200));

      // Click "Edit Pin"
      const editClick = await send('Runtime.evaluate', {
        expression: `(() => {
          const editBtn = Array.from(document.querySelectorAll('*')).find(el => el.innerText?.trim() === 'Edit Pin');
          if (editBtn) {
            editBtn.click();
            return true;
          }
          return false;
        })()`,
        returnByValue: true
      });

      if (!editClick.result?.value) {
        console.warn(`  ⚠️ Could not find "Edit Pin" in menu (you may not own this pin). Skipping.`);
        failedCount++;
        continue;
      }

      await new Promise(r => setTimeout(r, 2000));

      // Fill in Description in Edit Pin modal
      const setDescRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const dialog = document.querySelector('[role="dialog"]') || document;
          const descInput = dialog.querySelector('textarea, div[aria-label="Write a description for your Pin"], [contenteditable]');
          if (!descInput) return { success: false, reason: 'no desc input found' };

          if (descInput.tagName === 'TEXTAREA') {
            descInput.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            setter.call(descInput, ${JSON.stringify(newDesc)});
            descInput.dispatchEvent(new Event('input', { bubbles: true }));
            descInput.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, mode: 'textarea' };
          } else {
            descInput.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, ${JSON.stringify(newDesc)});
            descInput.dispatchEvent(new Event('input', { bubbles: true }));
            return { success: true, mode: 'contenteditable' };
          }
        })()`,
        returnByValue: true
      });

      if (!setDescRes.result?.value?.success) {
        console.warn(`  ⚠️ Could not set description in modal: ${setDescRes.result?.value?.reason}`);
        await send('Runtime.evaluate', { expression: `document.querySelector('[role="dialog"] button[aria-label="Dismiss button"]')?.click()` });
        failedCount++;
        continue;
      }

      await new Promise(r => setTimeout(r, 1000));

      // Click "Save"
      const saveRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const dialog = document.querySelector('[role="dialog"]') || document;
          const saveBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.innerText?.trim() === 'Save');
          if (saveBtn && !saveBtn.disabled) {
            saveBtn.click();
            return { clicked: true };
          }
          return { clicked: false, reason: saveBtn ? 'disabled' : 'not found' };
        })()`,
        returnByValue: true
      });

      if (saveRes.result?.value?.clicked) {
        console.log(`  ✅ Successfully updated and saved Pin ID ${pinId} with rich SEO copy!`);
        updatedCount++;
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.warn(`  ⚠️ Save button failed: ${saveRes.result?.value?.reason}`);
        failedCount++;
      }

    } catch (err) {
      console.error(`  ❌ Error updating Pin ${pinId}: ${err.message}`);
      failedCount++;
    }
  }

  console.log('\n====================================================');
  console.log('🎉 SEO Pin Update Complete!');
  console.log(`✅ Successfully Updated:  ${updatedCount} pins`);
  console.log(`⚡ Already Optimized:     ${skippedCount} pins`);
  console.log(`⚠️ Unmodified/Foreign:    ${failedCount} pins`);
  console.log('====================================================');

  ws.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
