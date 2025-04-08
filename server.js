////////////////////////////////////////////////////////
// server.js
////////////////////////////////////////////////////////
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fetch = require('node-fetch'); // Alleen nodig als je data naar Make wilt sturen

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

// LET OP: de route is /analyze
// Make doet een POST naar /analyze met JSON-body: { "urls": ["https://..."] }
app.post('/analyze', async (req, res) => {
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
    console.error('Error in /analyze endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Deze functie doet de Lighthouse-audit via dynamische import (i.v.m. ESM)
async function runLighthouseAudit(url) {
  let browser;
  try {
    // Start Puppeteer
    const puppeteer = require('puppeteer-extra'); // Als je de extra-plugins gebruikt
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const wsEndpoint = browser.wsEndpoint();
    const port = new URL(wsEndpoint).port;

    // Dynamisch importeren van Lighthouse (ivm. ESM)
    const { default: lighthouse } = await import('lighthouse');

    // Lighthouse-configuratie
    const options = {
      logLevel: 'info',
      output: 'json',
      onlyCategories: ['performance'],
      port
    };

    // Voer Lighthouse uit
    const runnerResult = await lighthouse(url, options);
    const reportJson = runnerResult.report;
    const report = JSON.parse(reportJson);

    // Haal performance metrics op
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

// Poort instellen via process.env.PORT (of 3000 lokaal)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
