import http from 'http';
import fs from 'fs';
import path from 'path';

// Parse command line arguments
const args = process.argv.slice(2);
const skuIdx = args.indexOf('--sku');
const fromIdx = args.indexOf('--from');
const toIdx = args.indexOf('--to');
const allFlag = args.includes('--all');

const baseImagesDir = '/Users/tirthgodhani/Downloads/etsy-product-images';
const listingsOutputDir = path.join(baseImagesDir, 'listings');
const projectUrl = 'https://chatgpt.com/g/g-p-6a6aa95bc4188191b25a3bf905bd65b7/project';

if (!fs.existsSync(listingsOutputDir)) {
  fs.mkdirSync(listingsOutputDir, { recursive: true });
}

async function fetchGoogleDocSpecs(sku) {
  const res = await fetch('https://docs.google.com/document/d/1qd8xbiAlhvCPoQuVL-OKP0nTbv9eEVpOKVuAbNCqS3o/export?format=txt');
  if (!res.ok) throw new Error(`Failed to fetch Google Doc: ${res.statusText}`);
  const text = await res.text();

  const numPart = sku.replace(/\D/g, '');
  const searchPattern = new RegExp(`(AJR${numPart}|R${numPart})[\\s\\S]*?(?=(AJR\\d{3}|R\\d{3}|$)|\$)`, 'i');
  const match = text.match(searchPattern);

  if (!match) {
    throw new Error(`Could not find SKU ${sku} in Google Doc`);
  }

  let rawBlock = match[0].trim();
  let formattedBlock = rawBlock;
  if (formattedBlock.includes('↦ Stone:')) {
    formattedBlock = formattedBlock.replace(/↦ Stone:\s*/g, '↦ Stone: Lab Grown Diamond\n');
  } else if (formattedBlock.includes('Stone:')) {
    formattedBlock = formattedBlock.replace(/Stone:\s*/g, 'Stone: Lab Grown Diamond\n');
  } else {
    formattedBlock += '\n↦ Stone: Lab Grown Diamond';
  }

  formattedBlock = formattedBlock.replace(/\n{3,}/g, '\n\n');
  return formattedBlock;
}

function getLocalImages(sku) {
  const dir = path.join(baseImagesDir, sku);
  if (!fs.existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  const files = fs.readdirSync(dir)
    .filter(f => !f.startsWith('.') && !f.endsWith('.mp4') && !f.endsWith('.mov'))
    .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .map(f => path.join(dir, f));

  if (files.length === 0) {
    throw new Error(`No image files found in ${dir}`);
  }

  return files;
}

async function connectToChrome() {
  const getTabs = () => new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const tabs = await getTabs();
  let tab = tabs.find(t => t.type === 'page' && t.url.includes('chatgpt.com'));
  if (!tab) {
    tab = tabs.find(t => t.type === 'page');
  }
  if (!tab) {
    throw new Error('No open Chrome tab found on port 9222');
  }

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let msgId = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = msgId++;
    const handler = (e) => {
      const resp = JSON.parse(e.data);
      if (resp.id === id) {
        ws.removeEventListener('message', handler);
        if (resp.error) reject(new Error(resp.error.message));
        else resolve(resp.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression, awaitPromise = false) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    return res.result?.value;
  };

  return { ws, send, evaluate };
}

async function runListingWorkflow(sku, browserContext) {
  console.log(`\n====================================================`);
  console.log(`🚀 PROCESSING SKU: ${sku}`);
  console.log(`====================================================`);

  const specsText = await fetchGoogleDocSpecs(sku);
  const images = getLocalImages(sku);
  console.log(`📄 Specs loaded. 📸 Images to attach: ${images.length} (excluding MP4 videos).`);

  const { ws, send, evaluate } = browserContext;

  await send('DOM.enable');

  // 1. Navigate to VeraCaret Project to start fresh chat
  console.log(`🌐 Opening fresh chat in VeraCaret Project...`);
  await send('Page.navigate', { url: projectUrl });
  await new Promise(r => setTimeout(r, 4500));

  // Wait for prompt textarea
  let ready = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    const hasTextarea = await evaluate(`Boolean(document.querySelector("#prompt-textarea, textarea, div[contenteditable='true']"))`);
    if (hasTextarea) {
      ready = true;
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!ready) throw new Error('Prompt textarea did not load in VeraCaret project');

  // 2. Upload Images via DOM.setFileInputFiles
  console.log(`📤 Uploading ${images.length} images...`);
  const doc = await send('DOM.getDocument');
  const rootId = doc.root?.nodeId;

  const nodeResPhotos = await send('DOM.querySelector', { nodeId: rootId, selector: '#upload-photos' }).catch(() => null);
  const nodeResFiles = await send('DOM.querySelector', { nodeId: rootId, selector: '#upload-files' }).catch(() => null);
  const targetNodeId = nodeResPhotos?.nodeId || nodeResFiles?.nodeId;

  if (!targetNodeId) {
    throw new Error('Could not locate file upload input in ChatGPT');
  }

  await send('DOM.setFileInputFiles', {
    files: images,
    nodeId: targetNodeId
  });

  console.log(`⏳ Waiting for images to process...`);
  await new Promise(r => setTimeout(r, 6000));

  // 3. Send Prompt 1
  console.log(`💬 Sending Prompt 1 (Specs)...`);
  await evaluate(`document.querySelector("#prompt-textarea")?.focus()`);
  await new Promise(r => setTimeout(r, 300));
  await send('Input.insertText', { text: specsText });
  await new Promise(r => setTimeout(r, 1000));

  const send1Clicked = await evaluate(`(() => {
    const btn = document.querySelector("button[aria-label=\\"Send prompt\\"]")
      || document.querySelector(".composer-submit-button-color")
      || document.querySelector("button[data-testid=\\"send-button\\"]");
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  })()`);

  if (!send1Clicked) throw new Error('Could not click Send for Prompt 1');
  console.log(`⏳ Prompt 1 sent. Waiting for ChatGPT draft...`);

  await waitForResponseCompletion(evaluate);
  console.log(`✅ Prompt 1 complete.`);
  await new Promise(r => setTimeout(r, 3000));

  // 4. Send Prompt 2 (Refinement)
  console.log(`💬 Sending Prompt 2 (140-char title limit, emotion & SEO)...`);
  await evaluate(`document.querySelector("#prompt-textarea")?.focus()`);
  await new Promise(r => setTimeout(r, 300));

  const prompt2Text = `Title: We have a 140-character limit, so try to use as close to 100% of the available character limit as possible.
For the description, remove all data about diamond carat and metal.
I want to sell the emotion, not just the product. Rewrite the content accordingly, while also considering SEO, buyer intent, and easy readability/understanding.`;

  await send('Input.insertText', { text: prompt2Text });
  await new Promise(r => setTimeout(r, 1000));

  const send2Clicked = await evaluate(`(() => {
    const btn = document.querySelector("button[aria-label=\\"Send prompt\\"]")
      || document.querySelector(".composer-submit-button-color")
      || document.querySelector("button[data-testid=\\"send-button\\"]");
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  })()`);

  if (!send2Clicked) throw new Error('Could not click Send for Prompt 2');
  console.log(`⏳ Prompt 2 sent. Waiting for refined copy...`);

  await waitForResponseCompletion(evaluate);
  console.log(`✅ Prompt 2 complete.`);
  await new Promise(r => setTimeout(r, 3000));

  // 5. Extract Final Content
  const finalResponse = await evaluate(`(() => {
    const msgs = Array.from(document.querySelectorAll("[data-message-author-role=\\"assistant\\"]"));
    return msgs[msgs.length - 1]?.innerText;
  })()`);

  if (!finalResponse) throw new Error('Could not extract final assistant message');

  // 6. Save Markdown File
  const mdFilePath = path.join(listingsOutputDir, `${sku}.md`);
  const mdContent = `# Listing Copy: ${sku}

**Generated Date**: ${new Date().toISOString().split('T')[0]}
**SKU**: ${sku}
**Project**: VeraCaret

---

${finalResponse.trim()}
`;

  fs.writeFileSync(mdFilePath, mdContent, 'utf8');
  console.log(`💾 Saved Markdown file: ${mdFilePath}`);

  // 7. Rename Conversation via Token API
  console.log(`🏷️ Renaming conversation to "${sku}"...`);
  const renameResult = await evaluate(`(async () => {
    try {
      const sessionRes = await fetch("/api/auth/session");
      const session = await sessionRes.json();
      const token = session.accessToken;

      const pathParts = window.location.pathname.split("/");
      const cIdx = pathParts.indexOf("c");
      const convId = cIdx !== -1 ? pathParts[cIdx + 1] : null;

      if (!convId) return { error: "No convId found in URL" };

      const patchRes = await fetch(\`/backend-api/conversation/\${convId}\`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "authorization": \`Bearer \${token}\`
        },
        body: JSON.stringify({ title: ${JSON.stringify(sku)} })
      });

      return { ok: patchRes.ok, status: patchRes.status };
    } catch (e) {
      return { error: e.message };
    }
  })()`, true);

  if (renameResult?.ok) {
    console.log(`✅ Conversation renamed to "${sku}"!`);
  } else {
    console.log(`⚠️ Rename status:`, renameResult);
  }

  console.log(`🎉 COMPLETED SKU: ${sku}!`);
}

async function waitForResponseCompletion(evaluate) {
  let isGenerating = true;
  let waitCount = 0;
  const maxWaitSeconds = 120;

  // Wait for generation to start
  await new Promise(r => setTimeout(r, 4000));

  while (isGenerating && waitCount < maxWaitSeconds) {
    const hasStop = await evaluate(`Boolean(document.querySelector("button[data-testid=\\"stop-button\\"], button[aria-label=\\"Stop generating\\"]"))`);
    if (!hasStop) {
      // Stopped streaming
      isGenerating = false;
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
    waitCount += 2;
  }

  // Stabilization pause
  await new Promise(r => setTimeout(r, 3000));
}

async function main() {
  const browserContext = await connectToChrome();

  try {
    let skusToProcess = [];

    if (allFlag) {
      for (let i = 86; i <= 107; i++) {
        skusToProcess.push(`R${String(i).padStart(3, '0')}`);
      }
    } else if (fromIdx !== -1 && toIdx !== -1) {
      const start = parseInt(args[fromIdx + 1].replace(/\D/g, ''), 10);
      const end = parseInt(args[toIdx + 1].replace(/\D/g, ''), 10);
      for (let i = start; i <= end; i++) {
        skusToProcess.push(`R${String(i).padStart(3, '0')}`);
      }
    } else {
      skusToProcess = [skuIdx !== -1 ? args[skuIdx + 1] : 'R086'];
    }

    console.log(`📋 Queue to process (${skusToProcess.length} SKUs): ${skusToProcess.join(', ')}`);

    for (let i = 0; i < skusToProcess.length; i++) {
      const sku = skusToProcess[i];
      console.log(`\n====================================================`);
      console.log(`ITEM [${i + 1}/${skusToProcess.length}]: ${sku}`);
      console.log(`====================================================`);
      await runListingWorkflow(sku, browserContext);
      if (i < skusToProcess.length - 1) {
        console.log(`⏸️ Cooling down for 4 seconds before next SKU...`);
        await new Promise(r => setTimeout(r, 4000));
      }
    }

    console.log(`\n====================================================`);
    console.log(`🎉 ALL ${skusToProcess.length} LISTINGS SUCCESSFULLY GENERATED!`);
    console.log(`📁 Files located in: ${listingsOutputDir}`);
    console.log(`====================================================\n`);

  } finally {
    browserContext.ws.close();
  }
}

main().catch(err => {
  console.error(`❌ Automation failed:`, err);
  process.exit(1);
});
