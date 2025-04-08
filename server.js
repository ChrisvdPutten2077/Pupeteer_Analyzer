////////////////////////////////////////////////////////
// server.js
////////////////////////////////////////////////////////
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fetch = require('node-fetch'); // Alleen nodig als je data naar Make wilt sturen

// Gebruik de Stealth Plugin om detectie te vermijden
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

// Endpoint om URL's te analyseren; verwacht een JSON body met een array "urls"
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
    
    // (Optioneel) Verstuur de resultaten via een webhook naar Make
    // await sendDataToMake(results);

    res.json(results);
  } catch (err) {
    console.error('Error in /analyze endpoint:', err);
    res.status(500).json({ error: err.message });
  }
});

// Functie om een enkele URL te analyseren
async function analyzeUrl(url) {
  let browser;
  const maxExecutionTime = 60000; // Maximum 60 seconden per URL
  const startTime = Date.now();

  try {
    // Start de browser met de nieuwe headless modus
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await browser.newPage();

    // Stel een realistische User-Agent en extra headers in
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    // Houd netwerkverzoeken bij die mogelijk API's aangeven
    const apiRequests = new Set();
    page.on('request', request => {
      const reqUrl = request.url().toLowerCase();
      if (reqUrl.includes('/api/') || reqUrl.includes('graphql') || reqUrl.includes('rest')) {
        apiRequests.add(reqUrl);
      }
    });

    let title = 'Unknown';
    let metaDescription = 'No meta description found';
    let structuredDataCount = 0;
    let productCount = 0;

    // Laad de pagina, eerst met networkidle0, anders fallback naar domcontentloaded
    const pageStartTime = Date.now();
    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    } catch (err) {
      console.log(`Networkidle0 failed for ${url}, falling back to domcontentloaded`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    const loadTime = (Date.now() - pageStartTime) / 1000;

    // Scroll om lazy-loaded content te laden
    await autoScroll(page);
    await page.waitForTimeout(1000);

    // Haal de titel en meta description op
    title = await page.title();
    try {
      metaDescription = await page.$eval(
        'meta[name="description"], meta[property="og:description"]',
        el => el.content
      );
    } catch (err) {
      // Indien niet gevonden, blijft het de standaardwaarde
    }

    // Tel structured data (JSON-LD en microdata)
    structuredDataCount = await page.evaluate(() => {
      const jsonLd = document.querySelectorAll('script[type="application/ld+json"]').length;
      const microdata = document.querySelectorAll('[itemscope]').length;
      return jsonLd + microdata;
    });

    // Eenvoudige telling van producten op de pagina
    const products = await countProductsOnPage(page, url);
    productCount = products.length;
    const safeProductEstimate = productCount >= 100 ? 'meer dan 100' : productCount;

    // Haal JSON-LD data op en filter op Product
    const jsonLdData = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map(script => {
          try {
            return JSON.parse(script.textContent);
          } catch (err) {
            return null;
          }
        })
        .filter(Boolean);
    });
    const jsonLdProducts = jsonLdData.filter(data => {
      if (Array.isArray(data)) {
        return data.some(item => item['@type'] === 'Product');
      }
      return data['@type'] === 'Product';
    });

    // Stel een extra observatie op op basis van API-verzoeken
    const apiUsage = apiRequests.size > 0;
    let extraObservation = '';
    if (!apiUsage) {
      extraObservation =
        'Geen API-koppelingen gevonden. Dit wijst erop dat er mogelijk geen geïntegreerd headless/PIM-systeem aanwezig is.';
    }

    return {
      url,
      loadTime,
      title,
      metaDescription,
      structuredDataCount,
      productCount,
      safeProductEstimate,
      apiUsage,
      pimDataAvailable: jsonLdProducts.length > 0,
      jsonLdProductsCount: jsonLdProducts.length,
      extraObservation
    };
  } catch (error) {
    console.error(`Error analyzing URL ${url}:`, error.message);
    return {
      url,
      error: error.message
    };
  } finally {
    const elapsed = Date.now() - startTime;
    if (browser) await browser.close();
    console.log(`Finished analyzing ${url} in ${(elapsed / 1000).toFixed(2)} s`);
  }
}

// Helper functie om automatisch naar beneden te scrollen
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

// Eenvoudige producttelling gebaseerd op opgegeven selectors
async function countProductsOnPage(page, pageUrl) {
  try {
    const selectors = [
      '.product',
      '.product-item',
      '.product-card',
      '.shop-item',
      '.grid-item'
      // Voeg hier andere specifieke selectors toe indien nodig
    ];
    return await page.evaluate((selectors) => {
      const products = [];
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            products.push(el.innerText.trim());
          }
        });
      });
      return products;
    }, selectors);
  } catch (err) {
    console.error(`Error counting products on ${pageUrl}:`, err.message);
    return [];
  }
}

// (Optioneel) Functie om data naar Make te sturen via een webhook
async function sendDataToMake(data) {
  const MAKE_WEBHOOK_URL = 'https://hook.make.com/your-unique-webhook-url'; // Vervang door jouw Make webhook URL
  try {
    const response = await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    console.log(`Data sent to Make, status: ${response.status}`);
  } catch (error) {
    console.error('Error sending data to Make:', error);
  }
}

// Start de server op de poort die door de omgeving wordt meegegeven of op 3000 als fallback
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
