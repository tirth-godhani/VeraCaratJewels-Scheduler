import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class PinterestService {
  constructor(options = {}) {
    this.accessToken = options.accessToken || config.pinterest.accessToken;
    this.boardId = options.boardId || config.pinterest.boardId;
    this.baseUrl = config.pinterest.baseUrl;
    this.dryRun = options.dryRun !== undefined ? options.dryRun : config.scheduler.dryRun;
  }

  get headers() {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Publishes a single pin (either image or video)
   */
  async createPin(pin) {
    if (this.dryRun) {
      logger.dryRun(`Simulating Pin #${pin.pinNumber} (${pin.type.toUpperCase()}) for Product ID ${pin.productId}: "${pin.title}"`);
      return {
        id: `dry_run_pin_${Date.now()}_${pin.pinNumber}`,
        title: pin.title,
        type: pin.type,
        status: 'simulated_success',
        link: pin.link
      };
    }

    if (!this.accessToken) {
      throw new Error('Pinterest Access Token is required. Please set PINTEREST_ACCESS_TOKEN in .env');
    }

    const boardId = pin.boardId || this.boardId;
    if (!boardId) {
      throw new Error('Pinterest Board ID is required. Please set PINTEREST_BOARD_ID in .env or provide in pin');
    }

    if (pin.type === 'video') {
      return await this.createVideoPin(pin, boardId);
    } else {
      return await this.createImagePin(pin, boardId);
    }
  }

  /**
   * Creates an Image Pin via Pinterest API v5
   */
  async createImagePin(pin, boardId) {
    const payload = {
      board_id: boardId,
      title: pin.title,
      description: pin.description,
      link: pin.link,
      alt_text: pin.altText || pin.title,
      media_source: {
        source_type: 'image_url',
        url: pin.imageUrl
      }
    };

    try {
      logger.info(`Sending image pin to Pinterest: "${pin.title}"...`);
      const response = await axios.post(`${this.baseUrl}/pins`, payload, {
        headers: this.headers,
        timeout: 15000
      });
      logger.success(`Image pin created successfully! Pin ID: ${response.data?.id}`);
      return response.data;
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      logger.error(`Failed to create Pinterest image pin: ${errorMsg}`);
      throw err;
    }
  }

  /**
   * Creates a Video Pin via Pinterest API v5 (media registration, upload, polling, pin creation)
   */
  async createVideoPin(pin, boardId) {
    try {
      logger.info(`Registering video media upload on Pinterest...`);
      // Step 1: Register media
      const registerRes = await axios.post(
        `${this.baseUrl}/media`,
        { media_type: 'video' },
        { headers: this.headers }
      );

      const { media_id, upload_url, upload_parameters } = registerRes.data;
      logger.info(`Media registered with ID ${media_id}. Uploading video binary...`);

      // Step 2: Fetch source video stream/buffer and upload to Pinterest upload_url
      const videoFetch = await axios.get(pin.videoUrl, { responseType: 'arraybuffer' });
      
      const formData = new FormData();
      if (upload_parameters) {
        for (const [k, v] of Object.entries(upload_parameters)) {
          formData.append(k, v);
        }
      }
      formData.append('file', new Blob([videoFetch.data], { type: 'video/mp4' }));

      await axios.post(upload_url, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      // Step 3: Poll media status
      logger.info(`Waiting for Pinterest to process video (media_id: ${media_id})...`);
      let processed = false;
      let attempts = 0;
      while (!processed && attempts < 15) {
        await new Promise(r => setTimeout(r, 4000));
        attempts++;
        const statusRes = await axios.get(`${this.baseUrl}/media/${media_id}`, { headers: this.headers });
        const status = statusRes.data?.status;
        if (status === 'succeeded') {
          processed = true;
          logger.info(`Video processed successfully by Pinterest!`);
        } else if (status === 'failed') {
          throw new Error('Pinterest video processing failed on Pinterest servers.');
        } else {
          logger.info(`Processing status: ${status} (attempt ${attempts}/15)...`);
        }
      }

      if (!processed) {
        throw new Error('Timed out waiting for Pinterest video processing.');
      }

      // Step 4: Create the Pin with media_id
      const payload = {
        board_id: boardId,
        title: pin.title,
        description: pin.description,
        link: pin.link,
        media_source: {
          source_type: 'video_id',
          cover_image_url: pin.coverImageUrl,
          media_id: media_id
        }
      };

      const pinRes = await axios.post(`${this.baseUrl}/pins`, payload, {
        headers: this.headers,
        timeout: 15000
      });

      logger.success(`Video pin created successfully! Pin ID: ${pinRes.data?.id}`);
      return pinRes.data;
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      logger.error(`Failed to create Pinterest video pin: ${errorMsg}`);
      throw err;
    }
  }

  /**
   * Publishes all pins for a product with optional stagger
   */
  async publishProductPins(pins, intervalMinutes = 0) {
    const results = [];
    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      if (i > 0 && intervalMinutes > 0 && !this.dryRun) {
        logger.info(`Waiting ${intervalMinutes} minutes before posting next pin...`);
        await new Promise(r => setTimeout(r, intervalMinutes * 60 * 1000));
      }
      try {
        const res = await this.createPin(pin);
        results.push({ pinNumber: pin.pinNumber, success: true, result: res });
      } catch (err) {
        results.push({ pinNumber: pin.pinNumber, success: false, error: err.message });
      }
    }
    return results;
  }
}
