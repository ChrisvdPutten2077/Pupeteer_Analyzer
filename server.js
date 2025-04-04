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
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);

    // Log netwerkverzoeken voor apiUsage
    const apiRequests = new Set();
    page.on('request', request => {
      if (request.url().includes('/api/') || request.url().includes('graphql')) {
        apiRequests.add(request.url());
      }
    });

    const startTime = Date.now();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 }); // Volledige laadtijd
    const loadTime = (Date.now() - startTime) / 1000;

    // Wacht kort op dynamische titelupdates
    await page.waitForTimeout(1000); // 1 seconde extra voor JS
    const title = await page.title();

    // Meta Description, breder zoeken
    let metaDescription = 'No meta description found';
    try {
      metaDescription = await page.$eval('meta[name="description"], meta[property="og:description"]', el => el.content);
    } catch (err) {}

    // Structured Data, meer formaten
    const structuredDataCount = await page.evaluate(() => {
      const jsonLd = document.querySelectorAll('script[type="application/ld+json"]').length;
      const microdata = document.querySelectorAll('[itemscope]').length;
      return jsonLd + microdata;
    });

    // Product Count, meer selectors en tekstanalyse
    const productCount = await page.evaluate(() => {
      const selectors = [
        '.product', '.product-item', '.item', '.product-card', 
        '.shop-item', '[data-product]', '.prod', '.listing'
      ];
      let count = 0;
      selectors.forEach(sel => {
        count += document.querySelectorAll(sel).length;
      });
      // Tekstanalyse als fallback
      const textCount = Array.from(document.querySelectorAll('*'))
        .filter(el => el.textContent.toLowerCase().includes('product') && el.children.length === 0).length;
      return Math.max(count, textCount / 2); // Conservatieve schatting
    });

    // API Usage gebaseerd op echte verzoeken
    const apiUsage = apiRequests.size > 0;

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
    if (browser) await browser.close();
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
