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

    // 1. Page Title
    const title = await page.title();

    // 2. HTTPS Check
    const usesHttps = url.startsWith('https');

    // 3. Meta Description
    let metaDescription = '';
    try {
      metaDescription = await page.$eval('meta[name="description"]', el => el.content);
    } catch (err) {
      metaDescription = 'No meta description found';
    }

    // 4. Structured Data Count
    const structuredDataCount = await page.$$eval('script[type="application/ld+json"]', scripts => scripts.length);

    // 5. Product Count using common selectors
    const productSelectors = ['.product', '.product-item', '.item', '.product-card'];
    let productCount = 0;
    for (const selector of productSelectors) {
      const count = await page.$$eval(selector, elems => elems.length);
      productCount += count;
    }

    // 6. API Usage Detection
    let apiUsage = false;
    try {
      const content = await page.content();
      apiUsage = content.includes('/api/') || content.includes('fetch(');
    } catch (err) {
      apiUsage = false;
    }

    // 7. Check for an H1 element
    let hasH1 = false;
    try {
      hasH1 = (await page.$('h1')) !== null;
    } catch (err) {
      hasH1 = false;
    }

    // 8. Detect jQuery version if loaded
    let jqueryVersion = 'Not detected';
    try {
      jqueryVersion = await page.evaluate(() => window.jQuery ? jQuery.fn.jquery : 'Not detected');
    } catch (err) {
      jqueryVersion = 'Not detected';
    }

    // 9. Login Wall Detection: check for a password input field
    let loginWallDetected = false;
    try {
      loginWallDetected = (await page.$("input[type='password']")) !== null;
    } catch (err) {
      loginWallDetected = false;
    }

    // 10. Open Graph Metadata
    let openGraphTitle = 'Not detected';
    let openGraphDescription = 'Not detected';
    try {
      openGraphTitle = await page.$eval('meta[property="og:title"]', el => el.content);
    } catch (err) {
      openGraphTitle = 'Not detected';
    }
    try {
      openGraphDescription = await page.$eval('meta[property="og:description"]', el => el.content);
    } catch (err) {
      openGraphDescription = 'Not detected';
    }

    // 11. Mobile Responsiveness: Check if viewport meta tag exists
    let viewportExists = false;
    try {
      viewportExists = (await page.$('meta[name="viewport"]')) !== null;
    } catch (err) {
      viewportExists = false;
    }

    // 12. Accessibility: Count images without alt attributes
    let imagesWithoutAlt = 0;
    try {
      imagesWithoutAlt = await page.$$eval('img', imgs =>
        imgs.filter(img => !img.getAttribute('alt') || img.getAttribute('alt').trim() === '').length
      );
    } catch (err) {
      imagesWithoutAlt = 0;
    }

    // 13. Platform Clues: Get generator meta tag (e.g., WordPress, Magento)
    let generatorMeta = 'Not detected';
    try {
      generatorMeta = await page.$eval('meta[name="generator"]', el => el.content);
    } catch (err) {
      generatorMeta = 'Not detected';
    }

    // 14. Pagination Detection: Look for common pagination elements or "load more" buttons
    let paginationDetected = false;
    try {
      paginationDetected = (await page.$('.pagination')) !== null || (await page.$('button.load-more')) !== null;
    } catch (err) {
      paginationDetected = false;
    }

    // Return all the collected data
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
      jqueryVersion,
      loginWallDetected,
      openGraphTitle,
      openGraphDescription,
      viewportExists,
      imagesWithoutAlt,
      generatorMeta,
      paginationDetected
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
