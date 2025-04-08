////////////////////////////////////////////////////////
// server.js
////////////////////////////////////////////////////////
const express = require('express');
const lighthouse = require('lighthouse');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

// Endpoint: /lighthouse
// Verwacht een POST met een JSON-body: { "urls": ["https://example.com", ...] }
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

// Functie om Lighthouse-audit uit te voeren en performance metrics op te halen
async function runLighthouseAudit(url) {
  let browser;
  try {
    // Start een headless Chrome met Puppeteer
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    // Haal de WebSocket endpoint op en daarmee de poort
    const wsEndpoint = browser.wsEndpoint();
    const port = new URL(wsEndpoint).port;

    // Lighthouse configuratie
    const options = {
      logLevel: 'info',
      output: 'json',
      onlyCategories: ['performance'],
      port
    };

    const runnerResult = await lighthouse(url, options);
    const reportJson = runnerResult.report;
    const report = JSON.parse(reportJson);

    // Haal de belangrijkste metrics op
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
