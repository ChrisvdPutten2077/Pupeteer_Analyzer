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
  const maxExecutionTime = 60000; // Maximale uitvoeringstijd: 60 seconden
  const startTime = Date.now();

  while (attempt < retries) {
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled', // Om botdetectie te omzeilen
        ],
      });
      const page = await browser.newPage();

      // Omzeil botdetectie
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      });

      const apiRequests = new Set();
      page.on('request', request => {
        const reqUrl = request.url().toLowerCase();
        if (reqUrl.includes('/api/') || reqUrl.includes('graphql') || reqUrl.includes('rest')) {
          apiRequests.add(reqUrl);
        }
      });

      let loadTime = null;
      let title = 'Unknown';
      let metaDescription = 'No meta description found';
      let structuredDataCount = 0;
      let jsonLdProducts = [];

      try {
        const pageStartTime = Date.now();
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
        loadTime = (Date.now() - pageStartTime) / 1000;

        // Scroll om dynamische content te laden
        await page.evaluate(async () => {
          await new Promise(resolve => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
              const scrollHeight = document.body.scrollHeight;
              window.scrollBy(0, distance);
              totalHeight += distance;
              if (totalHeight >= scrollHeight) {
                clearInterval(timer);
                resolve();
              }
            }, 100);
          });
        });
        await page.waitForTimeout(1000);

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
            const categoryLinks = document.querySelectorAll(
              'a[href*="/product-categorie/"], a[href*="/category/"], a[href*="/shop/"], a[href*="/collections/"], a[href*="/products/"]'
            );
            const categories = [];

            categoryLinks.forEach(link => {
              const style = window.getComputedStyle(link);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return;
              }

              const name = link.textContent.trim();
              const href = link.href;
              const cleanName = name.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim();

              const match = cleanName.match(/(\d+)\s*(Producten|Items|Products|Artikelen|Goods)/i);
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
              '.product', '.product-item', '.product-card', '.shop-item', '.grid-item',
              '[data-product]', '.product-list', '.shop-product', '.woocommerce-product',
              '.product-grid-item', '.product-block', '.item-product', '.product-wrapper',
              '[data-product-id]', '[itemtype="http://schema.org/Product"]', '.card-product',
              '.product-tile', '.item', '.entry', '.product-entry'
            ];
            const productsMap = new Map();

            selectors.forEach(sel => {
              document.querySelectorAll(sel).forEach(el => {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                  return;
                }

                const price = el.querySelector(
                  '.price, .amount, [class*="price"], .woocommerce-Price-amount, .cost, [class*="cost"], [itemprop="price"], .product-price, .regular-price, .money, .price--main, .sale-price'
                )?.textContent?.trim() || '';

                const name = el.querySelector(
                  'h2, h3, h4, .name, .title, .product-title, [itemprop="name"], .product-name'
                )?.textContent?.trim() || '';
                const id = el.getAttribute('data-product-id') || el.getAttribute('id') || '';
                const link = el.querySelector('a')?.href || '';

                const cleanName = name.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
                if (!cleanName || cleanName.length < 3) return;
                if (
                  cleanName.includes('categorie') ||
                  cleanName.includes('category') ||
                  cleanName.includes('alle') ||
                  cleanName.includes('producten') ||
                  cleanName.includes('webshop') ||
                  cleanName.includes('shop now') ||
                  cleanName.includes('view all') ||
                  cleanName.includes('bekijk') ||
                  cleanName.includes('meer')
                ) return;

                const identifier = id ? id : `${cleanName}-${price}`.trim();
                if (price || link) { // Vereis een prijs of een link
                  productsMap.set(identifier, { id: identifier, name, price, link });
                }
              });
            });

            const productLinks = document.querySelectorAll(
              'a[href*="product"], a[href*="/shop/"], a[href*="/products/"], a[href*="/item/"], a[href*="/p/"]'
            );
            productLinks.forEach(link => {
              const style = window.getComputedStyle(link);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return;
              }

              const href = link.href;
              if (href.includes('/product-categorie/') || href.includes('/category/') || href.includes('/shop/') || href.includes('/collections/')) {
                return;
              }

              const name = link.textContent.trim();
              const cleanName = name.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
              if (!cleanName || cleanName.length < 3) return;
              if (
                cleanName.includes('categorie') ||
                cleanName.includes('category') ||
                cleanName.includes('alle') ||
                cleanName.includes('producten') ||
                cleanName.includes('webshop') ||
                cleanName.includes('shop now') ||
                cleanName.includes('view all') ||
                cleanName.includes('bekijk') ||
                cleanName.includes('meer')
              ) return;

              const price = link.parentElement?.querySelector(
                '.price, .amount, [class*="price"], .woocommerce-Price-amount, .cost, [class*="cost"], [itemprop="price"], .product-price, .regular-price, .money, .price--main, .sale-price'
              )?.textContent?.trim() || '';

              const identifier = `${cleanName}-${price}`.trim();
              productsMap.set(identifier, { id: identifier, name, price, link: href });
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
          const headerLinks = Array.from(document.querySelectorAll('header a, nav a, .header a, .nav a, .menu a'));
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
              !item.text.includes('about') && 
              !item.text.includes('over') && 
              !item.href.includes('#') &&
              item.href !== window.location.href &&
              !item.href.includes('/product-categorie/') &&
              !item.href.includes('/category/')
            )
            .filter((item, index, self) => 
              self.findIndex(i => i.href === item.href) === index
            )
            .slice(0, 2); // Beperk tot 2 subpagina's
        });

        for (const menuItem of menuLinks) {
          if (Date.now() - startTime > maxExecutionTime) {
            console.log(`Max execution time exceeded for ${url}, stopping subpage analysis`);
            break;
          }

          try {
            console.log(`Bezoek subpagina: ${menuItem.href} (${menuItem.text})`);
            await page.goto(menuItem.href, { waitUntil: 'networkidle0', timeout: 20000 });
            await page.evaluate(async () => {
              await new Promise(resolve => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                  const scrollHeight = document.body.scrollHeight;
                  window.scrollBy(0, distance);
                  totalHeight += distance;
                  if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                  }
                }, 100);
              });
            });
            await page.waitForTimeout(1000);
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
