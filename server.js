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

    // Emuleer een mobiel apparaat en langzame netwerkcondities
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

    // Tel de gestructureerde data-elementen (JSON-LD en microdata)
    const structuredDataCount = await page.evaluate(() => {
      const jsonLd = document.querySelectorAll('script[type="application/ld+json"]').length;
      const microdata = document.querySelectorAll('[itemscope]').length;
      return jsonLd + microdata;
    });

    // Haal JSON‑LD data op voor PIM-integratie en controleer op productdata
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

    // Functie om producten op een pagina op te halen met extra details
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
            // Controleer of het element zichtbaar is
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return;
            }

            // Haal productdetails op
            const name = el.querySelector('h2, h3, .name, .title')?.textContent?.trim() || '';
            const price = el.querySelector('.price, .amount, [class*="price"]')?.textContent?.trim() || '';
            const id = el.getAttribute('data-product-id') || el.getAttribute('id') || '';
            const link = el.querySelector('a')?.href || '';

            const cleanName = name.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim();
            const identifier = id ? id : `${cleanName}-${price}-${link}`.trim();

            if (cleanName && cleanName.length > 2) {
              productsMap.set(identifier, { id: identifier, name, price, link });
            }
          });
        });

        // Voeg ook productlinks uit anchor tags toe, als extra bron
        const productLinks = document.querySelectorAll('a[href*="product"], a[href*="/shop/"]');
        productLinks.forEach(link => {
          const style = window.getComputedStyle(link);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return;
          }

          const name = link.textContent.trim();
          const href = link.href;
          const cleanName = name.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim();
          const identifier = `${cleanName}-${href}`.trim();
          if (cleanName && cleanName.length > 2 && !cleanName.toLowerCase().includes('categorie') && !cleanName.toLowerCase().includes('alle')) {
            productsMap.set(identifier, { id: identifier, name, price: '', link: href });
          }
        });

        return Array.from(productsMap.values());
      });
    };

    // Verzamelen van unieke producten (inclusief details) over alle pagina’s
    const allProductsMap = new Map();

    // Producten op homepagina
    let homeProducts = await countProductsOnPage(url);
    homeProducts.forEach(product => allProductsMap.set(product.id, product));
    console.log(`Homepagina (${url}): ${homeProducts.length} producten`);

    // Vind menu-items in de header om subpagina's te ontdekken
    const menuLinks = await page.evaluate(() => {
      const headerLinks = Array.from(document.querySelectorAll('header a, nav a, .header a, .nav a'));
      return headerLinks
        .map(link => ({
          href: link.href,
          text: link.textContent.trim().toLowerCase()
        }))
        .filter(item => 
          item.href && 
          item.href.includes(window.location.origin) &&
          !item.text.includes('contact') && 
          !item.text.includes('onderhoud') && 
          !item.href.includes('#') &&
          item.href !== window.location.href
        )
        .filter((item, index, self) => 
          self.findIndex(i => i.href === item.href) === index
        );
    });

    // Bezoek subpagina’s (1 layer diep) en voeg hun producten toe
    for (const menuItem of menuLinks) {
      try {
        console.log(`Bezoek subpagina: ${menuItem.href} (${menuItem.text})`);
        await page.goto(menuItem.href, { waitUntil: 'networkidle0', timeout: 15000 });
        await page.waitForTimeout(1000);
        const subPageProducts = await countProductsOnPage(menuItem.href);
        subPageProducts.forEach(product => allProductsMap.set(product.id, product));
        console.log(`Subpagina ${menuItem.href}: ${subPageProducts.length} producten`);
      } catch (err) {
        console.log(`Kon subpagina niet laden: ${menuItem.href} - ${err.message}`);
      }
    }

    const productCount = allProductsMap.size;
    // Safe estimate: als er 100 of meer producten zijn, geven we “meer dan 100” terug.
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
      productDetails: Array.from(allProductsMap.values()),
      apiUsage,
      // Indicatoren voor headless/PIM integratie
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
