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

    logger.info(`Opening Pin Creation Tool for Pin #${pin.pinNumber} [${pin.type.toUpperCase()}]: "${pin.title.slice(0, 40)}..."`);
    await sendCommand('Page.navigate', { url: 'https://au.pinterest.com/pin-creation-tool/' });
    await new Promise(r => setTimeout(r, 4000));

    // Handle any dialog or dirty draft state
    await sendCommand('Runtime.evaluate', {
      expression: `(() => {
        // Dismiss any unsaved changes or leave dialog
        const dialogLeaveBtn = Array.from(document.querySelectorAll("[role='dialog'] button")).find(b => b.innerText?.includes("Leave") || b.innerText?.includes("Discard"));
        if (dialogLeaveBtn) dialogLeaveBtn.click();

        // Click "Create new" if canvas has old draft
        const createNewBtn = Array.from(document.querySelectorAll("button")).find(b => b.innerText?.trim() === "Create new");
        if (createNewBtn && !createNewBtn.disabled) createNewBtn.click();
      })()`
    });
    await new Promise(r => setTimeout(r, 1500));

    // Determine media URL and file extension
    const isVideo = pin.type === 'video' && Boolean(pin.videoUrl);
    const mediaUrl = isVideo ? pin.videoUrl : (pin.imageUrl || pin.coverImageUrl || (pin.images && pin.images[0]));
    if (!mediaUrl) {
      ws.close();
      throw new Error(`Pin #${pin.pinNumber} has no media URL to upload.`);
    }

    const ext = isVideo ? 'mp4' : 'jpg';
    const tempFilePath = path.join('/tmp', `pin_media_${Date.now()}_${pin.pinNumber}.${ext}`);

    logger.info(`Downloading media (${ext.toUpperCase()}) from ${mediaUrl.slice(0, 60)}...`);
    const res = await fetch(mediaUrl);
    const buf = await res.arrayBuffer();
    await fs.writeFile(tempFilePath, Buffer.from(buf));

    try {
      // 1. Upload media via CDP DOM.setFileInputFiles
      await sendCommand('DOM.enable');
      const doc = await sendCommand('DOM.getDocument');
      
      let fileNode = await sendCommand('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: '#storyboard-upload-input'
      });

      // If not immediately found, try waiting 2s
      if (!fileNode?.nodeId) {
        await new Promise(r => setTimeout(r, 2000));
        const refreshedDoc = await sendCommand('DOM.getDocument');
        fileNode = await sendCommand('DOM.querySelector', {
          nodeId: refreshedDoc.root.nodeId,
          selector: '#storyboard-upload-input, input[type="file"]'
        });
      }

      if (!fileNode?.nodeId) {
        throw new Error('Could not find #storyboard-upload-input on Pinterest page');
      }

      await sendCommand('DOM.setFileInputFiles', {
        files: [tempFilePath],
        nodeId: fileNode.nodeId
      });

      await sendCommand('Runtime.evaluate', {
        expression: `(() => {
          const inp = document.getElementById("storyboard-upload-input") || document.querySelector("input[type='file']");
          if (inp) inp.dispatchEvent(new Event("change", { bubbles: true }));
        })()`
      });

      const waitTime = isVideo ? 8000 : 4000;
      logger.info(`Media attached to canvas. Waiting ${waitTime / 1000}s for processing...`);
      await new Promise(r => setTimeout(r, waitTime));

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

      await new Promise(r => setTimeout(r, 1500));

      // 3. Ensure Board is selected (click dropdown if not selected)
      await sendCommand('Runtime.evaluate', {
        expression: `(() => {
          const boardBtn = document.querySelector("[data-test-id='board-dropdown-select-button']") ||
            Array.from(document.querySelectorAll("button")).find(b => b.innerText?.includes("Choose a board"));
          if (boardBtn && boardBtn.innerText?.includes("Choose a board")) {
            boardBtn.click();
            setTimeout(() => {
              const firstBoard = document.querySelector("[data-test-id='board-row'], [role='listbox'] [role='option'], [data-test-id='board-selection']");
              if (firstBoard) firstBoard.click();
            }, 500);
          }
        })()`
      });

      await new Promise(r => setTimeout(r, 1500));

      // 4. Poll until Publish button is enabled (up to 12 attempts)
      let published = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        const checkRes = await sendCommand('Runtime.evaluate', {
          expression: `(() => {
            const btn = Array.from(document.querySelectorAll("button")).find(b => b.innerText?.trim() === "Publish");
            if (btn && !btn.disabled) {
              btn.click();
              return { clicked: true };
            }
            return { clicked: false, reason: btn ? "disabled" : "not found" };
          })()`,
          returnByValue: true
        });

        if (checkRes.result?.value?.clicked) {
          published = true;
          logger.success(`Clicked Publish button! Pin #${pin.pinNumber} is publishing...`);
          break;
        }

        await new Promise(r => setTimeout(r, 1500));
      }

      if (!published) {
        throw new Error('Timed out waiting for Publish button to enable on Pinterest canvas.');
      }

      logger.info('Waiting 7s for Pinterest cloud confirmation...');
      await new Promise(r => setTimeout(r, 7000));

      ws.close();
      return {
        success: true,
        pinNumber: pin.pinNumber,
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
