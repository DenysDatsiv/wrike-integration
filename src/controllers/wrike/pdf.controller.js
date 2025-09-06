const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function launchOpts() {
    const execPath =
        process.env.PUPPETEER_EXECUTABLE_PATH ||
        (typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : undefined);

    return {
        headless: 'new',
        executablePath: execPath,        // <-- критично на Render
        ignoreHTTPSErrors: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--no-first-run',
            '--single-process',
            '--disable-gpu'
        ]
    };
}

let browser = null;

// Initialize Chromium browser on server startup
async function initBrowser() {
    try {
        console.log('Initializing Chromium browser...');
         browser = await puppeteer.launch(launchOpts());

        console.log('✅ Chromium browser initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize Chromium browser:', error.message);
        console.error('Make sure Chromium is installed on your server!');
        process.exit(1);
    }
}

// Function to generate PDF from URL
async function generatePdf(url, options = {}) {
    if (!browser) {
        throw new Error('Browser not initialized. Make sure Chromium is installed and server is properly started.');
    }

    const page = await browser.newPage();

    try {
        // Set viewport and user agent
        await page.setViewport({
            width: options.width || 1200,
            height: options.height || 800
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        // Navigate to the URL with timeout
        console.log(`📄 Loading page: ${url}`);
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: options.timeout || 30000
        });

        // Wait for additional content to load if specified
        if (options.waitFor) {
            await page.waitForTimeout(options.waitFor);
        }

        // Generate PDF
        const pdfOptions = {
            format: options.format || 'A4',
            printBackground: options.printBackground !== false,
            margin: {
                top: options.marginTop || '1cm',
                right: options.marginRight || '1cm',
                bottom: options.marginBottom || '1cm',
                left: options.marginLeft || '1cm'
            },
            ...options.pdfOptions
        };

        console.log('🔄 Generating PDF...');
        const pdfBuffer = await page.pdf(pdfOptions);
        console.log('✅ PDF generated successfully');

        return pdfBuffer;
    } catch (error) {
        console.error('❌ Error generating PDF:', error.message);
        throw error;
    } finally {
        await page.close();
    }
}
module.exports = {
    generatePdf,
    initBrowser
};
