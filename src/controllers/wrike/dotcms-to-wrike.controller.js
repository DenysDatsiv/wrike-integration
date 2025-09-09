/* eslint-disable no-console */
const { wrikeApiClient } = require('../../configurations/httpClients');

// ---- Tiptap (ProseMirror JSON -> HTML) ----
const { generateHTML } = require('@tiptap/html');
const StarterKit = require('@tiptap/starter-kit').default;

// ---- Custom Field IDs ----
const CONTENT_FIELDS = {
    TITLE: 'IEAB3SKBJUAJBWGI',
    SUMMARY: 'IEAB3SKBJUAJBWGA',
    DATE_OF_PUBLICATION: 'IEAB3SKBJUAJBWFK',
    CONTENT: 'IEAB3SKBJUAI5VKH',
    MEDIA_TYPE: 'IEAB3SKBJUAJBYKR',
    META_DESCRIPTION: 'IEAB3SKBJUAJCDJC',
    META_TITLE: 'IEAB3SKBJUAJCDIR',
    IDENTIFIER: 'IEAB3SKBJUAJGDGR',
    // ⬇️ UPDATED: use this CF id and lowercase "yes"/"no"
    CREATED_FLAG_ALLOW_UPDATE_ONLY: 'IEAB3SKBJUAJHH5S',
};

// ---- Helpers ----
const isPermalinkId = (val) => /^[0-9]+$/.test(String(val || '').trim());
const capitalizeFirst = (s) =>
    typeof s === 'string' && s.length ? s[0].toUpperCase() + s.slice(1) : s;

// ISO/any Date -> dd/MM/yyyy
const formatDateToDDMMYYYY = (val) => {
    if (!val) return val;
    try {
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(val))) return val;
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return val;
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    } catch {
        return val;
    }
};

// normalize to exactly "yes"/"no" (lowercase)
const normalizeYesNo = (v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim().toLowerCase();
    if (v === true || ['yes', 'y', 'true', '1'].includes(s)) return 'yes';
    if (v === false || ['no', 'n', 'false', '0'].includes(s)) return 'no';
    if (s === 'yes' || s === 'no') return s;
    return undefined;
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

    if (payload.dateOfPublication) {
        add(CONTENT_FIELDS.DATE_OF_PUBLICATION, formatDateToDDMMYYYY(payload.dateOfPublication));
    }

    // Plain text only (Wrike custom fields do not render HTML)
    add(CONTENT_FIELDS.CONTENT, payload.content);

    add(CONTENT_FIELDS.MEDIA_TYPE, payload.mediaType);
    add(CONTENT_FIELDS.META_DESCRIPTION, payload.metaDescription);
    add(CONTENT_FIELDS.META_TITLE, payload.metaTitle);
    add(CONTENT_FIELDS.IDENTIFIER, payload.identifier);

    // allowUpdateOnly -> "yes"/"no"
    const allow = normalizeYesNo(payload.allowUpdateOnly);
    add(CONTENT_FIELDS.CREATED_FLAG_ALLOW_UPDATE_ONLY, allow);

    return cf;
}

async function resolveApiTaskId(taskId) {
    const raw = String(taskId).trim();
    if (!isPermalinkId(raw)) return raw; // assume API id

    const permalinkUrl = `https://www.wrike.com/open.htm?id=${encodeURIComponent(raw)}`;
    const searchResp = await wrikeApiClient.get('/tasks', {
        params: { permalink: permalinkUrl },
        headers: { Accept: 'application/json' },
    });
    const found = searchResp.data?.data?.[0];
    if (!found?.id) {
        const err = new Error(`Wrike task with permalink id ${raw} not found or not accessible`);
        err.status = 404;
        err.details = searchResp.data;
        throw err;
    }
    return found.id;
}

/**
 * POST /wrike/dotcms-to-wrike-update
 * Supports:
 *  A) Simple mode: { "taskId": "1743772836" } -> sets CREATED_FLAG_ALLOW_UPDATE_ONLY = "yes"
 *  B) Full update:  taskId + custom fields and/or storyBlock/contentHtml
 */
async function handleDotcmsToWrikeUpdate(req, res) {
    // Log payload safely
    try {
        console.log('[dotcms-to-wrike-update] Incoming payload:\n', JSON.stringify(req.body, null, 2));
    } catch {
        console.log('[dotcms-to-wrike-update] Incoming payload (non-serializable)');
    }

    const { taskId, storyBlock, contentHtml, ...fields } = req.body || {};
    if (!taskId) return res.status(400).json({ error: 'taskId is required' });

    try {
        // 1) Resolve task id
        const apiTaskId = await resolveApiTaskId(taskId);

        // ===== Simple mode: only { taskId } -> set CF to "yes" and return
        const hasAnyOtherKey =
            (storyBlock !== undefined) ||
            (contentHtml !== undefined) ||
            Object.keys(fields).length > 0;

        if (!hasAnyOtherKey) {
            const updateResp = await wrikeApiClient.put(
                `/tasks/${encodeURIComponent(apiTaskId)}`,
                {
                    customFields: [
                        {
                            id: CONTENT_FIELDS.CREATED_FLAG_ALLOW_UPDATE_ONLY,
                            value: 'yes', // ⬅️ UPDATED: lowercase "yes"
                        },
                    ],
                },
                { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
            );
            return res.status(200).json({
                ok: true,
                mode: 'simple',
                taskId: apiTaskId,
                field: CONTENT_FIELDS.CREATED_FLAG_ALLOW_UPDATE_ONLY,
                value: 'yes',
                updated: updateResp.data?.data?.[0] || null,
            });
        }

        // ===== Full update mode
        // 2) Normalize mediaType
        if (fields.mediaType) fields.mediaType = capitalizeFirst(String(fields.mediaType).trim());

        // 3) Build custom fields
        const customFields = buildCustomFields(fields);

        // 4) Build description HTML
        // Priority: explicit contentHtml > convert storyBlock > nothing
        let descriptionHtml = null;
        if (contentHtml) {
            descriptionHtml = String(contentHtml);
        } else if (storyBlock) {
            try {
                const doc = typeof storyBlock === 'string' ? JSON.parse(storyBlock) : storyBlock;
                descriptionHtml = generateHTML(doc, [StarterKit]);
            } catch (convErr) {
                console.warn('[dotcms-to-wrike-update] storyBlock convert error:', convErr?.message || convErr);
            }
        }

        if (!customFields.length && !descriptionHtml) {
            return res.status(400).json({
                ok: false,
                error: 'No valid fields provided for update',
                hint:
                    'Provide at least one custom field (summary, metaTitle, content, mediaType, dateOfPublication, etc.) or storyBlock/contentHtml for description. Or send only {taskId} to set allowUpdateOnly=yes.',
            });
        }

        // 5) Prepare body & update
        const updateBody = {};
        if (customFields.length) updateBody.customFields = customFields;
        if (descriptionHtml) updateBody.description = descriptionHtml;

        const updateResp = await wrikeApiClient.put(
            `/tasks/${encodeURIComponent(apiTaskId)}`,
            updateBody,
            { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
        );

        return res.status(200).json({
            ok: true,
            mode: 'full',
            taskId: apiTaskId,
            updated: updateResp.data?.data?.[0] || null,
        });
    } catch (err) {
        const status = err.status || err.response?.status || 500;
        return res.status(status).json({
            ok: false,
            message: 'Failed to update Wrike ticket',
            error: err.message,
            details: err.details || err.response?.data || null,
        });
    }
}

module.exports = { handleDotcmsToWrikeUpdate };
