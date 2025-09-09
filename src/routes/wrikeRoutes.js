const express = require('express');
const router = express.Router();

const { generatePdf } = require('../controllers/wrike/pdf.controller');
const {
    uploadFileToWrike,
    addCommentToWrikeTask,
    updateWrikeTaskStatus,
    getWrikeTaskId,
} = require('../controllers/wrike/wrike.controller');

const { handleWrikeWebhook } = require('../controllers/wrike/wrike-webhook.controller');
const { handleDotcmsToWrikeUpdate } = require('../controllers/wrike/dotcms-to-wrike.controller');
const { extractFileNameFromUrl } = require('../shared/utils/article-name-extracting');

// ⚠️ На рівні app додаємо app.use(express.json()) — див. server.js

// --- send-for-review ---
router.post('/send-for-review', async (req, res) => {
    const { url, taskId, persona } = req.body;

    const errors = [];
    if (!url) errors.push('Missing "url".');
    if (!taskId) errors.push('Missing "taskId".');
    if (!persona) errors.push('Missing "persona".');
    try { new URL(url); } catch { errors.push('Invalid "url" format.'); }
    if (errors.length) {
        return res.status(422).json({
            ok: false,
            stage: 'validation',
            message: 'Invalid request payload.',
            details: { errors },
            hint: 'Provide valid url, taskId, and persona.',
        });
    }

    const withStage = async (stage, fn) => {
        try { return await fn(); } catch (err) { err.__stage = stage; throw err; }
    };

    const toSafeAxiosData = (data) => {
        if (!data) return null;
        if (typeof data === 'string') return data.slice(0, 4000);
        try {
            const s = JSON.stringify(data);
            return s.length > 4000 ? JSON.parse(s.slice(0, 4000)) : data;
        } catch { return '[unserializable response data]'; }
    };

    const extractError = (error) => {
        const isAxios = !!(error?.response || error?.request);
        const statusFromAxios = error?.response?.status;
        const stage = error.__stage || 'unknown';

        const base = {
            ok: false,
            stage,
            message: error?.message || 'Unknown error',
            hint:
                stage === 'lookupTask' ? 'Check that taskId is a valid Wrike ID/permalink.'
                    : stage === 'generatePdf' ? 'Ensure page loads (VPN/allowlist) та коректний селектор модалки.'
                        : stage === 'uploadFile' ? 'Перевірте токен/права та ліміт розміру файлу у Wrike.'
                            : 'See details below.',
            details: {
                name: error?.name,
                code: error?.code,
            },
        };

        if (isAxios) {
            base.details.axios = {
                status: statusFromAxios || null,
                statusText: error?.response?.statusText || null,
                data: toSafeAxiosData(error?.response?.data),
                requestUrl: error?.config?.url || null,
                method: error?.config?.method || null,
            };
        }
        return { body: base, status: statusFromAxios || 500 };
    };

    const mapStageToStatus = (stage, error) => {
        if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') return 504;
        if (stage === 'validation') return 422;
        if (stage === 'lookupTask') return 404;
        if (stage === 'generatePdf') return 502;
        if (stage === 'uploadFile') return 502;
        return 500;
    };

    try {
        const wrikeId = await withStage('lookupTask', async () => getWrikeTaskId(taskId));

        const pdfBuffer = await withStage('generatePdf', async () => {
            return await generatePdf(url, {
                modal: { persona, acceptText: 'Accept to continue', debug: false },
                pdfOptions: { printBackground: true },
            });
        });

        const sanitizedFileName = extractFileNameFromUrl(url);
        const fileName = `${sanitizedFileName}.pdf`;

        await withStage('uploadFile', async () => {
            await uploadFileToWrike(wrikeId, pdfBuffer, fileName);
            // optionally: await addCommentToWrikeTask(wrikeId, url, fileName);
        });

        return res.status(200).json({
            ok: true,
            message: 'PDF generated and uploaded to Wrike successfully.',
            taskId: wrikeId,
            fileName,
        });
    } catch (error) {
        const { body } = (function () {
            const x = { body: null, status: null };
            const tmp = extractError(error);
            x.body = tmp.body;
            x.status = tmp.status || mapStageToStatus(tmp.body.stage, error);
            return x;
        })();
        console.error(`[send-for-review][${body.stage}] ${body.message}`, body.details?.code || '', body.details?.axios?.status || '');
        return res.status(body.status).json(body);
    }
});

// --- update-status ---
router.post('/update-status', async (req, res) => {
    try {
        const { taskId, customStatus } = req.body;
        const id = await getWrikeTaskId(taskId);
        const data = await updateWrikeTaskStatus(id, customStatus);
        return res.status(200).json({ ok: true, id, customStatus, data });
    } catch (e) {
        const status = e.response?.status || 502;
        return res.status(status).json({
            message: e.message,
            details: e.response?.data || e.details || null,
        });
    }
});

router.post('/dotcms-to-wrike-update', handleDotcmsToWrikeUpdate);


module.exports = router;
