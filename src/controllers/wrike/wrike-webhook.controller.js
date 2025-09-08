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

/* ============ In-memory state ============ */
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

/* ============ HMAC helper ============ */
function hmacSha256Hex(secret, bufferOrString) {
    return crypto.createHmac('sha256', secret).update(bufferOrString).digest('hex');
}

/* ============ MAIN HANDLER ============ */
async function handleWrikeWebhook(req, res) {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    const xHookSecret = req.get('X-Hook-Secret') || '';
    const bodyStr = rawBody.toString('utf8');
    const isVerification = bodyStr.includes('"WebHook secret verification"');

    // 1) Handshake
    if (isVerification) {
        const resp = hmacSha256Hex(WEBHOOK_SECRET, xHookSecret);
        res.set('X-Hook-Secret', resp);
        return res.sendStatus(200);
    }

    // 2) Підпис подій
    const expected = hmacSha256Hex(WEBHOOK_SECRET, rawBody);
    if (!xHookSecret || xHookSecret !== expected) {
        return res.status(401).send('Invalid signature');
    }

    // 3) JSON
    let batch;
    try {
        const payload = JSON.parse(bodyStr || '[]');
        batch = Array.isArray(payload) ? payload : [payload];
    } catch {
        return res.status(400).send('Bad JSON');
    }

    // 4) Обробку запускаємо у фоні, відповідь — одразу
    Promise.allSettled(batch.map(e => processEvent(e))).catch(() => {});
    return res.sendStatus(200);
}

// === НОВЕ: легка/миттєва частина + важка частина розділені ===
async function processEvent(e) {
    try {
        const key = makeDedupeKey(e);
        if (seen.has(key)) return;
        seen.add(key);
        if (seen.size > SEEN_MAX) Array.from(seen).slice(0, 100).forEach(k => seen.delete(k));

        // Тільки потрібні події
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

        // 💬 1) МИТТЄВА ВІДПОВІДЬ У WRIKE (ACK)
        if (isCreate) {
            // Якщо створювати не можна — скажи це одразу
            const extractedLite = await buildExtractedLite(taskId); // легка версія, без важких викликів
            if (extractedLite?.identifier && extractedLite.allowOnlyUpdate) {
                await safePostComment(taskId, MSG.alreadyCreated);
                st.skeletonCreated = true;
                st.skeletonCreatedAt = st.skeletonCreatedAt || new Date().toISOString();
                return;
            }
            await safePostComment(taskId, '🛠 Creating article… This may take ~a few seconds.');
            // 2) Важка частина — не блокує ACK
            queueMicrotask(() => heavyCreateFlow(taskId, st).catch(err =>
                logEvent({ kind: 'error', where: 'heavyCreateFlow', error: toPlainError(err), taskId })
            ));
            return;
        }

        if (isUpdate) {
            await safePostComment(taskId, MSG.updateStarting); // вже є у твоєму коді, лишаємо тут одразу
            queueMicrotask(() => heavyUpdateFlow(taskId, st).catch(err =>
                logEvent({ kind: 'error', where: 'heavyUpdateFlow', error: toPlainError(err), taskId })
            ));
            return;
        }
    } catch (err) {
        logEvent({ kind: 'error', where: 'processEvent', error: toPlainError(err) });
    }
}

// ЛЕГКИЙ екстракт: 1 швидкий запит замість серії
async function buildExtractedLite(tid) {
    const payload = await safeFetchTask(tid); // в safeFetchTask бажано зменшити tries/delay
    const tk = payload?.data?.[0] || {};
    const cfs = tk.customFields || [];
    const contentFields = { /* ...як у тебе... */ };
    return normalizeExtracted({
        wrikeTicketId: extractWrikeTaskId(tk.permalink),
        identifier: getCustomFieldValueById(cfs, contentFields.IDENTIFIER),
        title: getCustomFieldValueById(cfs, contentFields.TITLE),
        titleUrlSlug: createSlug(getCustomFieldValueById(cfs, contentFields.TITLE)),
        summary: getCustomFieldValueById(cfs, contentFields.SUMMARY),
        dateOfPublication: getCustomFieldValueById(cfs, contentFields.DATE_OF_PUBLICATION),
        content: getCustomFieldValueById(cfs, contentFields.CONTENT),
        mediaType: getCustomFieldValueById(cfs, contentFields.MEDIA_TYPE) || 'read',
        metaDescription: getCustomFieldValueById(cfs, contentFields.META_DESCRIPTION),
        metaTitle: getCustomFieldValueById(cfs, contentFields.META_TITLE),
        allowOnlyUpdate: ['yes', 'y', 'true', '1'].includes(String(getCustomFieldValueById(cfs, contentFields.CREATED_FLAG_ALLOW_UPDATE_ONLY) || '').toLowerCase())
    });
}

// Безпечний пост коментаря (не кидає помилки)
async function safePostComment(taskId, text) {
    try { await postComment(taskId, text); } catch (e) {
        logEvent({ kind: 'warn', where: 'postComment(ack)', error: toPlainError(e), taskId });
    }
}

// Важкий create-flow (було у твоєму коді всередині 'create')
async function heavyCreateFlow(taskId, st) {
    const extracted = await buildExtractedLite(taskId);
    const v = validateRequired(extracted);
    if (!v.ok) return void await safePostComment(taskId, buildValidationComment(v));

    if (!st.skeletonCreated) {
        st.skeletonCreated = true;
        st.skeletonCreatedAt = st.skeletonCreatedAt || new Date().toISOString();
    }

    const dotCMSArticle = await require('../../services/dotcms/dotcms.service')
        .createInsight({ body: extracted || {} });

    const contentFields = { /* ... */ };
    const newIdentifier = dotCMSArticle?.fired?.entity?.identifier;
    if (newIdentifier) {
        await updateTaskCustomField(taskId, contentFields.IDENTIFIER, newIdentifier);
    }
    // Позначити “Created flag”
    await updateTaskCustomField(taskId, contentFields.CREATED_FLAG_ALLOW_UPDATE_ONLY, 'Yes').catch(()=>{});

    st.snapshot = extracted;
    st.lastSnapshotHash = hashObject(extracted);
    await safePostComment(taskId, MSG.created);
}

// Важкий update-flow (було у твоєму 'update')
async function heavyUpdateFlow(taskId, st) {
    const extracted = await buildExtractedLite(taskId);
    if (!extracted?.identifier) return void await safePostComment(taskId, MSG.pleaseCreateFirst);

    const v = validateRequired(extracted);
    if (!v.ok) return void await safePostComment(taskId, buildValidationComment(v));

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

    await updateContentletByIdentifier(extracted.identifier, { ...extracted });
    st.lastUpdateAt = new Date().toISOString();
    st.snapshot = extracted;
    st.lastSnapshotHash = nextHash;
    await safePostComment(taskId, MSG.updated);
}

module.exports = { handleWrikeWebhook };
