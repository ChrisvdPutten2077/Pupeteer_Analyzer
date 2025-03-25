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
    browser = await puppeteer.launch({
      // If you want to try the new headless mode, use headless: 'new'
      // headless: 'new',
      headless: true,
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
    // Ensure the browser is closed even if there's an error
    if (browser) {
      await browser.close();
    }
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
