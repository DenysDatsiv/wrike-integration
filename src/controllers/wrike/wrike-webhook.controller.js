// src/controllers/wrike/webhook.controller.js
const crypto = require('crypto');
const {
    logEvent,
    toPlainError,
    isCommand,
    stripHtml,
    hashObject,
    makeDedupeKey,
    normalizeExtracted,
    getCustomFieldValueById,
    extractWrikeTaskId
} = require('../../shared/utils/wrike-webhook/helpers.util');
const { MSG } = require('../../shared/constants/wrike-webhook/answers.constant');
const { validateRequired, buildValidationComment } = require('../../validations/wrike.validation');
const { wrikeApiClient, dotcmsApiClient } = require('../../configurations/httpClients');
const { createSlug, sleep } = require('../../shared/utils/wrike-webhook/common.util');
const { wrike, WEBHOOK_SECRET } = require('../../configurations/env.variables');

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

const taskState = new Map();
const seen = new Set();
const SEEN_MAX = 500;
const contactsCache = new Map();
const CONTACTS_CACHE_MAX = 500;
const isYes = (v) => ['yes', 'y', 'true', '1'].includes(String(v || '').trim().toLowerCase());

const ensureTaskState = (taskId) => {
    if (!taskState.has(taskId)) {
        taskState.set(taskId, {
            createdSeen: false,
            skeletonCreated: false,
            skeletonCreatedAt: null,
            lastUpdateAt: null,
            lastBotReplyAt: null,
            snapshot: null,
            lastSnapshotHash: null,
            lastNoChangesAt: null,
        });
    }
    return taskState.get(taskId);
};

const fetchTaskWithRetry = async (taskId, tries = 3, delayMs = 400) => {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            const { data } = await wrikeApiClient.get(`/tasks/${encodeURIComponent(taskId)}`);
            return data;
        } catch (err) {
            lastErr = err;
            await sleep(delayMs);
        }
    }
    throw lastErr;
};

const safeFetchTask = async (taskId) => {
    try {
        return await fetchTaskWithRetry(taskId, 3, 400);
    } catch (err) {
        return { error: toPlainError(err) };
    }
};

const fetchContactById = async (id) => {
    if (!id) return null;
    if (contactsCache.has(id)) return contactsCache.get(id);
    try {
        const { data } = await wrike.get(`/contacts/${encodeURIComponent(id)}`);
        const c = data?.data?.[0];
        if (c) {
            const normalized = {
                id: c.id,
                firstName: c.firstName,
                lastName: c.lastName,
                name: (c.firstName || c.lastName)
                    ? `${c.firstName || ''} ${c.lastName || ''}`.trim()
                    : (c.name || c.displayName || c.id),
            };
            contactsCache.set(id, normalized);
            if (contactsCache.size > CONTACTS_CACHE_MAX) {
                Array.from(contactsCache.keys()).slice(0, 50).forEach(k => contactsCache.delete(k));
            }
            return normalized;
        }
    } catch {}
    const fallback = { id, name: id };
    contactsCache.set(id, fallback);
    return fallback;
};

const fetchCommentById = async (commentId) => {
    const { data } = await wrike.get(`/comments/${encodeURIComponent(commentId)}`);
    const c = data?.data?.[0];
    if (!c) return null;
    const author = await fetchContactById(c.authorId);
    const full = c.text || '';
    return {
        id: c.id,
        taskId: c.taskId,
        createdDate: c.createdDate,
        authorId: c.authorId,
        authorName: author?.name || c.authorId,
        text: full,
        preview: stripHtml(full).trim(),
    };
};

const postComment = async (taskId, text) => {
    const body = new URLSearchParams();
    body.set('text', text);
    const { data } = await wrike.post(
        `/tasks/${encodeURIComponent(taskId)}/comments`,
        body.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return data?.data?.[0];
};

async function getContentletByIdentifier(identifier) {
    const url = `/api/content/id/${encodeURIComponent(identifier)}`;
    const { data } = await dotcmsApiClient.get(url);
    return data;
}

async function updateContentletByIdentifier(identifier, body) {
    const existing = await getContentletByIdentifier(identifier);
    if (!existing?.contentlets?.length) {
        throw new Error(`Contentlet with identifier ${identifier} not found`);
    }
    const current = existing.contentlets[0];
    const payload = { ...current, ...body, contentType: current.contentType };
    const url = `/api/content/v1/${encodeURIComponent(identifier)}`;
    const { data } = await dotcmsApiClient.put(url, payload);
    return data;
}

async function updateTaskCustomField(taskId, customFieldId, value) {
    try {
        const { data } = await wrike.put(`/tasks/${encodeURIComponent(taskId)}`, {
            customFields: [{ id: customFieldId, value }],
        });
        return { ok: true, data };
    } catch (err) {
        const status = err?.response?.status;
        const payload = err?.response?.data;
        return { ok: false, status, error: err.message, details: payload };
    }
}

function hmacSha256Hex(secret, bufferOrString) {
    return crypto.createHmac('sha256', secret).update(bufferOrString).digest('hex');
}

function safePreview(obj, max = 8000) {
    try {
        const s = JSON.stringify(obj, null, 2);
        return s.length > max ? s.slice(0, max) + '… (truncated)' : s;
    } catch {
        return '[unserializable object]';
    }
}

function pickIdentifierFromDotCMS(resp) {
    return (
        resp?.fired?.entity?.identifier ||
        resp?.entity?.identifier ||
        resp?.content?.identifier ||
        resp?.payload?.identifier ||
        resp?.identifier ||
        null
    );
}

async function handleWrikeWebhook(req, res) {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    const xHookSecret = req.get('X-Hook-Secret') || '';
    const bodyStr = rawBody.toString('utf8');
    const isVerification = bodyStr.includes('"WebHook secret verification"');

    if (isVerification) {
        const resp = hmacSha256Hex(WEBHOOK_SECRET, xHookSecret);
        res.set('X-Hook-Secret', resp);
        return res.sendStatus(200);
    }

    const expected = hmacSha256Hex(WEBHOOK_SECRET, rawBody);
    if (!xHookSecret || xHookSecret !== expected) {
        return res.status(401).send('Invalid signature');
    }

    let batch;
    try {
        const payload = JSON.parse(bodyStr || '[]');
        batch = Array.isArray(payload) ? payload : [payload];
    } catch {
        return res.status(400).send('Bad JSON');
    }

    Promise.allSettled(batch.map(e => processEvent(e))).catch(() => {});
    return res.sendStatus(200);
}

async function processEvent(e) {
    try {
        const key = makeDedupeKey(e);
        if (seen.has(key)) return;
        seen.add(key);
        if (seen.size > SEEN_MAX) Array.from(seen).slice(0, 100).forEach(k => seen.delete(k));

        if (e.eventType === 'TaskCreated' && e.taskId) {
            ensureTaskState(e.taskId).createdSeen = true;
            logEvent({ kind: 'task_created', taskId: e.taskId, event: e });
            return;
        }

        if (e.eventType !== 'CommentAdded' || !e.commentId) return;

        const comment = await fetchCommentById(e.commentId);
        const taskId = e.taskId || comment?.taskId;
        if (!taskId) return;

        const st = ensureTaskState(taskId);
        const text = stripHtml(comment?.text || '');
        const isCreate = isCommand(text, 'create');
        const isUpdate = isCommand(text, 'update');

        if (isCreate) {
            const extractedLite = await buildExtractedLite(taskId);
            if (extractedLite?.identifier && extractedLite.allowOnlyUpdate) {
                await safePostComment(taskId, MSG.alreadyCreated);
                st.skeletonCreated = true;
                st.skeletonCreatedAt = st.skeletonCreatedAt || new Date().toISOString();
                return;
            }
            await safePostComment(taskId, '🛠 Creating article…');
            queueMicrotask(() =>
                heavyCreateFlow(taskId, st).catch(err =>
                    logEvent({ kind: 'error', where: 'heavyCreateFlow', error: toPlainError(err), taskId })
                )
            );
            return;
        }

        if (isUpdate) {
            await safePostComment(taskId, MSG.updateStarting);
            queueMicrotask(() =>
                heavyUpdateFlow(taskId, st).catch(err =>
                    logEvent({ kind: 'error', where: 'heavyUpdateFlow', error: toPlainError(err), taskId })
                )
            );
            return;
        }
    } catch (err) {
        logEvent({ kind: 'error', where: 'processEvent', error: toPlainError(err) });
    }
}

async function buildExtractedLite(tid) {
    const payload = await safeFetchTask(tid);
    const tk = payload?.data?.[0] || {};
    const cfs = tk.customFields || [];

    return normalizeExtracted({
        wrikeTicketId: extractWrikeTaskId(tk.permalink),
        identifier: getCustomFieldValueById(cfs, CONTENT_FIELDS.IDENTIFIER),
        title: getCustomFieldValueById(cfs, CONTENT_FIELDS.TITLE),
        titleUrlSlug: createSlug(getCustomFieldValueById(cfs, CONTENT_FIELDS.TITLE)),
        summary: getCustomFieldValueById(cfs, CONTENT_FIELDS.SUMMARY),
        dateOfPublication: getCustomFieldValueById(cfs, CONTENT_FIELDS.DATE_OF_PUBLICATION),
        content: getCustomFieldValueById(cfs, CONTENT_FIELDS.CONTENT),
        mediaType: getCustomFieldValueById(cfs, CONTENT_FIELDS.MEDIA_TYPE) || 'read',
        metaDescription: getCustomFieldValueById(cfs, CONTENT_FIELDS.META_DESCRIPTION),
        metaTitle: getCustomFieldValueById(cfs, CONTENT_FIELDS.META_TITLE),
        allowOnlyUpdate: isYes(getCustomFieldValueById(cfs, CONTENT_FIELDS.CREATED_FLAG_ALLOW_UPDATE_ONLY)),
    });
}

async function safePostComment(taskId, text) {
    try { await postComment(taskId, text); } catch (e) {
        logEvent({ kind: 'warn', where: 'postComment(ack)', error: toPlainError(e), taskId });
    }
}

async function heavyCreateFlow(taskId, st) {
    const extracted = await buildExtractedLite(taskId);

    const v = validateRequired(extracted);
    if (!v.ok) {
        await safePostComment(taskId, buildValidationComment(v));
        return;
    }

    if (!st.skeletonCreated) {
        st.skeletonCreated = true;
        st.skeletonCreatedAt = st.skeletonCreatedAt || new Date().toISOString();
    }

    let dotCMSArticle;
    try {
        dotCMSArticle = await require('../../services/dotcms/dotcms.service')
            .createInsight({ body: extracted || {} });
        console.log('[dotCMS] createInsight response:', safePreview(dotCMSArticle));
    } catch (err) {
        await safePostComment(taskId, `❌ Failed to create article: ${stripHtml(err?.message || 'Unknown error')}`);
        return;
    }

    const newIdentifier = pickIdentifierFromDotCMS(dotCMSArticle);
    console.log('[dotCMS] extracted identifier:', newIdentifier);

    if (newIdentifier) {
        try {
            await updateTaskCustomField(taskId, CONTENT_FIELDS.IDENTIFIER, newIdentifier);
        } catch (err) {
            console.warn('[Wrike] Failed to set IDENTIFIER CF:', toPlainError(err));
        }
    } else {
        await safePostComment(taskId, '⚠️ Article created in dotCMS but no identifier was returned.');
    }

    try {
        const r = await updateTaskCustomField(taskId, CONTENT_FIELDS.CREATED_FLAG_ALLOW_UPDATE_ONLY, 'Yes');
        if (r?.ok === false) {
            console.warn('[Wrike] Failed to set CREATED_FLAG_ALLOW_UPDATE_ONLY:', r?.error, r?.details || '');
        }
    } catch (err) {
        console.warn('[Wrike] Failed to set CREATED_FLAG_ALLOW_UPDATE_ONLY:', toPlainError(err));
    }

    st.snapshot = extracted;
    st.lastSnapshotHash = hashObject(extracted);
    await safePostComment(taskId, MSG.created);
}

async function heavyUpdateFlow(taskId, st) {
    const extracted = await buildExtractedLite(taskId);

    if (!extracted?.identifier) {
        await safePostComment(taskId, MSG.pleaseCreateFirst);
        return;
    }

    const v = validateRequired(extracted);
    if (!v.ok) {
        await safePostComment(taskId, buildValidationComment(v));
        return;
    }

    const nextHash = hashObject(extracted);
    const sameAsBefore = st.lastSnapshotHash && st.lastSnapshotHash === nextHash;
    const isEmpty =
        !extracted?.title && !extracted?.summary && !extracted?.content &&
        !extracted?.metaTitle && !extracted?.metaDescription;

    if (sameAsBefore || isEmpty) {
        await safePostComment(taskId, MSG.noChanges(st.lastUpdateAt || st.skeletonCreatedAt));
        st.lastNoChangesAt = new Date().toISOString();
        return;
    }

    try {
        await updateContentletByIdentifier(extracted.identifier, { ...extracted });
        st.lastUpdateAt = new Date().toISOString();
        st.snapshot = extracted;
        st.lastSnapshotHash = nextHash;
        await safePostComment(taskId, MSG.updated);
    } catch (err) {
        logEvent({ kind: 'error', where: 'updateContentletByIdentifier', error: err?.response?.data || err?.message, taskId });
        await safePostComment(taskId, `❌ Failed to update article: ${stripHtml(err?.response?.data?.message || err?.message || 'Unknown error')}`);
    }
}

module.exports = { handleWrikeWebhook };
