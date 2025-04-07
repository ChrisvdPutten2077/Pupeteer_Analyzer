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

    // Producten tellen op een pagina, alleen zichtbare elementen
    const countProductsOnPage = async (pageUrl) => {
      return await page.evaluate(() => {
        const selectors = [
          '.product', '.product-item', '.product-card',
          '.shop-item', '.grid-item', '[data-product]', 
          '.product-list', '.shop-product'
        ];
        const products = new Set();

        selectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return;
            }

            const price = el.querySelector('.price, .amount, [class*="price"]')?.textContent?.trim().toLowerCase() || '';
            if (!price) {
              return;
            }

            const name = el.querySelector('h2, h3, .name, .title')?.textContent?.trim().toLowerCase() || '';
            const id = el.getAttribute('data-product-id') || el.getAttribute('id') || '';
            const link = el.querySelector('a')?.href || '';

            const cleanName = name.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
            const identifier = id ? id : `${cleanName}-${price}`.trim();

            if (cleanName && cleanName.length > 2 && !cleanName.includes('categorie') && !cleanName.includes('alle')) {
              products.add(identifier);
            }
          });
        });

        const productLinks = document.querySelectorAll('a[href*="product"], a[href*="/shop/"]');
        productLinks.forEach(link => {
          const style = window.getComputedStyle(link);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return;
          }

          const name = link.textContent.trim().toLowerCase();
          const href = link.href;
          const cleanName = name.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
          const price = link.parentElement?.querySelector('.price, .amount, [class*="price"]')?.textContent?.trim().toLowerCase() || '';
          if (!price) {
            return;
          }

          const identifier = `${cleanName}-${price}`.trim();
          if (cleanName && cleanName.length > 2 && !cleanName.includes('categorie') && !cleanName.includes('alle')) {
            products.add(identifier);
          }
        });

        return Array.from(products);
      });
    };

    const allProducts = new Set();

    let homeProducts = await countProductsOnPage(url);
    homeProducts.forEach(product => allProducts.add(product));
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
          item.href !== window.location.href
        )
        .filter((item, index, self) => 
          self.findIndex(i => i.href === item.href) === index
        );
    });

    for (const menuItem of menuLinks) {
      try {
        console.log(`Bezoek subpagina: ${menuItem.href} (${menuItem.text})`);
        await page.goto(menuItem.href, { waitUntil: 'networkidle0', timeout: 15000 });
        await page.waitForTimeout(1000);
        const subPageProducts = await countProductsOnPage(menuItem.href);
        subPageProducts.forEach(product => allProducts.add(product));
        console.log(`Subpagina ${menuItem.href}: ${subPageProducts.length} producten`);
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
      productCount: allProducts.size,
      apiUsage
    };
  } catch (error) {
    console.error('Error analyzing URL:', url, error);
    return { url, error: `Could not load the page: ${error.message}` }; // Verwijderd extra haakje
  } finally {
    if (browser) await browser.close();
  }
}
