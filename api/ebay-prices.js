// api/ebay-prices.js
// Fetches eBay prices for Pokemon cards

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cards } = req.method === 'POST' ? req.body : req.query;

  if (!cards) {
    return res.status(400).json({ error: 'Missing cards parameter' });
  }

  const cardList = typeof cards === 'string' ? JSON.parse(cards) : cards;

  try {
    // Get eBay access token
    const token = await getEbayToken();
    
    // Fetch prices for all cards in parallel
    const pricePromises = cardList.map(card => 
      getCardPrice(token, card.name, card.id, card.setName)
    );
    
    const prices = await Promise.all(pricePromises);
    
    // Filter out cards with no price found
    const validPrices = prices.filter(p => p.price !== null);
    
    // Sort by price (highest first)
    validPrices.sort((a, b) => b.price - a.price);
    
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      cards: validPrices
    });
    
  } catch (error) {
    console.error('eBay API Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch prices',
      message: error.message 
    });
  }
}

// Get eBay OAuth token
async function getEbayToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('eBay credentials not configured');
  }
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
  });
  
  if (!response.ok) {
    throw new Error(`eBay auth failed: ${response.status}`);
  }
  
  const data = await response.json();
  return data.access_token;
}

// Get price for a single card
async function getCardPrice(token, cardName, cardId, setName) {
  try {
    // Build search query - include set name for more accurate results
    const searchQuery = `${cardName} ${setName || ''} Pokemon Card`.trim();
    const query = encodeURIComponent(searchQuery);
    
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${query}&limit=10&filter=categoryIds:183454`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=US,zip=10001'
      }
    });
    
    if (!response.ok) {
      console.error(`eBay search failed for ${cardName}:`, response.status);
      return { id: cardId, name: cardName, price: null, url: null };
    }
    
    const data = await response.json();
    
    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      return { id: cardId, name: cardName, price: null, url: null };
    }
    
    // Filter for Buy It Now items (not auctions) and get median price
    const buyNowItems = data.itemSummaries.filter(item => 
      item.price && 
      item.price.value && 
      item.buyingOptions && 
      item.buyingOptions.includes('FIXED_PRICE')
    );
    
    if (buyNowItems.length === 0) {
      return { id: cardId, name: cardName, price: null, url: null };
    }
    
    // Calculate median price to avoid outliers
    const prices = buyNowItems.map(item => parseFloat(item.price.value));
    prices.sort((a, b) => a - b);
    
    const medianPrice = prices.length % 2 === 0
      ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
      : prices[Math.floor(prices.length / 2)];
    
    // Get the listing closest to median price
    const closestItem = buyNowItems.reduce((prev, curr) => {
      const prevDiff = Math.abs(parseFloat(prev.price.value) - medianPrice);
      const currDiff = Math.abs(parseFloat(curr.price.value) - medianPrice);
      return currDiff < prevDiff ? curr : prev;
    });
    
    return {
      id: cardId,
      name: cardName,
      price: parseFloat(closestItem.price.value),
      url: closestItem.itemWebUrl,
      currency: closestItem.price.currency,
      listingCount: buyNowItems.length
    };
    
  } catch (error) {
    console.error(`Error fetching price for ${cardName}:`, error);
    return { id: cardId, name: cardName, price: null, url: null };
  }
}
