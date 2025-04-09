////////////////////////////////////////////////////////
// server.js
////////////////////////////////////////////////////////
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Gebruik de Stealth Plugin
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

// Endpoint: /analyze
// Dit endpoint verwacht een POST met een JSON-body: { "urls": ["https://site1.com", "https://site2.com"] }
app.post('/analyze', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'Body must contain an array "urls"' });
    }

    const results = [];
    for (const url of urls) {
      console.log(`Running Lighthouse audit for: ${url}`);
      const metrics = await runLighthouseAudit(url);
      results.push({ url, ...metrics });
    }
    res.json({ results });
  } catch (error) {
    console.error('Error in /analyze endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Functie om een Lighthouse-audit uit te voeren en performance metrics op te halen
async function runLighthouseAudit(url) {
  let browser;
  try {
    // Start een headless browser met Puppeteer en gebruik de geïnstalleerde Chromium
    browser = await puppeteer.launch({
      headless: true,
      execPath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
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

    // Extraheer de belangrijkste metrics
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

// Start de server op de door Render meegegeven poort of fallback op 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
