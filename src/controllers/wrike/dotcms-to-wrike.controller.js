const { wrikeApiClient } = require('../../configurations/httpClients');

const CONTENT_FIELDS = {
    TITLE: 'IEAB3SKBJUAJBWGI',
    SUMMARY: 'IEAB3SKBJUAJBWGA',
    DATE_OF_PUBLICATION: 'IEAB3SKBJUAJBWFK',
    CONTENT: 'IEAB3SKBJUAI5VKH',
    MEDIA_TYPE: 'IEAB3SKBJUAJBYKR',
    META_DESCRIPTION: 'IEAB3SKBJUAJCDJC',
    META_TITLE: 'IEAB3SKBJUAJCDIR',
    IDENTIFIER: 'IEAB3SKBJUAJGDGR',
    CREATED_FLAG_ALLOW_UPDATE_ONLY: 'IEAB3SKBJUAJGE6G',
};

function buildCustomFields(payload = {}) {
    const cf = [];
    const add = (id, val) => {
        if (val !== undefined && val !== null && val !== '') {
            cf.push({ id, value: val });
        }
    };
    add(CONTENT_FIELDS.TITLE, payload.titleCF);
    add(CONTENT_FIELDS.SUMMARY, payload.summary);
    add(CONTENT_FIELDS.DATE_OF_PUBLICATION, payload.dateOfPublication);
    add(CONTENT_FIELDS.CONTENT, payload.content);
    add(CONTENT_FIELDS.MEDIA_TYPE, payload.mediaType);
    add(CONTENT_FIELDS.META_DESCRIPTION, payload.metaDescription);
    add(CONTENT_FIELDS.META_TITLE, payload.metaTitle);
    add(CONTENT_FIELDS.IDENTIFIER, payload.identifier);
    add(
        CONTENT_FIELDS.CREATED_FLAG_ALLOW_UPDATE_ONLY,
        payload.allowUpdateOnly === true ? 'true'
            : payload.allowUpdateOnly === false ? 'false'
                : undefined
    );
    return cf;
}

// простий детектор: тільки цифри => це короткий permalink id
const isPermalinkId = (val) => /^[0-9]+$/.test(String(val).trim());

async function handleDotcmsToWrikeUpdate(req, res) {
    const { taskId, ...fields } = req.body || {};
    if (!taskId) return res.status(400).json({ error: 'taskId is required' });

    try {
        const raw = String(taskId).trim();

        // 1) Отримуємо API task id
        let apiTaskId = raw;

        if (isPermalinkId(raw)) {
            // резолвимо по permalink
            const permalinkUrl = `https://www.wrike.com/open.htm?id=${encodeURIComponent(raw)}`;
            const searchResp = await wrikeApiClient.get('/tasks', {
                params: { permalink: permalinkUrl },
                headers: { Accept: 'application/json' },
            });

            const found = searchResp.data?.data?.[0];
            if (!found?.id) {
                return res.status(404).json({
                    ok: false,
                    message: `Wrike task with permalink id ${raw} not found`,
                    hint: 'Перевірте правильність короткого ID та доступи токена.',
                    wrike: searchResp.data,
                });
            }
            apiTaskId = found.id;
        } else {
            // опційно: перевіряємо, що API id існує/доступний
            try {
                await wrikeApiClient.get(`/tasks/${encodeURIComponent(apiTaskId)}`, {
                    headers: { Accept: 'application/json' },
                });
            } catch (e) {
                const st = e.response?.status;
                if (st === 404) {
                    return res.status(404).json({
                        ok: false,
                        message: `Wrike task ${apiTaskId} not found or not accessible`,
                        hint: 'Можливо, це не API id. Якщо у вас короткий numeric id — передавайте його як permalink id.',
                        wrike: e.response?.data,
                    });
                }
                throw e;
            }
        }

        // 2) Будуємо customFields
        const customFields = buildCustomFields(fields);
        if (!customFields.length) {
            return res.status(400).json({
                ok: false,
                error: 'No valid fields provided for update',
                hint: 'Передайте хоча б одне: summary, metaTitle, metaDescription, titleCF, content, mediaType, dateOfPublication, identifier, allowUpdateOnly',
            });
        }

        // 3) Оновлюємо задачу уже за API id
        const updateResp = await wrikeApiClient.put(
            `/tasks/${encodeURIComponent(apiTaskId)}`,
            { customFields },
            { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
        );

        return res.status(200).json({
            ok: true,
            taskId: apiTaskId,
            updated: updateResp.data?.data?.[0] || null,
        });
    } catch (err) {
        const status = err.response?.status || 500;
        return res.status(status).json({
            ok: false,
            message: 'Failed to update Wrike ticket',
            error: err.message,
            wrike: err.response?.data,
        });
    }
}

module.exports = { handleDotcmsToWrikeUpdate };
