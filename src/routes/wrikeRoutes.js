const express = require( 'express' );
const router = express.Router();
const {generatePdf} = require( '../controllers/wrike/pdf.controller' );
const { uploadFileToWrike,addCommentToWrikeTask,updateWrikeTaskStatus,getWrikeTaskId} = require( '../controllers/wrike/wrike.controller' );
const {extractFileNameFromUrl} = require( "../shared/utils/article-name-extracting" );
const {handleWrikeWebhook} = require( "../controllers/wrike/wrike-webhook.controller" );
const {dotcmsApiClient} = require("../configurations/httpClients");
const ProxyAgent = require('proxy-agent').default;

router.post('/send-for-review', async (req, res) => {
    const { url, taskId, persona } = req.body;

    // --- 1) Basic validation ---
    const errors = [];
    if (!url) errors.push('Missing "url".');
    if (!taskId) errors.push('Missing "taskId".');
    if (!persona) errors.push('Missing "persona".');

    // Перевірка коректності URL
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

    // --- helpers ---
    const withStage = async (stage, fn) => {
        try {
            return await fn();
        } catch (err) {
            // збагачуємо помилку контекстом етапу
            err.__stage = stage;
            throw err;
        }
    };

    const toSafeAxiosData = (data) => {
        // уникаємо повернення величезних або бинарних даних у відповідь
        if (!data) return null;
        if (typeof data === 'string') return data.slice(0, 4000);
        try {
            const s = JSON.stringify(data);
            return s.length > 4000 ? JSON.parse(s.slice(0, 4000)) : data;
        } catch {
            return '[unserializable response data]';
        }
    };

    const extractError = (error) => {
        const isAxios = !!(error?.response || error?.request);
        const statusFromAxios = error?.response?.status;
        const stage = error.__stage || 'unknown';

        const base = {
            ok: false,
            stage,
            message: error?.message || 'Unknown error',
            // Короткий довідник що робити
            hint:
                stage === 'lookupTask'
                    ? 'Check that taskId is a valid Wrike permalink or ID accessible by the token.'
                    : stage === 'generatePdf'
                        ? 'Ensure the page loads on the server (VPN/allowlist), and the modal selector/text are correct.'
                        : stage === 'uploadFile'
                            ? 'Verify Wrike API token/permissions and file size limits.'
                            : 'See details below.',
            details: {
                name: error?.name,
                code: error?.code, // наприклад ECONNRESET, ETIMEDOUT
            },
        };

        if (isAxios) {
            base.details.axios = {
                status: statusFromAxios || null,
                statusText: error?.response?.statusText || null,
                data: toSafeAxiosData(error?.response?.data),
                requestUrl: error?.config?.url || null,
                method: error?.config?.method || null,
                // не повертаємо headers/body
            };
        }

        // Puppeteer / CDP / Chromium hints
        if (error?.stack?.includes('puppeteer')) {
            base.details.puppeteer = {
                note:
                    'Puppeteer/Chromium error. Often caused by missing Chrome binary, sandbox flags, or blocked network.',
            };
        }
        if (error?.stack?.includes('Protocol error')) {
            base.details.chromium = { note: 'Chrome DevTools Protocol error.' };
        }

        return { body: base, status: statusFromAxios || mapStageToStatus(stage, error) };
    };

    const mapStageToStatus = (stage, error) => {
        // Розумні статуси за замовчуванням
        if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') return 504;
        if (stage === 'validation') return 422;
        if (stage === 'lookupTask') return 404;
        if (stage === 'generatePdf') return 502;
        if (stage === 'uploadFile') return 502;
        return 500;
    };

    try {
        // --- 2) Lookup Wrike Task ID (підтримка вводу як permalink або raw id) ---
        const wrikeId = await withStage('lookupTask', async () => {
            return await getWrikeTaskId(taskId);
        });

        // --- 3) Generate PDF ---
        const pdfBuffer = await withStage('generatePdf', async () => {
            return await generatePdf(url, {
                modal: {
                    persona,
                    acceptText: 'Accept to continue',
                    debug: false,
                },
                pdfOptions: { printBackground: true },
            });
        });

        // --- 4) Upload PDF to Wrike ---
        const sanitizedFileName = extractFileNameFromUrl(url);
        const fileName = `${sanitizedFileName}.pdf`;

        // НЕ логимо буфер: console.log(pdfBuffer)  // <- Заборонено (може завалити лог/інстанс)
        await withStage('uploadFile', async () => {
            await uploadFileToWrike(wrikeId, pdfBuffer, fileName);
            // за бажанням:
            // await addCommentToWrikeTask(wrikeId, url, fileName);
        });

        return res.status(200).json({
            ok: true,
            message:
                'PDF generated and uploaded to Wrike successfully.',
            taskId: wrikeId,
            fileName,
        });
    } catch (error) {
        const { body, status } = extractError(error);
        // корисний серверний лог (короткий)
        console.error(
            `[send-for-review][${body.stage}] ${body.message}`,
            body.details?.code || '',
            body.details?.axios?.status || ''
        );
        return res.status(status).json(body);
    }
});


router.post( '/update-status',async ( req,res ) => {
    try{
        console.log(req.body);
        const {taskId,customStatus} = req.body;
        const id =  await getWrikeTaskId(taskId)
        console.log(id)
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


router.post("/webhook", handleWrikeWebhook);

module.exports = router;
