const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await page.goto('https://remodex-relay.th07290828.workers.dev/app/', { waitUntil: 'networkidle' });
  const result = await page.evaluate(() => ({
    cssHref: Array.from(document.styleSheets).map((sheet) => sheet.href).filter(Boolean),
    statTexts: Array.from(document.querySelectorAll('.deck-stat span')).map((el) => ({ text: el.textContent.trim(), fontSize: getComputedStyle(el).fontSize, letterSpacing: getComputedStyle(el).letterSpacing })),
  }));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
