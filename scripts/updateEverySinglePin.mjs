import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const productsPath = path.join(__dirname, '../data/products.json');
const rawProducts = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
const products = Array.isArray(rawProducts) ? rawProducts : (rawProducts.products || []);

function generateSEODescription(title = '', matchedProduct = null) {
  const prod = matchedProduct || products[0];
  const prodTitle = title || prod.title;
  const price = prod.price?.formatted || 'A$1,200+';
  const cleanLink = (prod.url || 'https://www.etsy.com/au/shop/VeraCaratJewel')
    + '?utm_source=pinterest&utm_medium=social&utm_campaign=pin_seo';

  return `✨ ${prodTitle} — Artisan Handcrafted Fine Jewelry by Vera Carat Jewels.

Handmade with precision and passion, this exquisite piece features:
💎 Center Stone: Certified Lab Grown Diamond / High-Fire Moissanite
✨ Metal Purity: Available in 14K / 18K Solid Gold (White, Yellow, Rose) & 950 Platinum
📏 Band & Setting: Comfort fit shank with master prong setting for optimal brilliance & durability
🎁 Perfect For: Proposal Ring, Engagement, Wedding, Anniversary Gift, or Luxury Statement

🌟 Customization Available: Custom sizing, engraving, and gemstone upgrades available upon request.
📦 Worldwide Insured Shipping & Certificate of Authenticity included with every order.

🔗 Explore full details, high-res 360° video & shop securely on Etsy:
${cleanLink}

#VeraCaratJewels #EngagementRing #LabGrownDiamond #MoissaniteRing #UniqueEngagementRing #BridalJewelry #SolitaireRing #AnniversaryGift #ProposalRing #FineJewelry #DiamondRing`;
}

function findMatchingProduct(title = '') {
  if (!title) return products[0];
  const cleanTitle = title.toLowerCase();
  for (const p of products) {
    const pTitle = p.title.toLowerCase();
    const words = pTitle.split(/\s+/).filter(w => w.length > 3);
    const matchCount = words.filter(w => cleanTitle.includes(w)).length;
    if (matchCount >= 2) {
      return p;
    }
  }
  return products[0];
}

async function runMasterUpdate() {
  console.log('====================================================');
  console.log('💎 MASTER PIN AUDITOR & AUTOMATIC SEO UPDATER');
  console.log('====================================================');

  const getTabs = () => new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const tabs = await getTabs();
  const pageTab = tabs.find(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (!pageTab) throw new Error('No open page tab found');

  const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let msgId = 1;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = msgId++;
    const handler = (e) => {
      const resp = JSON.parse(e.data);
      if (resp.id === id) {
        ws.removeEventListener('message', handler);
        resolve(resp);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result?.result?.value;
  };

  const dispatchClick = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 80));
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  // 1. Gather all pins from Created tab
  console.log('Scanning profile Created tab (https://au.pinterest.com/veracaratjewels/_created/)...');
  await send('Page.navigate', { url: 'https://au.pinterest.com/veracaratjewels/_created/' });
  await new Promise(r => setTimeout(r, 4500));

  for (let i = 0; i < 8; i++) {
    await evaluate('window.scrollTo(0, document.body.scrollHeight);');
    await new Promise(r => setTimeout(r, 1000));
  }

  const createdPins = await evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
    const ids = [];
    links.forEach(a => {
      const m = a.href.match(/\\/pin\\/(\\d+)/);
      if (m && !ids.includes(m[1])) ids.push(m[1]);
    });
    return ids;
  })()`) || [];

  console.log(`📌 Found ${createdPins.length} pins in Created tab.`);

  // 2. Gather all boards
  console.log('Scanning boards tab (https://au.pinterest.com/veracaratjewels/_saved/)...');
  await send('Page.navigate', { url: 'https://au.pinterest.com/veracaratjewels/_saved/' });
  await new Promise(r => setTimeout(r, 4000));

  const boards = await evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/veracaratjewels/"]'));
    return [...new Set(links.map(a => a.href).filter(h => !h.includes('/_') && !h.endsWith('/veracaratjewels/') && !h.includes('/pin/')))];
  })()`) || [];

  console.log(`📋 Found boards:`, boards);

  const allPinIdsSet = new Set(createdPins);

  for (const bUrl of boards) {
    console.log(`Scanning board: ${bUrl}...`);
    await send('Page.navigate', { url: bUrl });
    await new Promise(r => setTimeout(r, 4000));
    for (let i = 0; i < 6; i++) {
      await evaluate('window.scrollTo(0, document.body.scrollHeight);');
      await new Promise(r => setTimeout(r, 1000));
    }
    const bPins = await evaluate(`(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
      const ids = [];
      links.forEach(a => {
        const m = a.href.match(/\\/pin\\/(\\d+)/);
        if (m && !ids.includes(m[1])) ids.push(m[1]);
      });
      return ids;
    })()`) || [];
    console.log(`  -> Found ${bPins.length} pins on board.`);
    bPins.forEach(id => allPinIdsSet.add(id));
  }

  const allPinIds = Array.from(allPinIdsSet);
  console.log(`\n====================================================`);
  console.log(`🔥 TOTAL UNIQUE PINS DISCOVERED ACROSS ACCOUNT: ${allPinIds.length}`);
  console.log(`====================================================\n`);

  let updatedCount = 0;
  let alreadyGoodCount = 0;
  let foreignCount = 0;
  let failedCount = 0;

  for (let i = 0; i < allPinIds.length; i++) {
    const pinId = allPinIds[i];
    const pinUrl = `https://au.pinterest.com/pin/${pinId}/`;
    console.log(`----------------------------------------------------`);
    console.log(`[${i + 1}/${allPinIds.length}] Inspecting Pin ID: ${pinId}`);

    try {
      await send('Page.navigate', { url: pinUrl });
      await new Promise(r => setTimeout(r, 3500));

      const inspectResult = await evaluate(`(() => {
        const title = document.querySelector('h1')?.innerText?.trim() 
          || document.querySelector('[data-test-id="rich-pin-name"]')?.innerText?.trim()
          || document.querySelector('[data-test-id="pin-title"]')?.innerText?.trim()
          || document.title;

        const descEl = document.querySelector('[data-test-id="rich-pin-description"]')
          || document.querySelector('[data-test-id="pin-description"]')
          || document.querySelector('div[role="main"] div[data-test-id="truncated-text"]')
          || document.querySelector('div[role="main"] span[data-test-id="truncated-text"]');

        const desc = descEl ? descEl.innerText.trim() : '';

        const moreBtn = document.querySelector('div[role="main"] button[aria-label="More actions"]')
          || document.querySelector('button[aria-label="More actions"]');

        return {
          title,
          desc,
          hasRichDesc: desc.length > 150 && desc.includes('Vera Carat Jewels'),
          hasMoreBtn: Boolean(moreBtn)
        };
      })()`);

      if (inspectResult.hasRichDesc) {
        console.log(`  ⚡ Pin already has complete SEO description (${inspectResult.desc.length} chars). Skipping.`);
        alreadyGoodCount++;
        continue;
      }

      if (!inspectResult.hasMoreBtn) {
        console.log(`  ⚠️ No "More actions" button found. Skipping.`);
        foreignCount++;
        continue;
      }

      console.log(`  Current Title: "${inspectResult.title?.slice(0, 50)}..."`);
      console.log(`  Current Desc:  ${inspectResult.desc ? `"${inspectResult.desc.slice(0, 40)}..."` : '(EMPTY/BLANK)'}`);

      // Click "More actions" button
      const moreBtnCoords = await evaluate(`(() => {
        const btn = document.querySelector('div[role="main"] button[aria-label="More actions"]')
          || document.querySelector('button[aria-label="More actions"]');
        if (!btn) return null;
        btn.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = btn.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);

      if (!moreBtnCoords) {
        console.log(`  ⚠️ Could not calculate coords for "More actions". Skipping.`);
        failedCount++;
        continue;
      }

      await dispatchClick(moreBtnCoords.x, moreBtnCoords.y);
      await new Promise(r => setTimeout(r, 1000));

      // Click "Edit Pin"
      const editClicked = await evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('[role="menuitem"], button, div'));
        const editItem = items.find(el => el.innerText && el.innerText.trim() === 'Edit Pin');
        if (editItem) {
          editItem.click();
          return true;
        }
        return false;
      })()`);

      if (!editClicked) {
        console.log(`  ⚠️ Could not find "Edit Pin" in menu (you may not own this pin). Skipping.`);
        foreignCount++;
        await dispatchClick(50, 50); // dismiss popup
        continue;
      }

      await new Promise(r => setTimeout(r, 2000));

      // Match product and generate SEO description
      const matchedProd = findMatchingProduct(inspectResult.title);
      const seoDesc = generateSEODescription(inspectResult.title, matchedProd);

      // In the Edit Pin dialog, set the description
      const descSet = await evaluate(`(() => {
        const descField = document.querySelector('div[aria-label="Write a description for your Pin"]')
          || document.querySelector('div[contenteditable="true"]')
          || document.querySelector('textarea[name="description"]')
          || document.querySelector('textarea#description');

        if (!descField) return { success: false, reason: 'descField not found' };

        if (descField.tagName === 'TEXTAREA') {
          descField.value = ${JSON.stringify(seoDesc)};
          descField.dispatchEvent(new Event('input', { bubbles: true }));
          descField.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, method: 'textarea' };
        } else {
          descField.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          document.execCommand('insertText', false, ${JSON.stringify(seoDesc)});
          descField.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true, method: 'contenteditable' };
        }
      })()`);

      if (!descSet || !descSet.success) {
        console.log(`  ⚠️ Failed to set description in modal: ${descSet?.reason}. Closing modal.`);
        failedCount++;
        await evaluate(`(() => {
          const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText?.trim() === 'Cancel');
          if (cancelBtn) cancelBtn.click();
        })()`);
        continue;
      }

      // Click "Save"
      await new Promise(r => setTimeout(r, 1000));
      const saveClicked = await evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const saveBtn = btns.find(b => b.innerText?.trim() === 'Save');
        if (saveBtn) {
          saveBtn.click();
          return true;
        }
        return false;
      })()`);

      if (saveClicked) {
        console.log(`  ✅ Successfully updated and saved Pin ID ${pinId} with rich SEO copy!`);
        updatedCount++;
        await new Promise(r => setTimeout(r, 3000)); // wait for Pinterest save request
      } else {
        console.log(`  ⚠️ Save button not found. Closing modal.`);
        failedCount++;
        await evaluate(`(() => {
          const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText?.trim() === 'Cancel');
          if (cancelBtn) cancelBtn.click();
        })()`);
      }

    } catch (err) {
      console.log(`  ❌ Error processing pin ${pinId}: ${err.message}`);
      failedCount++;
    }
  }

  console.log('\n====================================================');
  console.log('🎉 MASTER PIN AUDIT & SEO UPDATE COMPLETE!');
  console.log('====================================================');
  console.log(`Total Pins Inspected:     ${allPinIds.length}`);
  console.log(`✅ Newly Updated & Saved: ${updatedCount}`);
  console.log(`⚡ Already Optimized:     ${alreadyGoodCount}`);
  console.log(`⚠️ Unmodified/Foreign:    ${foreignCount}`);
  console.log(`❌ Failed:                ${failedCount}`);
  console.log('====================================================\n');

  ws.close();
}

runMasterUpdate().catch(console.error);
