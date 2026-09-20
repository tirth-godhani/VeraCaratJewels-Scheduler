import test from 'node:test';
import assert from 'node:assert';
import { buildPinsForProduct } from '../src/services/pinBuilder.js';

test('buildPinsForProduct generates exactly 5 pins with 1 video and 4 image pins when video exists', () => {
  const sampleProduct = {
    id: 'vcj_ring_001',
    title: '14K Gold Diamond Ring',
    description: 'A beautiful handcrafted ring with certified lab diamond.',
    url: 'https://www.etsy.com/listing/12345/gold-diamond-ring',
    tags: ['ring', 'diamond', '14kgold'],
    images: [
      'https://example.com/img1.jpg',
      'https://example.com/img2.jpg',
      'https://example.com/img3.jpg',
      'https://example.com/img4.jpg',
      'https://example.com/img5.jpg'
    ],
    video: {
      url: 'https://example.com/video1.mp4'
    }
  };

  const pins = buildPinsForProduct(sampleProduct, { pinsPerProduct: 5 });

  assert.strictEqual(pins.length, 5, 'Should generate exactly 5 pins');
  
  // Pin 1 must be video pin
  assert.strictEqual(pins[0].type, 'video');
  assert.strictEqual(pins[0].videoUrl, 'https://example.com/video1.mp4');
  assert.strictEqual(pins[0].coverImageUrl, 'https://example.com/img1.jpg');
  assert.ok(pins[0].link.includes('https://www.etsy.com/listing/12345/gold-diamond-ring'));

  // Pins 2 through 5 must be image pins
  for (let i = 1; i < 5; i++) {
    assert.strictEqual(pins[i].type, 'image');
    assert.ok(pins[i].imageUrl.startsWith('https://example.com/'));
    assert.ok(pins[i].link.includes('https://www.etsy.com/listing/12345/gold-diamond-ring'));
    assert.ok(pins[i].title.length > 0);
    assert.ok(pins[i].description.includes('#VeraCaratJewels'));
  }
});

test('buildPinsForProduct generates 5 image pins when product has no video', () => {
  const sampleProduct = {
    id: 'vcj_pendant_002',
    title: 'Solitaire Diamond Pendant',
    description: 'Minimalist luxury pendant.',
    url: 'https://www.etsy.com/listing/67890/diamond-pendant',
    tags: ['pendant', 'gold'],
    images: [
      'https://example.com/pendant1.jpg',
      'https://example.com/pendant2.jpg',
      'https://example.com/pendant3.jpg',
      'https://example.com/pendant4.jpg',
      'https://example.com/pendant5.jpg'
    ],
    video: null
  };

  const pins = buildPinsForProduct(sampleProduct, { pinsPerProduct: 5 });

  assert.strictEqual(pins.length, 5, 'Should generate 5 pins');
  pins.forEach(pin => {
    assert.strictEqual(pin.type, 'image');
    assert.ok(pin.imageUrl);
    assert.ok(pin.link.includes('https://www.etsy.com/listing/67890/diamond-pendant'));
  });
});
