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
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    const startTime = Date.now();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const loadTime = (Date.now() - startTime) / 1000; // in seconds

    // 1. Title
    const title = await page.title();

    // 2. HTTPS check
    const usesHttps = url.startsWith('https');

    // 3. Meta description
    let metaDescription = '';
    try {
      metaDescription = await page.$eval('meta[name="description"]', el => el.content);
    } catch (err) {
      metaDescription = 'No meta description found';
    }

    // 4. Structured data (JSON-LD) count
    const structuredDataCount = await page.$$eval('script[type="application/ld+json"]', scripts => scripts.length);

    // 5. Product count: using common selectors (customize as needed)
    const productSelectors = ['.product', '.item', '.product-card'];
    let productCount = 0;
    for (const selector of productSelectors) {
      const count = await page.$$eval(selector, elems => elems.length);
      productCount += count;
    }

    // 6. API usage detection: check if the page content contains "/api/" or "fetch("
    let apiUsage = false;
    try {
      const content = await page.content();
      apiUsage = content.includes('/api/') || content.includes('fetch(');
    } catch (err) {
      apiUsage = false;
    }

    // 7. H1 element check
    let hasH1 = false;
    try {
      hasH1 = (await page.$('h1')) !== null;
    } catch (err) {
      hasH1 = false;
    }

    // 8. jQuery version detection
    let jqueryVersion = 'Not detected';
    try {
      jqueryVersion = await page.evaluate(() => window.jQuery ? jQuery.fn.jquery : 'Not detected');
    } catch (err) {
      jqueryVersion = 'Error detecting';
    }

    // Return an object with all the info
    return {
      url,
      title,
      usesHttps,
      metaDescription,
      structuredDataCount,
      loadTime,
      productCount,
      apiUsage,
      hasH1,
      jqueryVersion
    };

  } catch (error) {
    console.error('Error analyzing URL:', url, error);
    return { url, error: `Could not load the page: ${error.message}` };
  } finally {
    if (browser) await browser.close();
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
