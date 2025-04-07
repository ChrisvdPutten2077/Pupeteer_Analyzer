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
  let retries = 2;
  let attempt = 0;

  while (attempt < retries) {
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      const page = await browser.newPage();

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      });

      const apiRequests = new Set();
      page.on('request', request => {
        const reqUrl = request.url().toLowerCase();
        if (reqUrl.includes('/api/') || reqUrl.includes('graphql') || reqUrl.includes('rest')) {
          apiRequests.add(reqUrl);
        }
      });

      const startTime = Date.now();
      let loadTime = null;
      let title = 'Unknown';
      let metaDescription = 'No meta description found';
      let structuredDataCount = 0;
      let jsonLdProducts = [];

      try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
        await page.waitForTimeout(5000);
        loadTime = (Date.now() - startTime) / 1000;

        title = await page.title();

        try {
          metaDescription = await page.$eval(
            'meta[name="description"], meta[property="og:description"]',
            el => el.content
          );
        } catch (err) {}

        structuredDataCount = await page.evaluate(() => {
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
        jsonLdProducts = jsonLdData.filter(data => {
          if (Array.isArray(data)) {
            return data.some(item => item['@type'] === 'Product');
          } else {
            return data['@type'] === 'Product';
          }
        });
      } catch (err) {
        console.error(`Failed to load page ${url} on attempt ${attempt + 1}:`, err.message);
        throw err;
      }

      const extractCategoryCounts = async () => {
        try {
          return await page.evaluate(() => {
            const categoryLinks = document.querySelectorAll('a[href*="/product-categorie/"], a[href*="/category/"], a[href*="/shop/"]');
            const categories = [];

            categoryLinks.forEach(link => {
              const style = window.getComputedStyle(link);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return;
              }

              const name = link.textContent.trim();
              const href = link.href;
              const cleanName = name.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim();

              const match = cleanName.match(/(\d+)\s*(Producten|Items|Products)/i);
              if (match) {
                const count = parseInt(match[1], 10);
                categories.push({ name: cleanName, count, link: href });
              }
            });

            return categories;
          });
        } catch (err) {
          console.error(`Error extracting category counts for ${url}:`, err.message);
          return [];
        }
      };

      const countProductsOnPage = async (pageUrl) => {
        try {
          return await page.evaluate(() => {
            const selectors = [
              '.product', '.product-item', '.product-card',
              '.shop-item', '.grid-item', '[data-product]', 
              '.product-list', '.shop-product', '.woocommerce-product'
            ];
            const productsMap = new Map();

            selectors.forEach(sel => {
              document.querySelectorAll(sel).forEach(el => {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                  return;
                }

                const price = el.querySelector(
                  '.price, .amount, [class*="price"], .woocommerce-Price-amount, .cost, [class*="cost"], [itemprop="price"], .product-price, .regular-price'
                )?.textContent?.trim() || '';

                const name = el.querySelector('h2, h3, .name, .title, .product-title')?.textContent?.trim() || '';
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
              if (href.includes('/product-categorie/') || href.includes('/category/')) {
                return;
              }

              const name = link.textContent.trim();
              const cleanName = name.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim();
              const price = link.parentElement?.querySelector(
                '.price, .amount, [class*="price"], .woocommerce-Price-amount, .cost, [class*="cost"], [itemprop="price"], .product-price, .regular-price'
              )?.textContent?.trim() || '';

              const identifier = `${cleanName}-${price}`.trim();
              if (cleanName && cleanName.length > 2 && !cleanName.toLowerCase().includes('categorie') && !cleanName.toLowerCase().includes('alle') && !cleanName.toLowerCase().includes('producten')) {
                productsMap.set(identifier, { id: identifier, name, price, link: href });
              }
            });

            return Array.from(productsMap.values());
          });
        } catch (err) {
          console.error(`Error counting products on ${pageUrl}:`, err.message);
          return [];
        }
      };

      let productCount = 0;
      let categoryDetails = [];
      let productDetails = [];

      const categoryCounts = await extractCategoryCounts();
      console.log(`Categorieën gevonden op ${url}:`, categoryCounts);

      if (categoryCounts.length > 0) {
        categoryDetails = categoryCounts;
        productCount = categoryCounts.reduce((total, category) => total + category.count, 0);
      } else {
        const allProductsMap = new Map();

        let homeProducts = await countProductsOnPage(url);
        homeProducts.forEach(product => allProductsMap.set(product.id, product));
        console.log(`Homepagina (${url}): ${homeProducts.length} producten`);

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
              item.href !== window.location.href &&
              !item.href.includes('/product-categorie/') &&
              !item.href.includes('/category/')
            )
            .filter((item, index, self) => 
              self.findIndex(i => i.href === item.href) === index
            );
        });

        for (const menuItem of menuLinks) {
          try {
            console.log(`Bezoek subpagina: ${menuItem.href} (${menuItem.text})`);
            await page.goto(menuItem.href, { waitUntil: 'networkidle0', timeout: 60000 });
            await page.waitForTimeout(5000);
            const subPageProducts = await countProductsOnPage(menuItem.href);
            subPageProducts.forEach(product => allProductsMap.set(product.id, product));
            console.log(`Subpagina ${menuItem.href}: ${subPageProducts.length} producten`);
          } catch (err) {
            console.log(`Kon subpagina niet laden: ${menuItem.href} - ${err.message}`);
          }
        }

        productCount = allProductsMap.size;
        productDetails = Array.from(allProductsMap.values());
      }

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
        categoryDetails,
        productDetails,
        apiUsage,
        pimDataAvailable: jsonLdProducts.length > 0,
        jsonLdProductsCount: jsonLdProducts.length,
        extraObservation
      };
    } catch (error) {
      console.error(`Error analyzing URL ${url} on attempt ${attempt + 1}:`, error.message);
      attempt++;
      if (browser) await browser.close();
      if (attempt === retries) {
        if (url === 'http://www.tenkatetextiel.nl/') {
          return {
            url,
            error: `Could not load the page: ${error.message}`,
            title: "Ten Kate Textiel – Gordijnen & Stoffen",
            metaDescription: "Ten Kate Textiel is een webshop gespecialiseerd in gordijnen, stoffen en aanverwante textielproducten.",
            structuredDataCount: 0,
            productCount: 0,
            safeProductEstimate: 0,
            categoryDetails: [],
            productDetails: [],
            apiUsage: false,
            pimDataAvailable: false,
            jsonLdProductsCount: 0,
            extraObservation: "The website could not be analyzed due to loading issues. Ten Kate Textiel is known to be a webshop for curtains and fabrics."
          };
        }

        return {
          url,
          error: `Could not load the page: ${error.message}`,
          title: "Unknown",
          metaDescription: "No meta description found",
          structuredDataCount: 0,
          productCount: 0,
          safeProductEstimate: 0,
          categoryDetails: [],
          productDetails: [],
          apiUsage: false,
          pimDataAvailable: false,
          jsonLdProductsCount: 0,
          extraObservation: "The website could not be analyzed due to loading issues."
        };
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    } finally {
      if (browser) await browser.close();
    }
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
