// src/server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

/** === Імпорт роутерів та утиліт (підлаштуй шляхи під свій проєкт) === */
const dotcmsRouter = require('./routes/dotcmsRouter');
const backendRouter = require('./routes/backendRouter');
const wrikeRoutes = require('./routes/wrikeRoutes');
const { ensureWebhookRegistered } = require('./shared/utils/wrike-webhook/webhooks.util');
const {
    makeDedupeKey,
    logEvent,
    getCustomFieldValueById,
    normalizeExtracted,
    extractWrikeTaskId,
    isCommand,
    stripHtml,
    hashObject, toPlainError
} = require("./shared/utils/wrike-webhook/helpers.util");
const {createSlug, sleep} = require("./shared/utils/wrike-webhook/common.util");
const {MSG} = require("./shared/constants/wrike-webhook/answers.constant");
const {validateRequired, buildValidationComment} = require("./validations/wrike.validation");
const {wrikeApiClient, dotcmsApiClient} = require("./configurations/httpClients");
const {wrike} = require("./configurations/env.variables");
const {handleWrikeWebhook} = require("./controllers/wrike/wrike-webhook.controller");
// const { startLocalTunnel } = require('./shared/utils/wrike-webhook/localtunnel.util'); // опційно

/** === ENV === */
const {
    PORT = 3000,
    LT_ENABLE,
    PUBLIC_BASE_URL,
    WEBHOOK_SECRET,
} = process.env;

/** === App === */
const app = express();
app.use(cors());
app.set('trust proxy', true);

app.post('/wrike/webhook', express.raw({ type: '*/*', limit: '5mb' }), handleWrikeWebhook);

app.use((req, res, next) => {
    if (req.path === '/wrike/webhook') return next(); // пропустити raw-маршрут
    return express.json({ limit: '50mb', strict: false })(req, res, next);
});

/** === Healthcheck === */
app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

/** === Роути === */
app.use('/dotcms', dotcmsRouter);
app.use('/back-end', backendRouter);
app.use('/wrike', wrikeRoutes);

/** === 404 для інших === */
app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});

/** === Глобальний error handler (за бажанням) === */
app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal error', details: err?.message || err });
});

/** === Старт сервера + реєстрація вебхука === */
app.listen(PORT, async () => {
    console.log(`✅ Server on http://localhost:${PORT}`);
    const publicBaseUrl = (PUBLIC_BASE_URL || '').replace(/\/$/, '');
    console.log(`Public base (env): ${publicBaseUrl || '(not set)'}`);
    try {
        await ensureWebhookRegistered(publicBaseUrl);
        // Якщо ensureWebhookRegistered логерує — ок; інакше можеш тут вивести "Webhook ensured".
    } catch (e) {
        console.warn('⚠️ Failed to register webhook:', e?.response?.data || e?.message || e);
    }
});
