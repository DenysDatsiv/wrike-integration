const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const dotcmsRouter = require('./routes/dotcmsRouter');
const backendRouter = require('./routes/backendRouter');
const wrikeRoutes = require('./routes/wrikeRoutes');

const { ensureWebhookRegistered } = require('./shared/utils/wrike-webhook/webhooks.util');
// const { startLocalTunnel } = require('./shared/utils/wrike-webhook/localtunnel.util'); // лише локально

const { PORT = 3000 } = process.env;

const app = express();

app.use(cors());
app.set('trust proxy', true);

/** ✅ Глобальні парсери з лімітами */
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/** ✅ raw body лише для вебхука (приклад) */
// app.post('/wrike/webhook', express.raw({ type: 'application/json', limit: '5mb' }), wrikeWebhookHandler);

/** ✅ Роути */
app.use('/dotcms', dotcmsRouter);
app.use('/back-end', backendRouter);
app.use('/wrike', wrikeRoutes);

/** ✅ Health/Ping */
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/wrike/ping', async (_req, res) => {
    const axios = require('axios');
    try {
        const r = await axios.get('https://www.wrike.com/api/v4/version', {
            headers: { Authorization: `Bearer ${process.env.WRIKE_TOKEN || ''}` },
            timeout: 8000,
        });
        res.json({ ok: true, version: r.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({
            ok: false,
            details: e.response?.data || e.message,
        });
    }
});

app.listen(PORT, async () => {
    console.log(`✅ Server on http://localhost:${PORT}`);

    // ✅ Безпечна ініціалізація PUBLIC_BASE_URL
    const publicBaseUrl =
        (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
    console.log(`Public base: ${publicBaseUrl || '(not set)'}`);
    console.log(`Has WRIKE_TOKEN: ${!!process.env.WRIKE_TOKEN}`);

    try {
        if (publicBaseUrl) {
            await ensureWebhookRegistered(publicBaseUrl);
            console.log('Wrike webhook OK');
        } else {
            console.warn('⚠️ PUBLIC_BASE_URL/RENDER_EXTERNAL_URL не задано — пропускаю реєстрацію вебхука');
        }
    } catch (e) {
        console.warn('⚠️ ensureWebhookRegistered failed:', e?.response?.data || e?.message || e);
    }
});
