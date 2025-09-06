// pdf.service.js
const puppeteer = require('puppeteer');

function launchOpts() {
    return {
        headless: true, // or 'new' if your Puppeteer supports it
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-zygote',
        ],
        executablePath: process.env.CHROME_PATH || undefined,
    };
}

/**
 * generatePdf(url)
 * Minimal: URL in → PDF Buffer out (full-page size)
 */
async function generatePdf(url) {
    let browser;
    try {
        browser = await puppeteer.launch(launchOpts());
        const page = await browser.newPage();

        // Reasonable desktop viewport
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

        // Load page fully
        await page.goto(url, {
            waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
            timeout: 60_000,
        });

        // Wait for images
        await page.evaluate(async () => {
            const imgs = Array.from(document.querySelectorAll('img'));
            if (!imgs.length) return;
            await Promise.race([
                Promise.allSettled(
                    imgs.map(img => img.complete ? Promise.resolve() : new Promise(res => {
                        img.addEventListener('load', res, { once: true });
                        img.addEventListener('error', res, { once: true });
                    }))
                ),
                new Promise(res => setTimeout(res, 10_000))
            ]);
        });

        // Wait for fonts if supported
        try {
            await page.evaluateHandle('document.fonts && document.fonts.ready');
        } catch { /* ignore */ }

        // Compute full page size
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
            return { width: w, height: h };
        });

        // Chrome caps height at ~108 inches; convert px→in (96 dpi)
        const pxToIn = px => px / 96;
        const pdfWidthIn  = pxToIn(width);
        const pdfHeightIn = Math.min(pxToIn(height), 108);

        // Generate PDF buffer
        const pdf = await page.pdf({
            printBackground: true,
            preferCSSPageSize: false,
            width: `${pdfWidthIn}in`,
            height: `${pdfHeightIn}in`,
            margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
        });

        return pdf;
    } catch (err) {
        throw new Error(`Failed to generate PDF: ${err.message}`);
    } finally {
        if (browser) {
            try { await browser.close(); } catch {}
        }
    }
}

module.exports = { generatePdf };
