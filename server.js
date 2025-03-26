const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

app.post('/analyze', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'Body must contain an array "urls"' });
    }

    const results = [];
    for (const url of urls) {
      if (!url.startsWith('http')) {
        results.push({ url, error: 'Invalid URL format' });
        continue;
      }
      const result = await analyzeUrl(url);
      results.push(result);
    }
    res.json(results);
  } catch (err) {
    console.error('Error in /analyze endpoint:', err);
    res.status(500).json({ error: err.message });
  }
});

async function analyzeUrl(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true, // or 'new' if you want to opt into Puppeteer's new headless mode
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();

    // Shorter, simpler wait condition to avoid timeouts
    page.setDefaultNavigationTimeout(30000);

    const startTime = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const loadTime = (Date.now() - startTime) / 1000; // in seconds

    // 1. Page Title
    const title = await page.title();

    // 2. Meta Description
    let metaDescription = '';
    try {
      metaDescription = await page.$eval('meta[name="description"]', el => el.content);
    } catch (err) {
      metaDescription = 'No meta description found';
    }

    // 3. Structured Data (JSON-LD) count
    const structuredDataCount = await page.$$eval('script[type="application/ld+json"]', scripts => scripts.length);

    // 4. Product Count using minimal selectors
    const productSelectors = ['.product', '.product-item', '.item', '.product-card'];
    let productCount = 0;
    for (const selector of productSelectors) {
      try {
        const count = await page.$$eval(selector, elems => elems.length);
        productCount += count;
      } catch (err) {
        productCount += 0;
      }
    }

    // 5. API Usage Detection
    let apiUsage = false;
    try {
      const content = await page.content();
      apiUsage = content.includes('/api/') || content.includes('fetch(');
    } catch (err) {
      apiUsage = false;
    }

    return {
      url,
      loadTime,
      title,
      metaDescription,
      structuredDataCount,
      productCount,
      apiUsage
    };
  } catch (error) {
    console.error('Error analyzing URL:', url, error);
    return { url, error: `Could not load the page: ${error.message}` };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
