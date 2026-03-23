const http = require('http');
const { serveWebClientRequest } = require('./src/web-client-static.js');
const { chromium } = require('playwright-core');
(async () => {
  const server = http.createServer((req, res) => {
    if (serveWebClientRequest(req, res)) return;
    res.statusCode = 404; res.end('not found');
  });
  await new Promise((resolve) => server.listen(9015, '127.0.0.1', resolve));
  try {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    const page = await browser.newPage({ viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await page.goto('http://127.0.0.1:9015/app/', { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'D:/my/remodex-windows-fix/artifacts/narrow-home.png' });
    const stats = await page.evaluate(() => Array.from(document.querySelectorAll('.deck-stat span')).map((el) => ({ text: el.textContent.trim(), rect: el.getBoundingClientRect(), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })));
    console.log(JSON.stringify(stats, null, 2));
    await browser.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})();
