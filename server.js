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
    const ldScripts = await page.$$eval('script[type="application/ld+json"]', scripts => scripts.length);
    const structuredDataCount = ldScripts;

    // 5. Additional checks? E.g., check if there’s an H1, or if jQuery is loaded
    // let hasH1 = await page.$('h1') !== null;

    // Return an object with all the info
    return {
      url,
      title,
      usesHttps,
      metaDescription,
      structuredDataCount,
      loadTime
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
