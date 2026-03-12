const logger = require('./logger');
const { config } = require('./config');

class MessageProcessor {
  /**
   * Extract product information from Discord message
   */
  extractProductInfo(message) {
    const content = message.content || '';
    const lines = content.split('\n').filter(line => line.trim());
    
    const productInfo = {
      rawContent: content,
      productName: null,
      price: null,
      link: null,
      sku: null,
      images: [],
      emojis: this.extractEmojis(content),
      hashtags: this.extractHashtags(content),
    };

    // PRIORITY 1: Extract from Discord embeds (structured data)
    if (message.embeds && message.embeds.length > 0) {
      const embed = message.embeds[0]; // Use first embed
      
      // Extract title as product name
      if (embed.title) {
        productInfo.productName = embed.title;
        productInfo.rawContent = embed.title; // Use title as raw content
      }

      // Extract the embed URL — this is the affiliate link attached to the clickable title
      if (embed.url) {
        productInfo.affiliateLink = embed.url;
      }
      
      // Extract description for additional info
      if (embed.description) {
        productInfo.rawContent = embed.description;
      }
      
      // Extract fields (SKU, Price, Links, etc.)
      if (embed.fields && embed.fields.length > 0) {
        embed.fields.forEach(field => {
          const fieldName = field.name.toLowerCase();
          const fieldValue = field.value;
          
          // Extract SKU
          if (fieldName.includes('sku')) {
            productInfo.sku = fieldValue.trim();
          }
          
          // Extract Price
          if (fieldName.includes('price')) {
            const priceMatch = fieldValue.match(/\$\s*(\d+\.?\d*)/);
            if (priceMatch) {
              productInfo.price = `$${priceMatch[1]}`;
            }
          }
          
          // Extract Links
          if (fieldName.includes('link')) {
            // Extract multiple links from the field
            const linkMatches = fieldValue.match(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g);
            if (linkMatches) {
              // Parse markdown links: [eBay](http://...)
              const firstLink = linkMatches[0];
              const urlMatch = firstLink.match(/\((https?:\/\/[^\)]+)\)/);
              if (urlMatch) {
                productInfo.link = urlMatch[1];
              }
              
              // Store all links for potential use
              productInfo.allLinks = linkMatches.map(link => {
                const match = link.match(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/);
                if (match) {
                  return { name: match[1], url: match[2] };
                }
                return null;
              }).filter(Boolean);
            } else {
              // Try direct URL extraction
              const urlMatch = fieldValue.match(/https?:\/\/[^\s\)]+/);
              if (urlMatch) {
                productInfo.link = urlMatch[0];
              }
            }
          }
        });
      }
      
      // Extract thumbnail image
      if (embed.thumbnail && embed.thumbnail.url) {
        productInfo.images.push({
          url: embed.thumbnail.url,
          name: 'thumbnail',
        });
      }
      
      // Extract main image
      if (embed.image && embed.image.url) {
        productInfo.images.push({
          url: embed.image.url,
          name: 'embedded_image',
        });
      }
      
      // Extract footer info (like "TCG Watchtower Monitors • Target • 11:27:00...")
      if (embed.footer && embed.footer.text) {
        const footerText = embed.footer.text;
        // Extract timestamp or source info if needed
        productInfo.source = footerText;
      }
      
      // If we got data from embed, return early (don't use text content)
      if (productInfo.productName || productInfo.price || productInfo.link) {
        logger.debug('Extracted product info from embed', productInfo);
        return productInfo;
      }
    }

    // PRIORITY 2: Extract from plain text content (fallback - only if no embed)
    if (!productInfo.productName) {
      for (const line of lines) {
        const cleanLine = line.replace(/[🚨⚡️✨💎]/g, '').trim();
        if (cleanLine && !cleanLine.startsWith('http') && !cleanLine.startsWith('$') && 
            !cleanLine.toLowerCase().includes('retail') && 
            !cleanLine.toLowerCase().includes('grab it') &&
            !cleanLine.toLowerCase().includes('track more')) {
          if (!productInfo.productName && cleanLine.length > 5) {
            productInfo.productName = cleanLine;
          }
        }
      }
    }

    // Extract price from content if not found in embed
    if (!productInfo.price) {
      const priceMatch = content.match(/\$\s*(\d+\.?\d*)/);
      if (priceMatch) {
        productInfo.price = `$${priceMatch[1]}`;
      }
    }

    // Extract links from content if not found in embed
    if (!productInfo.link) {
      const linkMatches = content.match(/https?:\/\/[^\s]+/g);
      if (linkMatches && linkMatches.length > 0) {
        productInfo.link = linkMatches[0];
      }
    }

    // Extract images from attachments
    if (message.attachments && message.attachments.size > 0) {
      message.attachments.forEach(attachment => {
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
          productInfo.images.push({
            url: attachment.url,
            name: attachment.name,
          });
        }
      });
    }

    logger.debug('Extracted product info', productInfo);
    return productInfo;
  }

  /**
   * Extract emojis from text
   */
  extractEmojis(text) {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    return text.match(emojiRegex) || [];
  }

  /**
   * Extract hashtags from text
   */
  extractHashtags(text) {
    const hashtagRegex = /#[\w]+/g;
    return text.match(hashtagRegex) || [];
  }

  /**
   * Format message for Twitter (280 char limit)
   */
  formatForTwitter(productInfo, isRestock = false) {
    let tweet = '';

    // Add product name (clean it up first)
    if (productInfo.productName) {
      let productName = productInfo.productName
        .replace(/Item Restocked/i, '')
        .replace(/Restock Alert/i, '')
        .replace(/\[<@&\d+>\]/g, '') // Remove Discord role mentions like [<@&1413588590637617223>]
        .replace(/\(Ping ID: \d+\)/g, '') // Remove ping IDs
        .replace(/@\s*\$[\d.]+/g, '') // Remove @ $price format
        .trim();
      
      tweet += productName;
    } else {
      tweet += 'New Product Available';
    }

    tweet += '\n\n';

    // Add "still restocking" note if this is a repeat alert
    if (isRestock) {
      tweet += '\u26a0\ufe0f This item keeps going in & out of stock \u2014 keep trying!\n\n';
    }

    // Add link - PRIORITY: embed title URL (true affiliate link), then Links field fallback
    let linkToUse = null;
    let linkName = null;

    if (productInfo.affiliateLink) {
      // embed.url on the title is always the true affiliate link
      linkToUse = productInfo.affiliateLink;
    } else if (productInfo.allLinks && productInfo.allLinks.length > 0) {
      // Fallback: pick from Links field, skipping utility-only tools
      const utilityPlatforms = ['keepa', 'selleramp', 'google'];
      const preferredOrder = ['amazon', 'target', 'walmart', 'ebay'];

      for (const preferred of preferredOrder) {
        const found = productInfo.allLinks.find(l =>
          l.name.toLowerCase().includes(preferred)
        );
        if (found) {
          linkToUse = found.url;
          linkName = found.name;
          break;
        }
      }

      if (!linkToUse) {
        const buyLink = productInfo.allLinks.find(l =>
          !utilityPlatforms.some(u => l.name.toLowerCase().includes(u))
        );
        linkToUse = buyLink ? buyLink.url : productInfo.allLinks[0].url;
        linkName = buyLink ? buyLink.name : productInfo.allLinks[0].name;
      }
    } else if (productInfo.link) {
      linkToUse = productInfo.link;
    }

    // Add the link
    if (linkToUse) {
      if (linkName) {
        tweet += `🔗 ${linkName}: ${linkToUse}\n\n`;
      } else {
        tweet += `🔗 ${linkToUse}\n\n`;
      }
    }

    // Add hashtags
    let hashtags = productInfo.hashtags.length > 0 
      ? productInfo.hashtags 
      : config.defaultHashtags;
    
    let hashtagString = hashtags.join(' ');
    
    // Ensure we don't exceed 280 characters
    while ((tweet + hashtagString).length > 280 && hashtags.length > 0) {
      hashtags.pop();
      hashtagString = hashtags.join(' ');
    }

    tweet += hashtagString;

    // Final length check - if still too long, trim product name
    if (tweet.length > 280) {
      const maxProductNameLength = 80;
      let shortProductName = productInfo.productName || 'Product';
      
      // Clean product name
      shortProductName = shortProductName
        .replace(/\[<@&\d+>\]/g, '')
        .replace(/\(Ping ID: \d+\)/g, '')
        .replace(/@\s*\$[\d.]+/g, '')
        .trim();
      
      if (shortProductName.length > maxProductNameLength) {
        shortProductName = shortProductName.substring(0, maxProductNameLength) + '...';
      }
      
      tweet = shortProductName + '\n\n';
      
      if (linkToUse) {
        if (linkName) {
          tweet += `🔗 ${linkName}: ${linkToUse}\n\n`;
        } else {
          tweet += `🔗 ${linkToUse}\n\n`;
        }
      }
      
      // Try hashtags again
      hashtagString = hashtags.join(' ');
      while ((tweet + hashtagString).length > 280 && hashtags.length > 0) {
        hashtags.pop();
        hashtagString = hashtags.join(' ');
      }
      tweet += hashtagString;
      
      // Final trim if still needed
      if (tweet.length > 280) {
        tweet = tweet.substring(0, 277) + '...';
      }
    }

    return tweet.trim();
  }

  /**
   * Format message for Reddit
   */
  formatForReddit(productInfo) {
    // Title: Product name with "Restock" if not already included
    let title = productInfo.productName || 'Product Restock Alert';
    if (!title.toLowerCase().includes('restock')) {
      title += ' - Restock';
    }

    // Limit title to 300 characters (Reddit's limit)
    if (title.length > 300) {
      title = title.substring(0, 297) + '...';
    }

    // Body
    let body = '';
    
    if (productInfo.price) {
      body += `**Price:** ${productInfo.price}\n\n`;
    }

    if (productInfo.link) {
      body += `**Link:** ${productInfo.link}\n\n`;
    }

    body += '---\n\n';
    body += '*Track more restocks at [TCGWatchtower.com](https://tcgwatchtower.com)*';

    return { title, body };
  }

  /**
   * Format message for Website API
   */
  formatForWebsite(productInfo, messageId, channelId) {
    return {
      product_name: productInfo.productName || 'Unknown Product',
      price: productInfo.price || null,
      affiliate_link: productInfo.affiliateLink || productInfo.link || null,
      image_url: productInfo.images.length > 0 ? productInfo.images[0].url : null,
      timestamp: new Date().toISOString(),
      source_message_id: messageId,
      source_channel_id: channelId,
      raw_content: productInfo.rawContent,
    };
  }

  /**
   * Validate that product info is sufficient for posting
   */
  isValidProductInfo(productInfo) {
    // Special case: Pokemon Center queue alerts
    if (productInfo.isPokemonCenterQueue) {
      return true; // Always valid for queue alerts
    }

    // At minimum, we need either a product name or a link
    if (!productInfo.productName && !productInfo.link) {
      logger.warning('Product info validation failed: missing product name and link');
      return false;
    }

    return true;
  }

  /**
   * Check if message is a Pokemon Center queue alert
   */
  isPokemonCenterQueueAlert(message, productInfo) {
    const content = (message.content || '').toLowerCase();
    const embedContent = productInfo.rawContent?.toLowerCase() || '';
    const combinedContent = content + ' ' + embedContent;

    // Check for queue-related keywords
    const queueKeywords = [
      'queue',
      'security',
      'waiting room',
      'queue is live',
      'security is up',
      'queue active'
    ];

    const hasQueueKeyword = queueKeywords.some(keyword => 
      combinedContent.includes(keyword)
    );

    // Check if it's from Pokemon Center channel (using config)
    const isPokemonCenterChannel = config.discord.pokemonCenterChannelId && 
                                    message.channel.id === config.discord.pokemonCenterChannelId;

    return hasQueueKeyword && isPokemonCenterChannel;
  }

  /**
   * Format Pokemon Center queue alert for Twitter
   */
  formatPokemonCenterQueueAlert() {
    const tweet = `🚨 POKEMON CENTER QUEUE IS LIVE!

The Pokemon Center waiting room/security queue is now active!

Get ready to purchase!

🔗 https://www.pokemoncenter.com

#PokemonCenter #TCGDeals #Queue`;

    return tweet;
  }
}

module.exports = new MessageProcessor();
