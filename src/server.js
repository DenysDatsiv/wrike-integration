// // src/server.js
// const express = require('express');
// const cors = require('cors');
// const dotenv = require('dotenv');
// const crypto = require('crypto');
//
// dotenv.config();
//
// /** === Імпорт роутерів та утиліт (підлаштуй шляхи під свій проєкт) === */
// const dotcmsRouter = require('./routes/dotcmsRouter');
// const backendRouter = require('./routes/backendRouter');
// const wrikeRoutes = require('./routes/wrikeRoutes');
// const { ensureWebhookRegistered } = require('./shared/utils/wrike-webhook/webhooks.util');
// const {
//     makeDedupeKey,
//     logEvent,
//     getCustomFieldValueById,
//     normalizeExtracted,
//     extractWrikeTaskId,
//     isCommand,
//     stripHtml,
//     hashObject, toPlainError
// } = require("./shared/utils/wrike-webhook/helpers.util");
// const {createSlug, sleep} = require("./shared/utils/wrike-webhook/common.util");
// const {MSG} = require("./shared/constants/wrike-webhook/answers.constant");
// const {validateRequired, buildValidationComment} = require("./validations/wrike.validation");
// const {wrikeApiClient, dotcmsApiClient} = require("./configurations/httpClients");
// const {wrike} = require("./configurations/env.variables");
// const {handleWrikeWebhook} = require("./controllers/wrike/wrike-webhook.controller");
// // const { startLocalTunnel } = require('./shared/utils/wrike-webhook/localtunnel.util'); // опційно
//
// /** === ENV === */
// const {
//     PORT = 3000,
//     LT_ENABLE,
//     PUBLIC_BASE_URL,
//     WEBHOOK_SECRET,
// } = process.env;
//
// /** === App === */
// const app = express();
// app.use(cors());
// app.set('trust proxy', true);
//
// // ПІСЛЯ:
// app.post(
//     '/wrike/webhook',
//     express.raw({ type: '*/*', limit: '5mb' }), // ⬅️ важливо: raw тільки тут
//     handleWrikeWebhook
// );
//
// // Далі глобальні парсери як було:
// app.use((req, res, next) => {
//     return express.json({ limit: '50mb', strict: false })(req, res, next);
// });
//
// /** === Healthcheck === */
// app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
//
// /** === Роути === */
// app.use('/dotcms', dotcmsRouter);
// app.use('/back-end', backendRouter);
// app.use('/wrike', wrikeRoutes);
//
// /** === 404 для інших === */
// app.use((req, res) => {
//     res.status(404).json({ message: 'Not found' });
// });
//
// /** === Глобальний error handler (за бажанням) === */
// app.use((err, _req, res, _next) => {
//     console.error('Unhandled error:', err);
//     res.status(500).json({ message: 'Internal error', details: err?.message || err });
// });
//
// /** === Старт сервера + реєстрація вебхука === */
// app.listen(PORT, async () => {
//     console.log(`✅ Server on http://localhost:${PORT}`);
//     const publicBaseUrl = (PUBLIC_BASE_URL || '').replace(/\/$/, '');
//     console.log(`Public base (env): ${publicBaseUrl || '(not set)'}`);
//     try {
//         await ensureWebhookRegistered(publicBaseUrl);
//         // Якщо ensureWebhookRegistered логерує — ок; інакше можеш тут вивести "Webhook ensured".
//     } catch (e) {
//         console.warn('⚠️ Failed to register webhook:', e?.response?.data || e?.message || e);
//     }
// });
// server.js

const express = require("express");
const cors = require("cors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const axios = require("axios");
const { pipeline } = require("stream");
const { URL } = require("url");

const app = express();
const PORT = process.env.PORT || 3000;

// ==== CONFIG ====
const SUBSCRIPTION_KEY =
    process.env.DFIN_SUBSCRIPTION_KEY ||
    "9fb1445aa3e8420a8837a541b3f16786";

const FUNDS_URL =
    "https://services.dfinsolutions.com/EntityService/entities/customers/usrbcgam/sites/Funds/GLT";

const DOC_BASE =
    "https://services.dfinsolutions.com/documentservice/documents";

// Проксі-агенти (якщо треба)
const httpsAgent = process.env.HTTPS_PROXY
    ? new HttpsProxyAgent(process.env.HTTPS_PROXY)
    : undefined;

const httpAgent = process.env.HTTP_PROXY
    ? new HttpProxyAgent(process.env.HTTP_PROXY)
    : undefined;

// ==== CORS ====
app.use(
    cors({
        origin: "http://localhost:4200",
        methods: ["GET", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
        optionsSuccessStatus: 204,
    })
);

// Якщо хочеш явно обробляти preflight для всіх шляхів
// app.options(/.*/, (req, res) => res.sendStatus(204));

// ==== HELPERS ====

// Переписуємо document.url -> локальний роут
function rewriteDocumentUrls(apiData, origin = `http://localhost:${PORT}`) {
    const tryRewrite = (doc) => {
        try {
            const u = new URL(doc.url);
            const parts = u.pathname.split("/").filter(Boolean);
            const idx = parts.findIndex((p) => p === "documents");
            const cusip = parts[idx + 2];
            const doctype = parts[idx + 4];

            if (cusip && doctype) {
                doc.url = `${origin}/api/dfin/documents/cusip/${encodeURIComponent(
                    cusip
                )}/doctype/${encodeURIComponent(doctype)}`;
            }
        } catch (_) {}
    };

    for (const tg of apiData || []) {
        for (const sg of tg.groups || []) {
            for (const fund of sg.funds || []) {
                for (const sc of fund.shareClasses || []) {
                    for (const doc of sc.documents || []) {
                        tryRewrite(doc);
                    }
                }
            }
        }
    }
    return apiData;
}

// ==== ROUTES ====

// Funds endpoint
app.get("/api/funds", async (req, res) => {
    try {
        const response = await axios.get(FUNDS_URL, {
            params: { "subscription-key": SUBSCRIPTION_KEY },
            proxy: false,
            httpsAgent,
            httpAgent,
            timeout: 30000,
        });

        const rewritten = rewriteDocumentUrls(response.data);
        res.json({ ok: true, data: rewritten });
    } catch (err) {
        console.error("[/api/funds] error:", err?.message);
        res.status(500).json({ ok: false, error: err?.message || "Request failed" });
    }
});

// Proxy documents (FORCE DOWNLOAD)
app.get("/api/dfin/documents/cusip/:cusip/doctype/:doctype", async (req, res) => {
    const { cusip, doctype } = req.params;
    const requestedName = (req.query.filename || "").toString();

    try {
        const targetUrl = `${DOC_BASE}/cusip/${encodeURIComponent(cusip)}/doctype/${encodeURIComponent(doctype)}`;

        const upstream = await axios.get(targetUrl, {
            params: { "subscription-key": SUBSCRIPTION_KEY },
            responseType: "stream",
            proxy: false,
            httpsAgent,
            httpAgent,
            timeout: 60000,
            validateStatus: () => true,
        });

        // Проксі статус
        res.status(upstream.status);

        // Контент-тайп
        const ct = upstream.headers["content-type"] || "application/pdf";
        res.setHeader("Content-Type", ct);

        // ⚠️ Форсуємо завантаження
        // Якщо передали filename в query — використовуємо його
        const safe = (s) =>
            (s || "")
                .replace(/[\r\n"]/g, "")       // прибрати небезпечні символи
                .replace(/[/\\?%*:|<>]/g, "-"); // прибрати недопустимі для назв

        const fallbackName = `document_${cusip}_${doctype}.pdf`;
        const finalName = safe(requestedName) || fallbackName;

        res.setHeader("Content-Disposition", `attachment; filename="${finalName}"`);
        // Додатково можна: res.setHeader("X-Download-Options", "noopen");

        pipeline(upstream.data, res, (e) => {
            if (e) console.error("Stream pipeline error:", e.message);
        });
    } catch (err) {
        console.error("[/api/dfin/documents/*] error:", err?.message);
        res.status(500).json({ ok: false, error: err?.message || "Proxy failed" });
    }
});


app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
