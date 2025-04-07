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
    await page.waitForTimeout(2000);
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

    // Functie om categorielinks te verzamelen en aantallen te extraheren
    const extractCategoryCounts = async (pageUrl) => {
      return await page.evaluate(() => {
        const categoryLinks = document.querySelectorAll('a[href*="/product-categorie/"]');
        const categories = [];

        categoryLinks.forEach(link => {
          const style = window.getComputedStyle(link);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return;
          }

          const name = link.textContent.trim();
          const href = link.href;
          const cleanName = name.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim();

          // Controleer of de naam een getal bevat gevolgd door "Producten"
          const match = cleanName.match(/(\d+)\s*Producten/i);
          if (match) {
            const count = parseInt(match[1], 10);
            categories.push({ name: cleanName, count, link: href });
          }
        });

        return categories;
      });
    };

    // Verzamelen van categorieën en hun aantallen
    const categoryCounts = await extractCategoryCounts(url);
    console.log(`Categorieën gevonden op ${url}:`, categoryCounts);

    // Tel de totale productaantallen op basis van categorielinks
    const productCount = categoryCounts.reduce((total, category) => total + category.count, 0);
    const safeProductEstimate = productCount >= 100 ? "meer dan 100" : productCount;

    const apiUsage = apiRequests.size > 0;
    let extraObservation = "";
    if (!apiUsage) {
      extraObservation = "We hebben opgemerkt dat er geen API-koppelingen aanwezig zijn, wat erop wijst dat jullie mogelijk nog geen geïntegreerd systeem voor realtime data, zoals een headless/PIM-oplossing, gebruiken.";
    }

    return {
      url,
      loadTime,
      title,
      metaDescription,
      structuredDataCount,
      productCount,
      safeProductEstimate,
      categoryDetails: categoryCounts, // Voor debugging
      apiUsage,
      pimDataAvailable: jsonLdProducts.length > 0,
      jsonLdProductsCount: jsonLdProducts.length,
      extraObservation
    };
  } catch (error) {
    console.error('Error analyzing URL:', url, error);
    return { url, error: `Could not load the page: ${error.message}` };
  } finally {
    if (browser) await browser.close();
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
