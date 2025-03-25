const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');

const app = express();
app.use(express.json());

// Debug snippet: list files in the known Puppeteer directory
try {
  const debugPath = '/opt/render/.cache/puppeteer/chrome/linux-1108766';
  const files = fs.readdirSync(debugPath);
  console.log('Files in', debugPath, ':', files);
} catch (err) {
  console.error('Error reading directory:', err);
}

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
    // Force the executable path to the known location
    const forcedExecPath = '/opt/render/.cache/puppeteer/chrome/linux-1108766/chrome-linux/chrome';
    console.log('Forcing executable path:', forcedExecPath);

    if (!fs.existsSync(forcedExecPath)) {
      console.warn('Chromium binary not found at forced path:', forcedExecPath);
    }

    browser = await puppeteer.launch({
      headless: true,
      executablePath: forcedExecPath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const title = await page.title();
    return { url, title };
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
