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

    // Mobiele emulatie en throttling
    await page.emulate(puppeteer.devices['Moto G4']);
    await page.emulateNetworkConditions(puppeteer.networkConditions['Slow 4G']);

    // Log API-verzoeken
    const apiRequests = new Set();
    page.on('request', request => {
      const reqUrl = request.url().toLowerCase();
      if (reqUrl.includes('/api/') || reqUrl.includes('graphql') || reqUrl.includes('rest')) {
        apiRequests.add(reqUrl);
      }
    });

    const startTime = Date.now();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForTimeout(2000); // Wacht op JS-rendering
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

    // Producten tellen op de huidige pagina
    const countProductsOnPage = async () => {
      return await page.evaluate(() => {
        const selectors = [
          '.product', '.product-item', '.item', '.product-card',
          '.shop-item', '.grid-item', '.card', '.listing',
          '.prod', '[data-product]', '.product-list', '.shop-product'
        ];
        let count = 0;
        selectors.forEach(sel => {
          count += document.querySelectorAll(sel).length;
        });
        const productLinks = document.querySelectorAll('a[href*="product"], a[href*="shop"]').length;
        const textCount = Array.from(document.querySelectorAll('*'))
          .filter(el => el.textContent.toLowerCase().includes('product') && el.children.length === 0).length;
        return Math.max(count, productLinks, Math.floor(textCount / 2));
      });
    };

    // Producten op homepagina
    let totalProductCount = await countProductsOnPage();

    // Vind menu-links en tel producten op subpagina’s
    const menuLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('header a, nav a'));
      return links
        .map(link => link.href)
        .filter(href => href && href.includes(window.location.origin) && !href.includes('contact') && !href.includes('onderhoud'))
        .filter((href, index, self) => self.indexOf(href) === index); // Unieke links
    });

    // Bezoek subpagina’s en tel producten
    for (const link of menuLinks) {
      try {
        await page.goto(link, { waitUntil: 'networkidle0', timeout: 15000 });
        await page.waitForTimeout(1000);
        const subPageCount = await countProductsOnPage();
        totalProductCount += subPageCount;
      } catch (err) {
        console.log(`Kon subpagina niet laden: ${link}`);
      }
    }

    const apiUsage = apiRequests.size > 0;

    return {
      url,
      loadTime,
      title,
      metaDescription,
      structuredDataCount,
      productCount: totalProductCount,
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
