const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');

const app = express();
app.use(express.json());

// POST /analyze endpoint
app.post('/analyze', async (req, res) => {
  try {
    const { urls } = req.body;

    // Validate that "urls" is an array
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'Body must contain an array "urls"' });
    }

    const results = [];
    for (const url of urls) {
      // Basic URL validation
      if (!url.startsWith('http')) {
        results.push({ url, error: 'Invalid URL format' });
        continue;
      }
      // Analyze each valid URL
      const analysis = await analyzeUrl(url);
      results.push(analysis);
    }

    // Return an array of analysis results
    res.json(results);

  } catch (err) {
    console.error('Error in /analyze endpoint:', err);
    res.status(500).json({ error: err.message });
  }
});

// Puppeteer-based analysis function
async function analyzeUrl(url) {
  let browser;
  // Hardcoded path where Chromium is reportedly downloaded on Render
  const forcedExecPath = '/opt/render/.cache/puppeteer/chrome/linux-1108766/chrome-linux/chrome';

  console.log('Forcing executable path:', forcedExecPath);

  // Check if the forced path exists
  if (!fs.existsSync(forcedExecPath)) {
    console.warn('Chromium executable not found at forced path:', forcedExecPath);
  }

  try {
    // Launch Puppeteer with the forced path
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

    // Example: just grab the <title> of the page
    const title = await page.title();
    return { url, title };

  } catch (error) {
    console.error('Error analyzing URL:', url, error);
    return { url, error: `Could not load the page: ${error.message}` };

  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
