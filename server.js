////////////////////////////////////////////////////////
// server.js
////////////////////////////////////////////////////////
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// fetch is niet nodig als je Make de e-mail laat sturen, dus verwijderen we de fetch-import

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

// Endpoint /analyze, dat een POST met JSON-body verwacht: { "urls": ["https://site1.com", "https://site2.com"] }
app.post('/analyze', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'Body must contain an array "urls"' });
    }
    const results = [];
    for (const url of urls) {
      console.log(`Running audit for: ${url}`);
      const metrics = await runAudit(url);
      results.push({ url, ...metrics });
    }
    res.json({ results });
  } catch (error) {
    console.error('Error in /analyze endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Functie die zowel een Lighthouse-audit uitvoert als extra controles (API-requests en JSON-LD) verzamelt
async function runAudit(url) {
  let browser;
  try {
    // Start de browser met de nieuwe headless modus en gebruik de geïnstalleerde Chromium
    browser = await puppeteer.launch({
      headless: true,
      execPath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Open een pagina voor extra controles
    const pageForChecks = await browser.newPage();
    // Verzamel API-aanroepen
    const apiRequests = [];
    pageForChecks.on('request', request => {
      const reqUrl = request.url().toLowerCase();
      if (reqUrl.includes('/api/') || reqUrl.includes('graphql') || reqUrl.includes('rest')) {
        apiRequests.push(reqUrl);
      }
    });
    // Navigeer naar de URL en wacht tot "networkidle2" (om redelijk snel te laden, maar met voldoende netwerkverkeer)
    await pageForChecks.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Verzamel alle JSON-LD data
    const jsonLdData = await pageForChecks.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      return scripts.map(script => {
        try {
          return JSON.parse(script.textContent);
        } catch (err) {
          return null;
        }
      }).filter(Boolean);
    });

    // Open een tweede pagina voor de Lighthouse audit
    const pageForLighthouse = await browser.newPage();
    // Gebruik dezelfde browser-instance; haal de Chrome debugging port op via wsEndpoint
    const wsEndpoint = browser.wsEndpoint();
    const port = new URL(wsEndpoint).port;

    // Dynamisch importeren van Lighthouse (om ES Module-fouten te vermijden)
    const { default: lighthouse } = await import('lighthouse');

    // Lighthouse-opties: alleen de performance-categorie, en output in JSON
    const options = {
      logLevel: 'info',
      output: 'json',
      onlyCategories: ['performance'],
      port
    };

    const runnerResult = await lighthouse(url, options);
    const reportJson = runnerResult.report;
    const report = JSON.parse(reportJson);

    // Extraheer de performance metrics
    const fcp = report.audits['first-contentful-paint'].displayValue;
    const lcp = report.audits['largest-contentful-paint'].displayValue;
    const tbt = report.audits['total-blocking-time'].displayValue;
    const cls = report.audits['cumulative-layout-shift'].displayValue;
    const si  = report.audits['speed-index'].displayValue;

    // Combineer alle resultaten: Lighthouse-metrics, API-request count, en JSON-LD data
    return {
      fcp,
      lcp,
      tbt,
      cls,
      si,
      apiRequestsCount: apiRequests.length,
      apiRequests: apiRequests, // Optioneel: geef de lijst met URL's
      jsonLdCount: jsonLdData.length,
      jsonLdData: jsonLdData // Optioneel: geef de volledige JSON-LD data
    };
  } catch (err) {
    console.error('Audit error:', err);
    return { error: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

// Start de server op de door Render meegegeven poort of fallback op 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
