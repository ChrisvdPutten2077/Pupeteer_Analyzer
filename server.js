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
app.post('/lighthouse', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'Body must contain an array "urls"' });
    }

    const results = [];
    for (const url of urls) {
      console.log(`Running Lighthouse for: ${url}`);
      const metrics = await runLighthouseAudit(url);
      results.push({ url, ...metrics });
    }
    res.json({ results });
  } catch (error) {
    console.error('Error in /lighthouse endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Functie om een Lighthouse-audit uit te voeren en performance metrics op te halen
async function runLighthouseAudit(url) {
  let browser;
  try {
    // Start een headless Chrome met Puppeteer
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const wsEndpoint = browser.wsEndpoint();
    const port = new URL(wsEndpoint).port;

    // Dynamisch importeren van Lighthouse (omdat Lighthouse een ES Module is)
    const { default: lighthouse } = await import('lighthouse');

    const options = {
      logLevel: 'info',
      output: 'json',
      onlyCategories: ['performance'],
      port
    };

    const runnerResult = await lighthouse(url, options);
    const reportJson = runnerResult.report;
    const report = JSON.parse(reportJson);

    const fcp = report.audits['first-contentful-paint'].displayValue;
    const lcp = report.audits['largest-contentful-paint'].displayValue;
    const tbt = report.audits['total-blocking-time'].displayValue;
    const cls = report.audits['cumulative-layout-shift'].displayValue;
    const si  = report.audits['speed-index'].displayValue;

    return { fcp, lcp, tbt, cls, si };
  } catch (err) {
    console.error('Lighthouse audit error:', err);
    return { error: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

// Start de server op de poort die door de omgeving wordt meegegeven of op 3000 als fallback
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lighthouse server is running on port ${PORT}`);
});
