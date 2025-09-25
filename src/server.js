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
// server.js

const express = require("express");
const cors = require("cors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const axios = require("axios");
const { pipeline } = require("stream");
const { URL } = require("url");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const archiver = require("archiver");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   CONFIG
========================= */
const SUBSCRIPTION_KEY =
    process.env.DFIN_SUBSCRIPTION_KEY ||
    "9fb1445aa3e8420a8837a541b3f16786"; // <-- override in prod

// Single funds endpoint (GLT site variant)
const FUNDS_URL =
    "https://services.dfinsolutions.com/EntityService/entities/customers/usrbcgam/sites/Funds/GLT";

// Document service base
const DOC_BASE =
    "https://services.dfinsolutions.com/documentservice/documents";

// Optional outbound proxies
const httpsAgent = process.env.HTTPS_PROXY
    ? new HttpsProxyAgent(process.env.HTTPS_PROXY)
    : undefined;
const httpAgent = process.env.HTTP_PROXY
    ? new HttpProxyAgent(process.env.HTTP_PROXY)
    : undefined;

/* =========================
   MIDDLEWARE
========================= */
app.use(express.json());
app.use(
    cors({
        origin: ["http://localhost:4200", process.env.CORS_ORIGIN].filter(Boolean),
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
        optionsSuccessStatus: 204,
    })
);

/* =========================
   SWAGGER (OpenAPI)
========================= */
const swaggerOptions = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "DFIN Proxy API",
            version: "1.2.0",
            description:
                "Proxy API for DFIN services (funds, documents) with health check and batch utilities.",
        },
        servers: [{ url: `http://localhost:${PORT}` }],
        components: {
            schemas: {
                BatchArrayItem: {
                    type: "object",
                    required: ["cusip", "doctype"],
                    properties: {
                        cusip: { type: "string", example: "74933U753" },
                        doctype: {
                            type: "array",
                            items: { type: "string", example: "P" },
                        },
                        filenamePrefix: {
                            type: "string",
                            example: "RBC_Fund",
                        },
                    },
                },
                BatchLinksResultItem: {
                    type: "object",
                    properties: {
                        index: { type: "integer" },
                        ok: { type: "boolean" },
                        cusip: { type: "string" },
                        error: { type: "string", nullable: true },
                        items: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    doctype: { type: "string" },
                                    url: { type: "string" },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
    apis: [__filename],
};
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/* =========================
   HELPERS
========================= */
// Rewrites source document URLs to local proxy URLs
function rewriteDocumentUrls(apiData, origin) {
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

const fetchDfinDocStream = async (cusip, doctype) => {
    const targetUrl = `${DOC_BASE}/cusip/${encodeURIComponent(
        cusip
    )}/doctype/${encodeURIComponent(doctype)}`;
    return axios.get(targetUrl, {
        params: { "subscription-key": SUBSCRIPTION_KEY },
        responseType: "stream",
        proxy: false,
        httpsAgent,
        httpAgent,
        timeout: 60000,
        validateStatus: () => true,
    });
};

const safeName = (s) =>
    (s || "")
        .replace(/[\r\n"]/g, "")
        .replace(/[/\\?%*:|<>]/g, "-");

/* =========================
   ROUTES
========================= */

/**
 * @swagger
 * /api/funds:
 *   get:
 *     summary: Get funds data (GLT) with document URLs rewritten to local proxy
 *     responses:
 *       200:
 *         description: Funds payload with rewritten document URLs
 */
app.get("/api/funds", async (req, res) => {
    try {
        const response = await axios.get(FUNDS_URL, {
            params: { "subscription-key": SUBSCRIPTION_KEY },
            proxy: false,
            httpsAgent,
            httpAgent,
            timeout: 30000,
        });

        const origin =
            process.env.PUBLIC_BASE_URL ||
            `${req.protocol}://${req.get("host") || `localhost:${PORT}`}`;

        const rewritten = rewriteDocumentUrls(response.data, origin);
        res.json({ ok: true, data: rewritten });
    } catch (err) {
        console.error("[/api/funds] error:", err?.message);
        res
            .status(500)
            .json({ ok: false, error: err?.message || "Request failed" });
    }
});

/**
 * @swagger
 * /api/dfin/documents/cusip/{cusip}/doctype/{doctype}:
 *   get:
 *     summary: Proxy a single DFIN document by cusip and doctype (forces download)
 *     parameters:
 *       - in: path
 *         name: cusip
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: doctype
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: filename
 *         required: false
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: PDF stream
 */
app.get(
    "/api/dfin/documents/cusip/:cusip/doctype/:doctype",
    async (req, res) => {
        const { cusip, doctype } = req.params;
        const requestedName = (req.query.filename || "").toString();
        try {
            const upstream = await fetchDfinDocStream(cusip, doctype);

            res.status(upstream.status);
            const ct = upstream.headers["content-type"] || "application/pdf";
            res.setHeader("Content-Type", ct);

            const fallbackName = `document_${cusip}_${doctype}.pdf`;
            const finalName = safeName(requestedName) || fallbackName;

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${finalName}"`
            );

            pipeline(upstream.data, res, (e) => {
                if (e) console.error("Stream pipeline error:", e.message);
            });
        } catch (err) {
            console.error("[/api/dfin/documents/*] error:", err?.message);
            res
                .status(500)
                .json({ ok: false, error: err?.message || "Proxy failed" });
        }
    }
);

/**
 * @swagger
 * /api/dfin/documents/batch/links:
 *   post:
 *     summary: Return local proxy URLs for multiple items (root-level array)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items: { $ref: "#/components/schemas/BatchArrayItem" }
 *           example:
 *             - cusip: "74933U753"
 *               doctype: ["P","SAR"]
 *               filenamePrefix: "RBC_Fund"
 *             - cusip: "74933U754"
 *               doctype: ["P"]
 *     responses:
 *       200:
 *         description: Per-item list of local proxy URLs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 results:
 *                   type: array
 *                   items: { $ref: "#/components/schemas/BatchLinksResultItem" }
 */
app.post("/api/dfin/documents/batch/links", async (req, res) => {
    const body = req.body;
    if (!Array.isArray(body) || body.length === 0) {
        return res.status(400).json({
            ok: false,
            error:
                "Body must be a non-empty array of { cusip, doctype: string[], filenamePrefix? }",
        });
    }

    const origin =
        process.env.PUBLIC_BASE_URL ||
        `${req.protocol}://${req.get("host") || `localhost:${PORT}`}`;

    const results = [];

    for (const [index, item] of body.entries()) {
        const { cusip, doctype } = item || {};
        if (!cusip || !Array.isArray(doctype) || doctype.length === 0) {
            results.push({
                index,
                ok: false,
                cusip: cusip || null,
                error: "Invalid item: require { cusip, doctype: string[] }",
            });
            continue;
        }

        const items = doctype.map((dt) => ({
            doctype: dt,
            url: `${origin}/api/dfin/documents/cusip/${encodeURIComponent(
                cusip
            )}/doctype/${encodeURIComponent(dt)}`,
        }));

        results.push({ index, ok: true, cusip, items });
    }

    res.json({ ok: true, results });
});

/**
 * @swagger
 * /api/dfin/documents/batch/zip:
 *   post:
 *     summary: Download many items (root-level array) as a single ZIP
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items: { $ref: "#/components/schemas/BatchArrayItem" }
 *           example:
 *             - cusip: "74933U753"
 *               doctype: ["P","SAR"]
 *               filenamePrefix: "RBC_Fund"
 *             - cusip: "74933U754"
 *               doctype: ["P"]
 *     responses:
 *       200:
 *         description: ZIP stream containing PDFs. Errors included as *_ERROR.txt entries.
 */
app.post("/api/dfin/documents/batch/zip", async (req, res) => {
  const body = req.body;
  if (!Array.isArray(body) || body.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Body must be a non-empty array of { cusip, doctype: string[], filenamePrefix?, ticker? }",
    });
  }

  const zipName = safeName(`dfin_documents_${Date.now()}.zip`);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
  // allow client to read the filename
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    console.error("ZIP error:", err.message);
    try { res.status(500); } catch {}
    res.end();
  });
  archive.pipe(res);

  for (const item of body) {
    const { cusip, doctype, filenamePrefix, ticker } = item || {};
    if (!cusip || !Array.isArray(doctype) || doctype.length === 0) {
      archive.append(`Invalid item: require { cusip, doctype[] }\n`, {
        name: `INVALID_ITEM_${Date.now()}.txt`,
      });
      continue;
    }

    // <<< Folder by TICKER (fallback to CUSIP if missing) >>>
    const folder = safeName(ticker || cusip);

    for (const dt of doctype) {
      try {
        const upstream = await fetchDfinDocStream(cusip, dt);
        if (upstream.status !== 200) {
          archive.append(
            `Failed to fetch ${cusip}/${dt} (status ${upstream.status})\n`,
            { name: `${folder}/${(ticker || cusip)}_${dt}_ERROR.txt` }
          );
          continue;
        }

        // Filename: <optionalPrefix_><tickerOrCusip>_<doctype>.pdf
        const stem =
          (filenamePrefix ? safeName(filenamePrefix) + "_" : "") +
          safeName(ticker || cusip) +
          `_${dt}`;

        archive.append(upstream.data, { name: `${folder}/${stem}.pdf` });
      } catch (e) {
        archive.append(
          `Exception for ${cusip}/${dt}: ${e?.message || "unknown"}\n`,
          { name: `${folder}/${(ticker || cusip)}_${dt}_EXCEPTION.txt` }
        );
      }
    }
  }

  archive.finalize();
});


<<<<<<< HEAD
=======
/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check - verify subscription key validity
 *     responses:
 *       200: { description: Subscription key valid }
 *       401: { description: Invalid key }
 */
>>>>>>> origin/main
app.get("/api/health", async (req, res) => {
    try {
        const healthUrl =
            "https://services.dfinsolutions.com/EntityService/entities/customers/usrbcgam/sites/Funds";
        const response = await axios.get(healthUrl, {
            params: { "subscription-key": SUBSCRIPTION_KEY },
            proxy: false,
            httpsAgent,
            httpAgent,
            timeout: 15000,
            validateStatus: () => true,
        });

        if (response.status === 200 && response.data) {
            res.json({
                ok: true,
                status: response.status,
                message: "Subscription key is valid",
            });
        } else {
            res.status(response.status).json({
                ok: false,
                status: response.status,
                message: "Subscription key invalid or request failed",
                details: response.data || null,
            });
        }
    } catch (err) {
        console.error("[/api/health] error:", err?.message);
        res
            .status(500)
            .json({ ok: false, error: err?.message || "Health check failed" });
    }
});

/* =========================
   SERVER START
========================= */
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📖 Swagger docs:      http://localhost:${PORT}/api/docs`);
});

