// pdf.service.js
'use strict';

const puppeteer = require('puppeteer');

/** Опції запуску Chromium, безпечні для контейнерів */
function launchOpts() {
    const opts = {
        headless: 'new',                 // або true — залежно від версії puppeteer
        ignoreHTTPSErrors: true,         // якщо трапляються самопідписані сертифікати
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--no-first-run',
            '--single-process',
            '--disable-gpu',
        ],
    };
    // Якщо ти явно задаєш шлях до Chromium:
    if (process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH) {
        opts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
    }
    return opts;
}

/**
 * Рендерить PDF зі сторінки за URL.
 * @param {string} url - адреса сторінки
 * @param {object} options
 * @param {number} [options.timeoutMs=60000] - таймаут для goto()
 * @param {boolean} [options.forceA4=false] - примусово робити A4 (без фуллпейдж)
 * @returns {Promise<Buffer>} - PDF як Buffer
 */
async function generatePdf(url, options = {}) {
    const { timeoutMs = 60_000, forceA4 = false } = options;
    if (!url) throw new Error('URL is required');

    let browser;
    try {
        browser = await puppeteer.launch(launchOpts());
        const page = await browser.newPage();

        // корисні події для дебагу (необов’язково залишати на проді)
        page.on('requestfailed', req => console.warn('[PDF][req-failed]', req.url(), req.failure()?.errorText));
        page.on('response', res => { if (res.status() >= 400) console.warn('[PDF][resp>=400]', res.status(), res.url()); });

        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

        await page.goto(url, {
            waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
            timeout: timeoutMs,
        });

        // Дочекатися зображень
        await page.evaluate(async () => {
            const imgs = Array.from(document.querySelectorAll('img'));
            if (!imgs.length) return;
            await Promise.race([
                Promise.allSettled(imgs.map(img => img.complete ? Promise.resolve() : new Promise(res => {
                    img.addEventListener('load', res, { once: true });
                    img.addEventListener('error', res, { once: true });
                }))),
                new Promise(res => setTimeout(res, 10_000))
            ]);
        });

        // Дочекатися шрифтів (якщо підтримується)
        try { await page.evaluateHandle('document.fonts && document.fonts.ready'); } catch {/* ignore */}

        if (forceA4) {
            return await page.pdf({
                printBackground: true,
                format: 'A4',
                margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
            });
        }

        // Порахувати повний розмір сторінки
        const { width, height } = await page.evaluate(() => {
            const el = document.documentElement, body = document.body;
            const w = Math.max(
                el.scrollWidth, el.offsetWidth, el.clientWidth,
                body?.scrollWidth || 0, body?.offsetWidth || 0, body?.clientWidth || 0
            );
            const h = Math.max(
                el.scrollHeight, el.offsetHeight, el.clientHeight,
                body?.scrollHeight || 0, body?.offsetHeight || 0, body?.clientHeight || 0
            );
            return { width: w || 1920, height: h || 1080 };
        });

        // 1in = 96px; Chrome cap ~108 inches по висоті
        const pxToIn = px => px / 96;
        const pdfWidthIn  = Math.max(1, pxToIn(width));
        const pdfHeightIn = Math.min(Math.max(1, pxToIn(height)), 108);

        // Якщо щось не так із розмірами — фолбек на A4
        if (!isFinite(pdfWidthIn) || !isFinite(pdfHeightIn) || pdfWidthIn <= 0 || pdfHeightIn <= 0) {
            return await page.pdf({
                printBackground: true,
                format: 'A4',
                margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
            });
        }

        // Повносторінковий PDF
        try {
            return await page.pdf({
                printBackground: true,
                preferCSSPageSize: false,
                width: `${pdfWidthIn}in`,
                height: `${pdfHeightIn}in`,
                margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
            });
        } catch {
            // інколи дуже високі сторінки ламають pdf() — робимо A4
            return await page.pdf({
                printBackground: true,
                format: 'A4',
                margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
            });
        }
    } finally {
        if (browser) { try { await browser.close(); } catch {} }
    }
}

module.exports = { generatePdf, launchOpts };
