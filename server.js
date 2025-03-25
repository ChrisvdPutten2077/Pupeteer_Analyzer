const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');

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
  try {
    // Define your forced path based on the build logs.
    const forcedExecPath = '/opt/render/.cache/puppeteer/chrome/linux-1108766/chrome-linux/chrome';
    const defaultExecPath = puppeteer.executablePath();

    // Use the forced path if it exists; otherwise, fall back to Puppeteer's default path.
    let finalExecPath = forcedExecPath;
    if (!fs.existsSync(forcedExecPath)) {
      console.warn('Forced executable path not found, falling back to default:', defaultExecPath);
      finalExecPath = defaultExecPath;
    }
    console.log('Using executable path:', finalExecPath);

    browser = await puppeteer.launch({
      headless: true,
      executablePath: finalExecPath,
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
