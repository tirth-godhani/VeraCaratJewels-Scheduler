import http from 'http';

async function auditAllPins() {
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

  console.log('--- Navigating to Created Pins tab: https://au.pinterest.com/veracaratjewels/_created/ ---');
  await send('Page.navigate', { url: 'https://au.pinterest.com/veracaratjewels/_created/' });
  await new Promise(r => setTimeout(r, 4000));

  for (let i = 0; i < 5; i++) {
    await evaluate('window.scrollTo(0, document.body.scrollHeight);');
    await new Promise(r => setTimeout(r, 1200));
  }

  const createdPins = await evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
    const ids = [];
    links.forEach(a => {
      const m = a.href.match(/\\/pin\\/(\\d+)/);
      if (m && !ids.includes(m[1])) ids.push(m[1]);
    });
    return ids;
  })()`);

  console.log(`Found ${createdPins ? createdPins.length : 0} pins in Created tab:`, createdPins);

  console.log('\n--- Navigating to Saved / Boards tab: https://au.pinterest.com/veracaratjewels/_saved/ ---');
  await send('Page.navigate', { url: 'https://au.pinterest.com/veracaratjewels/_saved/' });
  await new Promise(r => setTimeout(r, 4000));

  const boards = await evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/veracaratjewels/"]'));
    return [...new Set(links.map(a => a.href).filter(h => !h.includes('/_') && !h.endsWith('/veracaratjewels/') && !h.includes('/pin/')))];
  })()`);

  console.log('Boards found:', boards);

  const allFoundPinIds = new Set(createdPins || []);

  if (boards && boards.length > 0) {
    for (const bUrl of boards) {
      console.log(`Checking board: ${bUrl}...`);
      await send('Page.navigate', { url: bUrl });
      await new Promise(r => setTimeout(r, 4000));
      for (let i = 0; i < 5; i++) {
        await evaluate('window.scrollTo(0, document.body.scrollHeight);');
        await new Promise(r => setTimeout(r, 1200));
      }
      const boardPinIds = await evaluate(`(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
        const ids = [];
        links.forEach(a => {
          const m = a.href.match(/\\/pin\\/(\\d+)/);
          if (m && !ids.includes(m[1])) ids.push(m[1]);
        });
        return ids;
      })()`);
      console.log(`  Found ${boardPinIds.length} pins in board.`);
      boardPinIds.forEach(id => allFoundPinIds.add(id));
    }
  }

  const allPinIds = Array.from(allFoundPinIds);
  console.log(`\n====================================================`);
  console.log(`TOTAL UNIQUE PINS TO AUDIT: ${allPinIds.length}`);
  console.log(`====================================================`);

  const report = [];

  for (let i = 0; i < allPinIds.length; i++) {
    const pinId = allPinIds[i];
    const pinUrl = `https://au.pinterest.com/pin/${pinId}/`;
    console.log(`[${i + 1}/${allPinIds.length}] Auditing Pin ${pinId} (${pinUrl})...`);
    await send('Page.navigate', { url: pinUrl });
    await new Promise(r => setTimeout(r, 3500));

    const pinData = await evaluate(`(() => {
      const title = document.querySelector('h1')?.innerText?.trim() 
        || document.querySelector('[data-test-id="rich-pin-name"]')?.innerText?.trim()
        || document.querySelector('[data-test-id="pin-title"]')?.innerText?.trim()
        || document.title;
      
      const descEl = document.querySelector('[data-test-id="rich-pin-description"]')
        || document.querySelector('[data-test-id="pin-description"]')
        || document.querySelector('div[role="main"] div[data-test-id="truncated-text"]')
        || document.querySelector('div[role="main"] span[data-test-id="truncated-text"]');

      const desc = descEl ? descEl.innerText.trim() : '';

      // Check if we own this pin (has More actions -> Edit Pin)
      const moreBtn = document.querySelector('div[role="main"] button[aria-label="More actions"]')
        || document.querySelector('button[aria-label="More actions"]');

      const isOwned = Boolean(moreBtn);

      const link = document.querySelector('a[data-test-id="pin-link"]')?.href 
        || document.querySelector('div[role="main"] a[target="_blank"]')?.href
        || '';

      return { title, desc, hasDesc: desc.length > 0, isOwned, link };
    })()`);

    console.log(`   Title: "${pinData?.title?.slice(0, 60)}..."`);
    console.log(`   Desc:  ${pinData?.hasDesc ? `YES (${pinData.desc.length} chars) -> "${pinData.desc.slice(0, 70)}..."` : 'NO / EMPTY'}`);
    console.log(`   Link:  ${pinData?.link || 'None'}`);
    console.log(`   Owned: ${pinData?.isOwned ? 'YES' : 'NO (Foreign repin)'}`);

    report.push({
      pinId,
      url: pinUrl,
      ...pinData
    });
  }

  console.log('\n====================================================');
  console.log('FULL AUDIT REPORT SUMMARY:');
  console.log('====================================================');
  console.log(`Total Pins Audited: ${report.length}`);
  console.log(`Owned Pins with Descriptions: ${report.filter(r => r.isOwned && r.hasDesc).length}`);
  console.log(`Owned Pins with Missing Descriptions: ${report.filter(r => r.isOwned && !r.hasDesc).length}`);
  console.log(`Foreign / Repinned Items: ${report.filter(r => !r.isOwned).length}`);
  console.log('====================================================\n');

  ws.close();
}

auditAllPins().catch(console.error);
