# VeraCaratJewels-Scheduler 💎📌

An automated Node.js scheduler that integrates your **Vera Carat Jewels** Etsy store with **Pinterest**, publishing **5 pins per product every day** linking back to your Etsy listings.

---

## ✨ Features

- **5 Pins per Product**: Automatically splits each Etsy product listing:
  - **1 Video Pin**: Uploaded through Pinterest API v5 video pipeline with custom cover image.
  - **4 Image Pins**: Showcasing distinct angles, close-ups, and lifestyle shots from the product gallery.
  - (If a product has no video, generates 5 distinct high-resolution image pins).
- **SEO & Search Optimized**: Generates keyword-rich jewelry titles and descriptions with trending tags (`#VeraCaratJewels`, `#FineJewelry`, `#DiamondJewelry`, `#HandmadeJewelry`).
- **Direct Traffic & Sales**: Every pin includes a direct link back to your Etsy product listing with UTM tracking (`?utm_source=pinterest`).
- **Daily Automated Scheduler**: Runs automatically once per day using configurable cron (default: 10:00 AM daily).
- **Safe Dry-Run Mode**: Test your setup and inspect generated pins without publishing to live Pinterest boards.
- **Queue & State Tracking**: Keeps track of which products have been published, advancing sequentially through your 75–76 products and rolling over when complete.

---

## 🚀 Quick Start

### 1. Set Active Workspace
In your editor/IDE, open:
```
/Users/tirthgodhani/.gemini/antigravity-ide/scratch/VeraCaratJewels-Scheduler
```

### 2. Configure Environment (`.env`)
Copy `.env.example` to `.env` (or edit existing `.env`):
```bash
# Etsy Configuration
ETSY_SHOP_ID=VeraCaratJewels
ETSY_API_KEY=your_etsy_api_key
ETSY_ACCESS_TOKEN=your_etsy_oauth_token

# Pinterest API Configuration
PINTEREST_ACCESS_TOKEN=your_pinterest_access_token
PINTEREST_BOARD_ID=your_board_id

# Scheduler
SCHEDULE_CRON="0 10 * * *"   # Everyday at 10:00 AM
TZ="Asia/Kolkata"
PINS_PER_PRODUCT=5
PIN_INTERVAL_MINUTES=30       # Minutes between posting each of the 5 pins (or 0 for all at once)

# Set to "false" when ready for live publishing
DRY_RUN=true
```

---

## 🛠 Available Commands

| Command | Description |
|---|---|
| `npm run status` | View catalog count, last posted product, and next in queue |
| `npm run post:dry-run` | Simulate posting the next product (preview 5 pins safely) |
| `npm run post:next` | Immediately publish the next product's 5 pins to Pinterest |
| `npm run sync` | Pull latest listings from Etsy API into `data/products.json` |
| `npm run start` | Launch the daily background scheduler daemon |
| `npm test` | Run automated test suite |

---

## 📂 Project Structure

```
VeraCaratJewels-Scheduler/
├── data/
│   ├── products.json           # Catalog of products (images, video, title, Etsy URLs)
│   └── schedule_state.json     # State tracking (current index, history, timestamps)
├── src/
│   ├── config.js               # Centralized configuration & environment loader
│   ├── index.js                # CLI entry point (start, sync, post-next, status, test-pin)
│   ├── scheduler.js            # Daily cron scheduler and queue controller
│   ├── services/
│   │   ├── etsyService.js      # Etsy Open API v3 fetcher & local catalog fallback
│   │   ├── pinterestService.js # Pinterest API v5 client (image & video pins)
│   │   └── pinBuilder.js       # Pin variation engine (1 video + 4 images, SEO tags)
│   └── utils/
│       └── logger.js           # Color-coded logger
├── test/
│   ├── pinBuilder.test.js      # Unit tests for 5-pin generation
│   └── scheduler.test.js      # Unit tests for queue advancement & dry runs
├── package.json
└── README.md
```

---

## 📦 Ingesting Your ~76 Etsy Products

You can populate the catalog in two ways:

1. **Automatic via Etsy API**:
   Add your `ETSY_API_KEY` and `ETSY_SHOP_ID` in `.env`, then run:
   ```bash
   npm run sync
   ```
2. **Direct JSON Ingestion**:
   You can also add or paste your 76 products directly into `data/products.json` following the schema:
   ```json
   {
     "id": "etsy_listing_id",
     "title": "14K Solid Gold Moissanite Solitaire Engagement Ring",
     "description": "Product description...",
     "price": "349.00 USD",
     "url": "https://www.etsy.com/listing/...",
     "tags": ["engagement ring", "moissanite ring"],
     "images": [
       "https://...image1.jpg",
       "https://...image2.jpg",
       "https://...image3.jpg",
       "https://...image4.jpg",
       "https://...image5.jpg"
     ],
     "video": {
       "url": "https://...video.mp4"
     }
   }
   ```
