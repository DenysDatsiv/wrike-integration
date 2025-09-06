// pdf.service.js
'use strict';

const puppeteer = require('puppeteer'); // якщо puppeteer-core — додай executablePath
const axios = require('axios');
const { performance } = require('perf_hooks');

/* ======================== Helpers: logging ======================== */
function mkLog(scope = 'PDF') {
    const t0 = performance.now();
    return {
        mark(step, extra) {
            const ms = (performance.now() - t0).toFixed(1);
            const prefix = `[${scope}][+${ms}ms] ${step}`;
            if (extra !== undefined) {
                try {
                    console.log(prefix, typeof extra === 'string' ? extra : JSON.stringify(extra));
                } catch {
                    console.log(prefix, extra);
                }
            } else {
                console.log(prefix);
            }
        },
        err(step, e) {
            const ms = (performance.now() - t0).toFixed(1);
            const prefix = `[${scope}][+${ms}ms] ERROR in ${step}`;
            console.error(prefix, e?.message || e, e?.stack ? `\n${e.stack}` : '');
        }
    };
}

/* ======================== Network reachability ======================== */
async function canReach(url, timeoutMs = 15000) {
    try {
        const r = await axios.get(url, { timeout: timeoutMs, validateStatus: () => true });
        console.log('[REACH]', { status: r.status, url });
        return r.status < 400;
    } catch (e) {
        console.error('[REACH][fail]', { msg: e.message, url });
        return false;
    }
}

/* ======================== Puppeteer launch opts ======================== */
function launchOpts() {
    // Для більшості хостингів (Render/Heroku/Docker) цього достатньо
    const opts = {
        headless: 'new',                     // або true (залежно від версії puppeteer)
        ignoreHTTPSErrors: true,            // на випадок самопідписаних сертифікатів
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',        // не використовувати /dev/shm
            '--no-zygote',
            '--no-first-run',
            '--single-process',               // менше процесів → менше RAM
            '--disable-gpu',
        ],
    };

    // Якщо ти СВІДОМО надаєш шлях до хрому: CHROME_PATH або PUPPETEER_EXECUTABLE_PATH
    const explicitPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
    if (explicitPath) {
        opts.executablePath = explicitPath;
    }

    return opts;
}

/* ======================== Core: generatePdf ======================== */
/**
 * Генерує PDF зі сторінки за URL.
 * @param {string} url - адреса сторінки
 * @param {object} options
 * @param {number} [options.timeoutMs=60000] - таймаут для goto()
 * @param {boolean} [options.forceA4=false] - примусово A4 (без фуллпейдж)
 * @returns {Promise<Buffer>} PDF як Buffer
 */
async function generatePdf(url, options = {}) {
    const {
        timeoutMs = 60_000,
        forceA4 = false,
    } = options;

    const log = mkLog('PDF');
    let browser;

    try {
        // Перевіримо досяжність цілі (дає миттєву відповідь у проді, якщо сайт внутрішній)
        log.mark('reachability:check', { url });
        const reachable = await canReach(url, Math.min(15_000, timeoutMs));
        if (!reachable) {
            throw new Error('Target URL is unreachable from this environment');
        }

        // Запуск браузера
        log.mark('launch:start', { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || '(bundled)' });
        browser = await puppeteer.launch(launchOpts());
        log.mark('launch:ok');

        const page = await browser.newPage();

        // Діагностика на сторінці
        page.on('console', msg => console.log('[PDF][console]', msg.type(), msg.text()));
        page.on('pageerror', err => console.error('[PDF][pageerror]', err.message));
        page.on('requestfailed', req => console.warn('[PDF][req-failed]', req.url(), req.failure()?.errorText));
        page.on('response', res => {
            if (res.status() >= 400) console.warn('[PDF][resp>=400]', res.status(), res.url());
        });

        // В’юпорт
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

        // Перехід на сторінку
        log.mark('goto:start');
        await page.goto(url, {
            waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
            timeout: timeoutMs,
        });
        log.mark('goto:ok');

        // Дочекатися зображень
        log.mark('wait:images:start');
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
        log.mark('wait:images:ok');

        // Дочекатися шрифтів (якщо є)
        try {
            log.mark('wait:fonts:start');
            await page.evaluateHandle('document.fonts && document.fonts.ready');
            log.mark('wait:fonts:ok');
        } catch {
            log.mark('wait:fonts:skip');
        }

        // Якщо треба примусово A4 — робимо одразу
        if (forceA4) {
            log.mark('pdf:A4:start');
            const pdfA4 = await page.pdf({
                printBackground: true,
                format: 'A4',
                margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
            });
            log.mark('pdf:A4:ok', { sizeBytes: pdfA4.length, sizeMB: (pdfA4.length / (1024 * 1024)).toFixed(2) });
            return pdfA4;
        }

        // Обчислити реальний розмір сторінки
        log.mark('size:compute:start');
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
        log.mark('size:compute:ok', { width, height });

        // Chrome обмежує висоту ~108 дюймів. 1in = 96px
        const pxToIn = px => px / 96;
        const pdfWidthIn  = Math.max(1, pxToIn(width));
        const pdfHeightIn = Math.min(Math.max(1, pxToIn(height)), 108);

        // Якщо розміри виглядають підозріло — фолбек на A4
        const invalidSize = !isFinite(pdfWidthIn) || !isFinite(pdfHeightIn) || pdfWidthIn <= 0 || pdfHeightIn <= 0;
        if (invalidSize) {
            log.mark('pdf:fallback:A4:invalid-size', { pdfWidthIn, pdfHeightIn });
            const pdfA4 = await page.pdf({
                printBackground: true,
                format: 'A4',
                margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
            });
            log.mark('pdf:A4:ok', { sizeBytes: pdfA4.length, sizeMB: (pdfA4.length / (1024 * 1024)).toFixed(2) });
            return pdfA4;
        }

        // Генеруємо PDF у розмір сторінки
        log.mark('pdf:fullpage:start', { pdfWidthIn, pdfHeightIn });
        try {
            const pdf = await page.pdf({
                printBackground: true,
                preferCSSPageSize: false,
                width: `${pdfWidthIn}in`,
                height: `${pdfHeightIn}in`,
                margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
            });
            log.mark('pdf:fullpage:ok', { sizeBytes: pdf.length, sizeMB: (pdf.length / (1024 * 1024)).toFixed(2) });
            return pdf;
        } catch (e) {
            // Часто падає на дуже великих висотах → фолбек на A4
            log.err('pdf:fullpage:fail', e);
            log.mark('pdf:fallback:A4:start');
            const pdfA4 = await page.pdf({
                printBackground: true,
                format: 'A4',
                margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
            });
            log.mark('pdf:fallback:A4:ok', { sizeBytes: pdfA4.length, sizeMB: (pdfA4.length / (1024 * 1024)).toFixed(2) });
            return pdfA4;
        }
    } catch (err) {
        log.err('generatePdf', err);
        throw new Error(`Failed to generate PDF: ${err.message}`);
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                log.err('browser.close', e);
            }
        }
    }
}

module.exports = {
    generatePdf,
    canReach,
    launchOpts,
};
