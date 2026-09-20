let allProducts = [];
let currentStatus = null;
let selectedProduct = null;

// DOM Elements
const productGrid = document.getElementById('productGrid');
const searchInput = document.getElementById('searchInput');
const itemCountDisplay = document.getElementById('itemCountDisplay');
const statTotalProducts = document.getElementById('statTotalProducts');
const statTotalVideos = document.getElementById('statTotalVideos');
const statTotalImages = document.getElementById('statTotalImages');
const nextProductTitle = document.getElementById('nextProductTitle');
const totalPostsCount = document.getElementById('totalPostsCount');
const modeBadge = document.getElementById('modeBadge');
const btnPostNext = document.getElementById('btnPostNext');
const btnSyncBrowser = document.getElementById('btnSyncBrowser');

// Modal Elements
const pinModal = document.getElementById('pinModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalProductTitle = document.getElementById('modalProductTitle');
const pinCarousel = document.getElementById('pinCarousel');
const modalPostBtn = document.getElementById('modalPostBtn');
const toastEl = document.getElementById('toast');

// Show toast
function showToast(msg) {
  toastEl.innerText = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 3500);
}

// Fetch Status
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.success) {
      currentStatus = data;
      nextProductTitle.innerText = data.nextProduct ? `#${data.nextIndex + 1} - ${data.nextProduct.title}` : 'None';
      totalPostsCount.innerText = data.totalPostedCount || 0;
      modeBadge.innerText = data.dryRun ? 'Dry Run Mode' : 'Live Mode';
    }
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

// Fetch Products
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    if (data.success) {
      allProducts = data.products || [];
      renderStats();
      renderProducts(allProducts);
    }
  } catch (err) {
    console.error('Failed to load products:', err);
    productGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: #ff6b6b;">Error loading catalog. Please check server.</div>`;
  }
}

// Render Stats
function renderStats() {
  statTotalProducts.innerText = allProducts.length;
  const withVideos = allProducts.filter(p => p.video && p.video.url).length;
  statTotalVideos.innerText = withVideos;
  const totalImg = allProducts.reduce((sum, p) => sum + (p.images ? p.images.length : 0), 0);
  statTotalImages.innerText = totalImg;
}

// Render Products Grid
function renderProducts(products) {
  itemCountDisplay.innerText = `Showing ${products.length} of ${allProducts.length} items`;
  if (products.length === 0) {
    productGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 60px; text-align: center; color: var(--text-muted);">No products match your search.</div>`;
    return;
  }

  productGrid.innerHTML = products.map((p, idx) => {
    const thumb = (p.images && p.images[0]) || '';
    const hasVid = Boolean(p.video && p.video.url);
    const imgCount = p.images ? p.images.length : 0;

    return `
      <div class="product-card" onclick="openPinModal('${p.id}')">
        <div class="card-img-wrapper">
          <img src="${thumb}" alt="${p.title}" loading="lazy">
          <div class="card-badges">
            ${hasVid ? `<span class="video-badge">▶ VIDEO</span>` : `<span></span>`}
            <span class="photo-count-badge">📷 ${imgCount} Photos</span>
          </div>
        </div>
        <div class="card-content">
          <h4 class="card-title" title="${p.title}">${p.title}</h4>
          <div class="card-meta">
            <span class="card-price">${p.price || 'View Details'}</span>
            <button class="btn-preview">Preview 5 Pins →</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Search Filter
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  const filtered = allProducts.filter(p => 
    p.title.toLowerCase().includes(query) || 
    (p.tags && p.tags.some(t => t.toLowerCase().includes(query)))
  );
  renderProducts(filtered);
});

// Modal Logic
window.openPinModal = async function(productId) {
  selectedProduct = allProducts.find(p => p.id === productId);
  if (!selectedProduct) return;

  modalProductTitle.innerText = selectedProduct.title;
  pinCarousel.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; text-align: center;">Generating 5 pins for this product...</div>`;
  pinModal.classList.add('open');

  try {
    const res = await fetch(`/api/products/${productId}/pins`);
    const data = await res.json();
    if (data.success) {
      renderPins(data.pins);
    } else {
      pinCarousel.innerHTML = `<div style="color: #ff6b6b; padding: 20px;">${data.error}</div>`;
    }
  } catch (err) {
    pinCarousel.innerHTML = `<div style="color: #ff6b6b; padding: 20px;">Failed to load pins preview.</div>`;
  }
};

function renderPins(pins) {
  pinCarousel.innerHTML = pins.map(pin => {
    const isVid = pin.type === 'video';
    return `
      <div class="pin-tile">
        <div class="pin-tile-header">
          <span>PIN #${pin.pinNumber}</span>
          <span class="pin-type-tag ${isVid ? 'video' : ''}">${isVid ? '▶ VIDEO PIN' : '📷 IMAGE PIN'}</span>
        </div>
        <div class="pin-media-box">
          ${isVid 
            ? `<video src="${pin.videoUrl}" poster="${pin.coverImageUrl}" controls playsinline preload="metadata"></video>` 
            : `<img src="${pin.imageUrl}" alt="${pin.title}" loading="lazy">`
          }
        </div>
        <div class="pin-info-box">
          <div class="pin-title-text" title="${pin.title}">${pin.title}</div>
          <div class="pin-desc-text" title="${pin.description}">${pin.description}</div>
        </div>
      </div>
    `;
  }).join('');
}

modalCloseBtn.addEventListener('click', () => {
  pinModal.classList.remove('open');
});

pinModal.addEventListener('click', (e) => {
  if (e.target === pinModal) {
    pinModal.classList.remove('open');
  }
});

// Post Next Button
btnPostNext.addEventListener('click', async () => {
  btnPostNext.disabled = true;
  btnPostNext.innerText = 'Posting 5 Pins...';
  try {
    const res = await fetch('/api/post-next', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (data.success) {
      showToast(`Success! Published 5 pins for "${data.result.productTitle.slice(0, 30)}..."`);
      await loadStatus();
    } else {
      showToast(`Error: ${data.error || 'Failed to post'}`);
    }
  } catch (err) {
    showToast(`Post failed: ${err.message}`);
  } finally {
    btnPostNext.disabled = false;
    btnPostNext.innerText = '⚡ Post Next Product Now';
  }
});

modalPostBtn.addEventListener('click', async () => {
  modalPostBtn.disabled = true;
  modalPostBtn.innerText = 'Publishing...';
  try {
    const res = await fetch('/api/post-next', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (data.success) {
      showToast(`Success! 5 Pins published for product.`);
      pinModal.classList.remove('open');
      await loadStatus();
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    modalPostBtn.disabled = false;
    modalPostBtn.innerText = '🚀 Publish These 5 Pins';
  }
});

// Sync from browser
btnSyncBrowser.addEventListener('click', async () => {
  btnSyncBrowser.disabled = true;
  btnSyncBrowser.innerText = 'Syncing...';
  try {
    const res = await fetch('/api/sync-browser', { method: 'POST' });
    const data = await res.json();
    showToast('Catalog sync started in background from Etsy Chrome tab!');
  } catch (err) {
    showToast(`Sync error: ${err.message}`);
  } finally {
    setTimeout(() => {
      btnSyncBrowser.disabled = false;
      btnSyncBrowser.innerText = '🔄 Sync Etsy Catalog';
      loadProducts();
    }, 3000);
  }
});

// Init
loadStatus();
loadProducts();
