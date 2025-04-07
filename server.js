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

    await page.emulate(puppeteer.devices['Moto G4']);
    await page.emulateNetworkConditions(puppeteer.networkConditions['Slow 4G']);

    const apiRequests = new Set();
    page.on('request', request => {
      const reqUrl = request.url().toLowerCase();
      if (reqUrl.includes('/api/') || reqUrl.includes('graphql') || reqUrl.includes('rest')) {
        apiRequests.add(reqUrl);
      }
    });

    const startTime = Date.now();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForTimeout(5000); // Verlengde wachttijd voor dynamische content
    const loadTime = (Date.now() - startTime) / 1000;

    const title = await page.title();

    let metaDescription = 'No meta description found';
    try {
      metaDescription = await page.$eval(
        'meta[name="description"], meta[property="og:description"]',
        el => el.content
      );
    } catch (err) {}

    const structuredDataCount = await page.evaluate(() => {
      const jsonLd = document.querySelectorAll('script[type="application/ld+json"]').length;
      const microdata = document.querySelectorAll('[itemscope]').length;
      return jsonLd + microdata;
    });

    const jsonLdData = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      return scripts.map(script => {
        try {
          return JSON.parse(script.innerText);
        } catch (e) {
          return null;
        }
      }).filter(data => data !== null);
    });
    const jsonLdProducts = jsonLdData.filter(data => {
      if (Array.isArray(data)) {
        return data.some(item => item['@type'] === 'Product');
      } else {
        return data['@type'] === 'Product';
      }
    });

    const countProductsOnPage = async (pageUrl) => {
      return await page.evaluate(() => {
        const selectors = [
          '.product', '.product-item', '.product-card',
          '.shop-item', '.grid-item', '[data-product]', 
          '.product-list', '.shop-product'
        ];
        const productsMap = new Map();

        selectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return;
            }

            // Verbeterde prijsselector
            const price = el.querySelector('.price, .amount, [class*="price"], .woocommerce-Price-amount, .cost, [class*="cost"], [itemprop="price"]')?.textContent?.trim() || '';
            // Tijdelijk commentaar op prijsfilter voor debugging
            // if (!price) {
            //   return;
            // }

            const name = el.querySelector('h2, h3, .name, .title')?.textContent?.trim() || '';
            const id = el.getAttribute('data-product-id') || el.getAttribute('id') || '';
            const link = el.querySelector('a')?.href || '';

            const cleanName = name.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim();
            const identifier = id ? id : `${cleanName}-${price}`.trim();

            if (cleanName && cleanName.length > 2 && !cleanName.toLowerCase().includes('categorie') && !cleanName.toLowerCase().includes('alle') && !cleanName.toLowerCase().includes('producten')) {
              productsMap.set(identifier, { id: identifier, name, price, link });
            }
          });
        });

        const productLinks = document.querySelectorAll('a[href*="product"], a[href*="/shop/"]');
        productLinks.forEach(link => {
          const style = window.getComputedStyle(link);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return;
          }

          const href = link.href;
          if (href.includes('/product-categorie/')) {
            return;
          }

          const name = link.textContent.trim();
          const cleanName = name.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim();
          const price = link.parentElement?.querySelector('.price, .amount, [class*="price"], .woocommerce-Price-amount, .cost, [class*="cost"], [itemprop="price"]')?.textContent?.trim() || '';
          // Tijdelijk commentaar op prijsfilter voor debugging
          // if (!price) {
          //   return;
          // }

          const identifier = `${cleanName}-${price}`.trim();
          if (cleanName && cleanName.length > 2 && !cleanName.toLowerCase().includes('categorie') && !cleanName.toLowerCase().includes('alle') && !cleanName.toLowerCase().includes('producten')) {
            productsMap.set(identifier,
