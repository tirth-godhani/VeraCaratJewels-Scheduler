import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class BrowserPinPoster {
  constructor(options = {}) {
    this.cdpPort = options.cdpPort || 9222;
  }

  async getPinterestTarget() {
    const targetsRes = await fetch(`http://localhost:${this.cdpPort}/json`);
    const targets = await targetsRes.json();
    let target = targets.find(t => t.type === 'page' && t.url.includes('pinterest.com'));
    if (!target) {
      target = targets.find(t => t.type === 'page');
    }
    return target;
  }

  /**
   * Publishes a pin live to Pinterest through the authenticated Chrome session
   */
  async publishPin(pin, options = {}) {
    const target = await this.getPinterestTarget();
    if (!target) {
      throw new Error('No active Chrome browser window found. Please ensure Google Chrome is open.');
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);

    const sendCommand = (method, params = {}) => new Promise((resolve, reject) => {
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

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    logger.info(`Opening Pin Creation Tool for "${pin.title.slice(0, 40)}..."`);
    await sendCommand('Page.navigate', { url: 'https://au.pinterest.com/pin-creation-tool/' });
    await new Promise(r => setTimeout(r, 3500));

    // Download image to temp file
    const tempFilePath = path.join('/tmp', `pin_media_${Date.now()}.jpg`);
    const mediaUrl = pin.imageUrl || (pin.images && pin.images[0]);
    if (!mediaUrl) throw new Error('Pin has no image URL');

    const res = await fetch(mediaUrl);
    const buf = await res.arrayBuffer();
    await fs.writeFile(tempFilePath, Buffer.from(buf));

    try {
      // 1. Upload media via CDP DOM.setFileInputFiles
      await sendCommand('DOM.enable');
      const doc = await sendCommand('DOM.getDocument');
      const fileNode = await sendCommand('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: '#storyboard-upload-input'
      });

      if (!fileNode?.nodeId) {
        throw new Error('Could not find #storyboard-upload-input on Pinterest page');
      }

      await sendCommand('DOM.setFileInputFiles', {
        files: [tempFilePath],
        nodeId: fileNode.nodeId
      });

      await sendCommand('Runtime.evaluate', {
        expression: `(() => {
          const inp = document.getElementById("storyboard-upload-input");
          if (inp) inp.dispatchEvent(new Event("change", { bubbles: true }));
        })()`
      });

      logger.info('Media attached to Pinterest canvas. Waiting for processing...');
      await new Promise(r => setTimeout(r, 3500));

      // 2. Set Title, Description, and Link
      await sendCommand('Runtime.evaluate', {
        expression: `(() => {
          // Set Title
          const titleInp = document.getElementById("storyboard-selector-title");
          if (titleInp) {
            titleInp.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            setter.call(titleInp, ${JSON.stringify(pin.title)});
            titleInp.dispatchEvent(new Event("input", { bubbles: true }));
            titleInp.dispatchEvent(new Event("change", { bubbles: true }));
          }

          // Set Link
          const linkInp = document.getElementById("WebsiteField");
          if (linkInp) {
            linkInp.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            setter.call(linkInp, ${JSON.stringify(pin.link)});
            linkInp.dispatchEvent(new Event("input", { bubbles: true }));
            linkInp.dispatchEvent(new Event("change", { bubbles: true }));
          }

          // Set Description
          const descEl = document.querySelector("div[contenteditable='true']");
          if (descEl) {
            descEl.focus();
            document.execCommand("selectAll", false, null);
            document.execCommand("insertText", false, ${JSON.stringify(pin.description)});
            descEl.dispatchEvent(new Event("input", { bubbles: true }));
          }
        })()`
      });

      logger.info('Fields filled. Clicking Publish button...');
      await new Promise(r => setTimeout(r, 1500));

      // 3. Click Publish
      const publishRes = await sendCommand('Runtime.evaluate', {
        expression: `(() => {
          const btn = Array.from(document.querySelectorAll("button")).find(b => b.innerText.trim() === "Publish");
          if (btn && !btn.disabled) {
            btn.click();
            return { clicked: true };
          }
          return { clicked: false, reason: btn ? "disabled" : "not found" };
        })()`,
        returnByValue: true
      });

      const clickStatus = publishRes.result?.value;
      if (!clickStatus?.clicked) {
        throw new Error(`Failed to click Publish: ${clickStatus?.reason || 'unknown'}`);
      }

      logger.success(`Live Pin submitted to Pinterest! Waiting 6s for cloud confirmation...`);
      await new Promise(r => setTimeout(r, 6000));

      ws.close();
      return {
        success: true,
        title: pin.title,
        link: pin.link,
        mode: 'LIVE_BROWSER_AUTOMATION',
        postedAt: new Date().toISOString()
      };
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  }
}
