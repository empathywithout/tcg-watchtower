# Website API Integration

Documentation for integrating your website with the TCG Watchtower Automation Engine.

## Overview

The automation engine can POST restock data to your website API endpoint. This allows you to:
- Store restock alerts in your database
- Display live restocks on your website
- Build analytics and tracking features
- Create custom notifications

## Configuration

Set these environment variables:

```env
ENABLE_WEBSITE=true
WEBSITE_API_URL=https://your-domain.com/api/restock
WEBSITE_API_KEY=your_optional_api_key_here
```

## API Request

### Endpoint
```
POST /api/restock
```

### Headers
```
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY  (if WEBSITE_API_KEY is set)
```

### Payload

```json
{
  "product_name": "Pokemon Destined Rivals ETB",
  "price": "$49.99",
  "affiliate_link": "https://affiliate-link.com/product",
  "image_url": "https://cdn.discord.com/attachments/12345/image.png",
  "timestamp": "2025-03-07T10:30:00.000Z",
  "source_message_id": "1234567890123456789",
  "source_channel_id": "9876543210987654321",
  "raw_content": "🚨 RESTOCK ALERT\n\nPokemon Destined Rivals ETB is back in stock!\n\nRetail: $49.99\n\nGrab it here:\nhttps://affiliate-link.com/product"
}
```

### Field Descriptions

| Field | Type | Description | Can be null |
|-------|------|-------------|-------------|
| `product_name` | string | Extracted product name | No |
| `price` | string | Formatted price (e.g., "$49.99") | Yes |
| `affiliate_link` | string | Product purchase URL | Yes |
| `image_url` | string | First image from Discord message | Yes |
| `timestamp` | string | ISO 8601 timestamp | No |
| `source_message_id` | string | Discord message ID | No |
| `source_channel_id` | string | Discord channel ID | No |
| `raw_content` | string | Original Discord message | No |

## Response

### Success Response

**Status Code:** `200 OK` or `201 Created`

```json
{
  "success": true,
  "message": "Restock alert saved",
  "id": "restock_123456"
}
```

### Error Response

**Status Code:** `400 Bad Request`, `401 Unauthorized`, `500 Internal Server Error`

```json
{
  "success": false,
  "error": "Invalid API key"
}
```

## Example Implementation

### Express.js / Node.js

```javascript
const express = require('express');
const app = express();

app.use(express.json());

// Middleware to verify API key
const verifyApiKey = (req, res, next) => {
  const apiKey = req.headers.authorization?.replace('Bearer ', '');
  
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid API key' });
  }
  
  next();
};

// Restock endpoint
app.post('/api/restock', verifyApiKey, async (req, res) => {
  try {
    const {
      product_name,
      price,
      affiliate_link,
      image_url,
      timestamp,
      source_message_id,
      source_channel_id,
      raw_content
    } = req.body;

    // Validate required fields
    if (!product_name || !timestamp) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Save to database
    const restock = await db.restocks.create({
      product_name,
      price,
      affiliate_link,
      image_url,
      timestamp: new Date(timestamp),
      source_message_id,
      source_channel_id,
      raw_content
    });

    res.status(201).json({
      success: true,
      message: 'Restock alert saved',
      id: restock.id
    });

  } catch (error) {
    console.error('Error saving restock:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.listen(3000, () => {
  console.log('API server running on port 3000');
});
```

### Python / Flask

```python
from flask import Flask, request, jsonify
from datetime import datetime
import os

app = Flask(__name__)

def verify_api_key():
    api_key = request.headers.get('Authorization', '').replace('Bearer ', '')
    return api_key == os.getenv('API_KEY')

@app.route('/api/restock', methods=['POST'])
def restock():
    if not verify_api_key():
        return jsonify({'success': False, 'error': 'Invalid API key'}), 401
    
    data = request.get_json()
    
    # Validate required fields
    if not data.get('product_name') or not data.get('timestamp'):
        return jsonify({'success': False, 'error': 'Missing required fields'}), 400
    
    # Save to database
    restock = {
        'product_name': data.get('product_name'),
        'price': data.get('price'),
        'affiliate_link': data.get('affiliate_link'),
        'image_url': data.get('image_url'),
        'timestamp': datetime.fromisoformat(data.get('timestamp')),
        'source_message_id': data.get('source_message_id'),
        'source_channel_id': data.get('source_channel_id'),
        'raw_content': data.get('raw_content')
    }
    
    # db.save(restock)  # Your database save logic here
    
    return jsonify({
        'success': True,
        'message': 'Restock alert saved',
        'id': 'restock_123456'
    }), 201

if __name__ == '__main__':
    app.run(port=3000)
```

### PHP / Laravel

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Restock;

class RestockController extends Controller
{
    public function store(Request $request)
    {
        // Verify API key
        $apiKey = str_replace('Bearer ', '', $request->header('Authorization'));
        
        if ($apiKey !== env('API_KEY')) {
            return response()->json([
                'success' => false,
                'error' => 'Invalid API key'
            ], 401);
        }
        
        // Validate request
        $validated = $request->validate([
            'product_name' => 'required|string',
            'price' => 'nullable|string',
            'affiliate_link' => 'nullable|url',
            'image_url' => 'nullable|url',
            'timestamp' => 'required|date',
            'source_message_id' => 'required|string',
            'source_channel_id' => 'required|string',
            'raw_content' => 'required|string',
        ]);
        
        // Save to database
        $restock = Restock::create($validated);
        
        return response()->json([
            'success' => true,
            'message' => 'Restock alert saved',
            'id' => $restock->id
        ], 201);
    }
}
```

## Database Schema Example

### SQL

```sql
CREATE TABLE restocks (
  id SERIAL PRIMARY KEY,
  product_name VARCHAR(255) NOT NULL,
  price VARCHAR(50),
  affiliate_link TEXT,
  image_url TEXT,
  timestamp TIMESTAMP NOT NULL,
  source_message_id VARCHAR(100) NOT NULL,
  source_channel_id VARCHAR(100) NOT NULL,
  raw_content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_restocks_timestamp ON restocks(timestamp);
CREATE INDEX idx_restocks_product ON restocks(product_name);
```

### MongoDB

```javascript
const RestockSchema = new Schema({
  product_name: { type: String, required: true },
  price: { type: String },
  affiliate_link: { type: String },
  image_url: { type: String },
  timestamp: { type: Date, required: true },
  source_message_id: { type: String, required: true },
  source_channel_id: { type: String, required: true },
  raw_content: { type: String, required: true }
}, {
  timestamps: true
});

RestockSchema.index({ timestamp: -1 });
RestockSchema.index({ product_name: 1 });
```

## Testing

### Test with cURL

```bash
curl -X POST https://your-domain.com/api/restock \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key" \
  -d '{
    "product_name": "Test Product",
    "price": "$99.99",
    "affiliate_link": "https://example.com/product",
    "image_url": "https://example.com/image.png",
    "timestamp": "2025-03-07T10:30:00.000Z",
    "source_message_id": "1234567890",
    "source_channel_id": "0987654321",
    "raw_content": "Test restock alert"
  }'
```

### Expected Response

```json
{
  "success": true,
  "message": "Restock alert saved",
  "id": "restock_123456"
}
```

## Error Handling

The automation engine will log errors but will NOT retry failed API calls. You should:

1. **Monitor your API logs** for incoming requests
2. **Implement proper error responses** (4xx, 5xx)
3. **Use idempotency keys** if you want to prevent duplicates
4. **Set up alerts** for failed API calls

## Rate Limiting

Consider implementing rate limiting on your API:

```javascript
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', apiLimiter);
```

## Security Best Practices

1. **Always use HTTPS** for your API endpoint
2. **Validate API keys** on every request
3. **Sanitize input data** before saving to database
4. **Log all requests** for debugging
5. **Implement rate limiting** to prevent abuse
6. **Use environment variables** for sensitive data

## Troubleshooting

### Bot shows "Posted to Website" but data not in database

- Check your API endpoint is accessible
- Verify API key is correct
- Check API server logs for errors
- Ensure your server is accepting POST requests

### Getting 401 Unauthorized

- Verify `WEBSITE_API_KEY` matches your server's expected key
- Check the Authorization header format
- Ensure your server is reading the header correctly

### Getting timeout errors

- Check your API response time (should be < 10 seconds)
- Verify your server is not overloaded
- Check network connectivity

## Support

For issues with the automation engine:
- Check Railway logs
- Review the bot's error logs
- Open a GitHub issue

For issues with your API:
- Check your server logs
- Test endpoint with cURL
- Verify database connectivity

---

**Need help?** Open an issue on GitHub or contact support.
