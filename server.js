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

    // Producten tellen op een pagina met unieke identificatie
    const countProductsOnPage = async () => {
      return await page.evaluate(() => {
        const selectors = [
          '.product', '.product-item', '.product-card',
          '.shop-item', '.grid-item', '.card', '.listing',
          '[data-product]', '.product-list', '.shop-product'
        ];
        const productElements = new Set();
        
        // Selectors voor productelementen
        selectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            // Probeer een unieke identifier te vinden (bijv. productnaam of ID)
            const name = el.querySelector('h2, h3, .name, .title')?.textContent?.trim().toLowerCase() || el.textContent.trim().toLowerCase();
            if (name && name.length > 2) { // Zorg dat het geen lege of te korte naam is
              productElements.add(name);
            }
          });
        });

        // Extra: links naar productpagina’s
        const productLinks = document.querySelectorAll('a[href*="product"], a[href*="shop"]');
        productLinks.forEach(link => {
          const name = link.textContent.trim().toLowerCase();
          if (name && name.length > 2) {
            productElements.add(name);
          }
        });

        // Tekstanalyse als fallback, maar minder agressief
        const textCount = Array.from(document.querySelectorAll('h2, h3, .name, .title'))
          .filter(el => el.textContent.toLowerCase().includes('product') && el.children.length === 0).length;

        return productElements.size + Math.floor(textCount / 4); // Conservatiever met tekst
      });
    };

    // Producten op homepagina
    let totalProductCount = await countProductsOnPage();
    console.log(`Homepagina (${url}): ${totalProductCount} producten`);

    // Vind menu-items in de header
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

    // Bezoek subpagina’s (1 layer diep)
    for (const menuItem of menuLinks) {
      try {
        console.log(`Bezoek subpagina: ${menuItem.href} (${menuItem.text})`);
        await page.goto(menuItem.href, { waitUntil: 'networkidle0', timeout: 15000 });
        await page.waitForTimeout(1000);
        const subPageCount = await countProductsOnPage();
        console.log(`Subpagina ${menuItem.href}: ${subPageCount} producten`);
        totalProductCount += subPageCount;
      } catch (err) {
        console.log(`Kon subpagina niet laden: ${menuItem.href} - ${err.message}`);
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
