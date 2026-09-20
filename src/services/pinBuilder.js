import { config } from '../config.js';

/**
 * Generates 5 Pinterest pins from 1 Etsy product.
 * Handles both video pins and image pins.
 */
export function buildPinsForProduct(product, options = {}) {
  const count = options.pinsPerProduct || config.scheduler.pinsPerProduct || 5;
  const boardId = options.boardId || config.pinterest.boardId;
  const pins = [];

  const images = Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : [];

  const hasVideo = Boolean(product.video && product.video.url);

  // Pinterest titles work best around 40-70 characters
  const cleanTitle = product.title ? product.title.trim() : 'Fine Handcrafted Jewelry';
  const truncatedTitle = cleanTitle.length > 70 ? cleanTitle.slice(0, 67) + '...' : cleanTitle;

  // Curate hashtags from product tags + brand defaults
  const productTags = (product.tags || []).map(t => `#${t.replace(/[^a-zA-Z0-9]/g, '')}`);
  const combinedTags = Array.from(new Set([...productTags, ...config.brand.defaultHashtags])).slice(0, 8);
  const hashtagString = combinedTags.join(' ');

  // Base destination URL with tracking
  let destinationUrl = product.url || `https://www.etsy.com/shop/${config.etsy.shopId}`;
  if (!destinationUrl.includes('utm_source')) {
    const separator = destinationUrl.includes('?') ? '&' : '?';
    destinationUrl = `${destinationUrl}${separator}utm_source=pinterest&utm_medium=social&utm_campaign=daily_scheduler`;
  }

  // Pin description variations
  const descriptions = [
    `${product.description || cleanTitle}\n\n✨ Handcrafted with love by Vera Carat Jewels.\nShop this piece directly on Etsy: ${destinationUrl}\n\n${hashtagString}`,
    `Discover ${cleanTitle}. Crafted for elegance and everyday luxury. Explore our full handcrafted collection.\n\n${hashtagString}`,
    `Looking for the perfect jewelry gift? ${cleanTitle} brings timeless brilliance and exceptional quality.\n\nTap to view details on our Etsy store!\n\n${hashtagString}`,
    `Close-up look at ${cleanTitle}. Hand-selected stones and fine craftsmanship.\n\nAvailable now at Vera Carat Jewels on Etsy.\n\n${hashtagString}`,
    `Elevate your style with ${cleanTitle}. Fine artisanal jewelry by Vera Carat Jewels.\n\n${hashtagString}`
  ];

  // Pin title variations
  const titleVariations = [
    `${truncatedTitle} | Vera Carat Jewels`,
    `Handcrafted ${cleanTitle.slice(0, 50)}`,
    `Close-Up: ${truncatedTitle}`,
    `Artisan Fine Jewelry - ${truncatedTitle}`,
    `Exclusive: ${truncatedTitle}`
  ];

  // 1. If product has a video, Pin 1 is the Video Pin
  let currentPinIndex = 0;
  if (hasVideo && count > 0) {
    pins.push({
      type: 'video',
      pinNumber: currentPinIndex + 1,
      boardId,
      title: titleVariations[currentPinIndex] || `${truncatedTitle} (Video)`,
      description: descriptions[currentPinIndex] || descriptions[0],
      link: destinationUrl,
      videoUrl: product.video.url,
      coverImageUrl: images[0] || null,
      productId: product.id
    });
    currentPinIndex++;
  }

  // 2. Fill remaining slots with distinct image pins
  let imagePointer = 0;
  while (pins.length < count) {
    const selectedImage = images.length > 0 
      ? images[imagePointer % images.length] 
      : 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1200&q=80';

    pins.push({
      type: 'image',
      pinNumber: currentPinIndex + 1,
      boardId,
      title: titleVariations[currentPinIndex] || `${truncatedTitle} - View ${imagePointer + 1}`,
      description: descriptions[currentPinIndex % descriptions.length],
      link: destinationUrl,
      imageUrl: selectedImage,
      altText: `${cleanTitle} - Handcrafted Jewelry by Vera Carat Jewels`,
      productId: product.id
    });

    currentPinIndex++;
    imagePointer++;
  }

  return pins;
}
