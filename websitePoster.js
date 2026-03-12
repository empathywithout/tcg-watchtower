const axios = require('axios');
const logger = require('./logger');
const { config } = require('./config');

class WebsitePoster {
  constructor() {
    this.enabled = config.features.enableWebsite && !!config.website.apiUrl;
  }

  /**
   * Post restock data to website API
   */
  async postRestock(data) {
    if (!this.enabled) {
      logger.info('Website API posting is disabled');
      return { success: false, reason: 'disabled' };
    }

    try {
      logger.info('Posting to website API...', { 
        url: config.website.apiUrl,
        product: data.product_name 
      });

      const headers = {
        'Content-Type': 'application/json',
      };

      // Add API key if provided
      if (config.website.apiKey) {
        headers['Authorization'] = `Bearer ${config.website.apiKey}`;
      }

      const response = await axios.post(
        config.website.apiUrl,
        data,
        {
          headers,
          timeout: 10000,
        }
      );

      logger.success('Posted to website API', { 
        status: response.status,
        data: response.data 
      });

      return {
        success: true,
        status: response.status,
        data: response.data,
      };

    } catch (error) {
      if (error.response) {
        logger.error('Website API error response', { 
          status: error.response.status,
          data: error.response.data 
        });
        return {
          success: false,
          error: error.message,
          status: error.response.status,
          details: error.response.data,
        };
      } else if (error.request) {
        logger.error('Website API no response', { error: error.message });
        return {
          success: false,
          error: 'No response from API',
        };
      } else {
        logger.error('Website API request failed', { error: error.message });
        return {
          success: false,
          error: error.message,
        };
      }
    }
  }

  /**
   * Test API connectivity
   */
  async testConnection() {
    if (!this.enabled) {
      return { success: false, error: 'API not configured' };
    }

    try {
      const testData = {
        product_name: 'Test Product',
        price: '$0.00',
        affiliate_link: 'https://test.com',
        image_url: null,
        timestamp: new Date().toISOString(),
        is_test: true,
      };

      const result = await this.postRestock(testData);
      return result;

    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      apiUrl: config.website.apiUrl,
      hasApiKey: !!config.website.apiKey,
    };
  }
}

module.exports = new WebsitePoster();
