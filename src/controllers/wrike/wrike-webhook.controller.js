const {
    logEvent,
    toPlainError,
    isCommand,
    stripHtml,
    hashObject,
    makeDedupeKey,
    normalizeExtracted,
    getCustomFieldValueById, extractWrikeTaskId
} = require( "../../shared/utils/wrike-webhook/helpers.util" );
const {MSG} = require( "../../shared/constants/wrike-webhook/answers.constant" );
const {validateRequired,buildValidationComment} = require( "../../validations/wrike.validation" );
const {wrikeApiClient, dotcmsApiClient} = require( "../../configurations/httpClients" );
const {createSlug,hmacSha256,sleep} = require( "../../shared/utils/wrike-webhook/common.util" );
const {createInsight} = require( "../../services/dotcms/dotcms.service" );
const {wrike} = require("../../configurations/env.variables");

const taskState = new Map();
const seen = new Set();
const SEEN_MAX = 500;
const contactsCache = new Map();
const CONTACTS_CACHE_MAX = 500;
const isYes = (v) => ["yes","y","true","1"].includes(String(v || "").trim().toLowerCase());

const ensureTaskState = ( taskId ) => {
    if ( ! taskState.has( taskId ) ){
        taskState.set( taskId,{
            createdSeen:false,
            skeletonCreated:false,
            skeletonCreatedAt:null,
            lastUpdateAt:null,
            lastBotReplyAt:null,
            snapshot:null,
            lastSnapshotHash:null,
            lastNoChangesAt:null,
        } );
    }
    return taskState.get( taskId );
};

const fetchTaskWithRetry = async ( taskId,tries = 3,delayMs = 400 ) => {
    let lastErr;
    for ( let i = 0; i < tries; i ++ ){
        try{
            const {data} = await wrikeApiClient.get( `/tasks/${encodeURIComponent( taskId )}` );
            return data;
        }catch ( err ){
            lastErr = err;
            await sleep( delayMs );
        }
    }
    throw lastErr;
};

const fetchContactById = async ( id ) => {
    if ( ! id ) return null;
    if ( contactsCache.has( id ) ) return contactsCache.get( id );
    try{
        const {data} = await wrike.get( `/contacts/${encodeURIComponent( id )}` );
        const c = data?.data?.[0];
        if ( c ){
            const normalized = {
                id:c.id,
                firstName:c.firstName,
                lastName:c.lastName,
                name:(c.firstName || c.lastName) ? `${c.firstName || ""} ${c.lastName || ""}`.trim() : (c.name || c.displayName || c.id)
            };
            contactsCache.set( id,normalized );
            if ( contactsCache.size > CONTACTS_CACHE_MAX ){
                Array.from( contactsCache.keys() ).slice( 0,50 ).forEach( k => contactsCache.delete( k ) );
            }
            return normalized;
        }
    }catch{
    }
    const fallback = {id,name:id};
    contactsCache.set( id,fallback );
    return fallback;
};

const fetchCommentById = async ( commentId ) => {
    const {data} = await wrike.get( `/comments/${encodeURIComponent( commentId )}` );
    const c = data?.data?.[0];
    if ( ! c ) return null;
    const author = await fetchContactById( c.authorId );
    const full = c.text || "";
    return {
        id:c.id,
        taskId:c.taskId,
        createdDate:c.createdDate,
        authorId:c.authorId,
        authorName:author?.name || c.authorId,
        text:full,
        preview:stripHtml( full ).trim()
    };
};
async function getContentletByIdentifier(identifier) {
    const url = `/api/content/id/${encodeURIComponent(identifier)}`;
    const { data } = await dotcmsApiClient.get(url);
    return data;
}

/**
 * Update contentlet by identifier
 */
async function updateContentletByIdentifier(identifier, body) {
    // 1. Отримати існуючі дані
    const existing = await getContentletByIdentifier(identifier);

    if (!existing?.contentlets?.length) {
        throw new Error(`Contentlet with identifier ${identifier} not found`);
    }

    const current = existing.contentlets[0];

    // 2. Змерджити з новими даними
    const payload = {
        ...current,
        ...body,
        contentType: current.contentType
    };
    console.log(payload)

    // 3. Відправити апдейт
    const url = `/api/content/v1/${encodeURIComponent(identifier)}`;
    const { data } = await dotcmsApiClient.put(url, payload);

    return data;
}

const postComment = async ( taskId,text ) => {
    const body = new URLSearchParams();
    body.set( "text",text );
    const {data} = await wrike.post( `/tasks/${encodeURIComponent( taskId )}/comments`,body.toString(),{headers:{"Content-Type":"application/x-www-form-urlencoded"}} );
    return data?.data?.[0];
};

const safeFetchTask = async ( taskId ) => {
    try{
        return await fetchTaskWithRetry( taskId,3,400 );
    }catch ( err ){
        return {error:toPlainError( err )};
    }
};

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

const handleWrikeWebhook = async ( req,res ) => {
    const xHookSecretHeader = req.get( "X-Hook-Secret" ) || "";
    if ( req.body && req.body.requestType === "WebHook secret verification" ){
        const responseHeader = hmacSha256( process.env.WEBHOOK_SECRET,xHookSecretHeader );
        res.set( "X-Hook-Secret",responseHeader );
        return res.sendStatus( 200 );
    }

    const signatureHeader = req.get( "X-Hook-Signature" ) || req.get( "X-Hook-Secret" ) || "";
    const expectedSig = hmacSha256( process.env.WEBHOOK_SECRET,req.rawBody || Buffer.from( "" ) );
    if ( ! signatureHeader || signatureHeader !== expectedSig ) return res.status( 401 ).send( "Bad signature" );

    const batch = Array.isArray( req.body ) ? req.body : [req.body];
    res.sendStatus( 202 );

    for ( const e of batch ){
        const key = makeDedupeKey( e );
        if ( seen.has( key ) ) continue;
        seen.add( key );
        if ( seen.size > SEEN_MAX ) Array.from( seen ).slice( 0,100 ).forEach( k => seen.delete( k ) );

        if ( e.eventType === "TaskCreated" && e.taskId ){
            const st = ensureTaskState( e.taskId );
            st.createdSeen = true;
            logEvent( {kind:"task_created",taskId:e.taskId,event:e} );
            continue;
        }

        if ( e.eventType !== "CommentAdded" || ! e.commentId ) continue;

        let comment;
        try{
            comment = await fetchCommentById( e.commentId );
        }catch ( err ){
            logEvent( {kind:"error",where:"fetchCommentById",error:err?.response?.data || err?.message,event:e} );
            continue;
        }
        const taskId = e.taskId || comment?.taskId;
        if ( ! taskId ) continue;

        const st = ensureTaskState( taskId );

        const contentFields = {
            TITLE:"IEAB3SKBJUAJBWGI",
            SUMMARY:"IEAB3SKBJUAJBWGA",
            DATE_OF_PUBLICATION:"IEAB3SKBJUAJBWFK",
            CONTENT:"IEAB3SKBJUAI5VKH",
            MEDIA_TYPE:"IEAB3SKBJUAJBYKR",
            META_DESCRIPTION:"IEAB3SKBJUAJCDJC",
            META_TITLE:"IEAB3SKBJUAJCDIR",
            IDENTIFIER:"IEAB3SKBJUAJGDGR",
            CREATED_FLAG_ALLOW_UPDATE_ONLY: "IEAB3SKBJUAJGE6G",

        };

        const buildExtracted = async (tid) => {
            const payload = await safeFetchTask(tid);
            const tk = payload?.data?.[0] || {};
            const cfs = tk.customFields || [];

            const identifierFromCF = getCustomFieldValueById(cfs, contentFields.IDENTIFIER);
            const createdFlagFromCF = getCustomFieldValueById(cfs, contentFields.CREATED_FLAG_ALLOW_UPDATE_ONLY);

            const titleFromCF = getCustomFieldValueById(cfs, contentFields.TITLE);
            const summaryFromCF = getCustomFieldValueById(cfs, contentFields.SUMMARY);
            const dateOfPublicationFromCF = getCustomFieldValueById(cfs, contentFields.DATE_OF_PUBLICATION);
            const contentFromCF = getCustomFieldValueById(cfs, contentFields.CONTENT);
            const mediaTypeFromCF = getCustomFieldValueById(cfs, contentFields.MEDIA_TYPE);
            const metaDescriptionFromCF = getCustomFieldValueById(cfs, contentFields.META_DESCRIPTION);
            const metaTitleFromCF = getCustomFieldValueById(cfs, contentFields.META_TITLE);

            return normalizeExtracted({
                wrikeTicketId: extractWrikeTaskId(tk.permalink),
                identifier: identifierFromCF,
                title: titleFromCF,
                titleUrlSlug: createSlug(titleFromCF),
                summary: summaryFromCF,
                dateOfPublication: dateOfPublicationFromCF,
                content: contentFromCF,
                mediaType: (mediaTypeFromCF || "read"),
                metaDescription: metaDescriptionFromCF,
                metaTitle: metaTitleFromCF,

                allowOnlyUpdate: !!(isYes(createdFlagFromCF)),
            });
        };

        // ...всередині handleWrikeWebhook, у гілці "create"
        if (isCommand(comment?.text, "create")) {
            const extracted = await buildExtracted(taskId);

            // БЛОКУЄМО створення, якщо є прапорець (ваша логіка вже є)
            if (extracted?.identifier && extracted.allowOnlyUpdate) {
                if (!st.skeletonCreated) {
                    st.skeletonCreated = true;
                    st.skeletonCreatedAt = st.skeletonCreatedAt || new Date().toISOString();
                }
                try {
                    await postComment(taskId, MSG.alreadyCreated); // або MSG.alreadyCreated(st.skeletonCreatedAt)
                } catch (err) {
                    logEvent({ kind: "warn", where: "postComment(create_blocked)", error: err?.message, taskId });
                }
                continue;
            }

            // Стандартна валідація
            const v = validateRequired(extracted);
            if (!v.ok) {
                try { await postComment(taskId, buildValidationComment(v)); } catch {}
                continue;
            }

            // ✅ СТВОРЕННЯ ДОЗВОЛЕНО
            const nowIso = new Date().toISOString();
            if (st.skeletonCreated) {
                try { await postComment(taskId, MSG.alreadyCreated(st.skeletonCreatedAt)); } catch {}
            } else {
                st.skeletonCreated = true;
                st.skeletonCreatedAt = nowIso;
                try {
                    const dotCMSArticle = await createInsight({ body: extracted || {} });

                    // 1) Проставляємо Identifier у Wrike (як і було)
                    const newIdentifier = dotCMSArticle?.fired?.entity?.identifier;
                    if (newIdentifier) {
                        await updateTaskCustomField(taskId, contentFields.IDENTIFIER, newIdentifier);
                    }

                    // 2) НОВЕ: Виставляємо прапорець "CREATED_FLAG_ALLOW_UPDATE_ONLY" = "Yes"
                    //    Навіть якщо користувач випадково залишить "No" — ми зафіксуємо, що стаття вже створена.
                    try {
                        await updateTaskCustomField(
                            taskId,
                            contentFields.CREATED_FLAG_ALLOW_UPDATE_ONLY,
                            "Yes" // isYes("Yes") -> true
                        );
                    } catch (errSetFlag) {
                        logEvent({
                            kind: "warn",
                            where: "updateTaskCustomField(CREATED_FLAG_ALLOW_UPDATE_ONLY)",
                            error: errSetFlag?.message,
                            taskId
                        });
                    }

                    await postComment(taskId, MSG.created);
                } catch (err) {
                    logEvent({ kind:"warn", where:"postComment(created)", error: err?.message, taskId });
                }
                st.snapshot = extracted;
                st.lastSnapshotHash = hashObject(extracted);
            }
            continue;
        }



                if (isCommand(comment?.text, "update")) {
                    // 1) Завжди спершу читаємо дані з задачі
                    const extracted = await buildExtracted(taskId);

                    // 2) Якщо немає identifier — блокуємо оновлення і просимо додати
                    if (!extracted?.identifier) {
                        try {
                            await postComment(
                                taskId,
                                MSG.pleaseCreateFirst
                            );
                        } catch (err) {
                            logEvent({ kind: "warn", where: "postComment(no_identifier)", error: err?.message, taskId });
                        }
                        return;
                    }

                    // 3) Якщо identifier є — дозволяємо оновлення навіть якщо локально не було skeletonCreated
                    if (!st.skeletonCreated) {
                        st.skeletonCreated = true;
                        st.skeletonCreatedAt = st.skeletonCreatedAt || new Date().toISOString();
                    }

                    // 4) Стандартна валідація полів
                    const v = validateRequired(extracted);
                    if (!v.ok) {
                        try { await postComment(taskId, buildValidationComment(v)); } catch (err) {
                            logEvent({ kind: "warn", where: "postComment(update_validation)", error: err?.message, taskId });
                        }
                        logEvent({ kind: "update_validation_failed", ...extracted, latestComment: comment, state: { ...st } });
                        return;
                    }

                    // 5) Перевірка на відсутність змін/порожній payload
                    const nextHash = hashObject(extracted);
                    const sameAsBefore = st.lastSnapshotHash && st.lastSnapshotHash === nextHash;
                    const isEmptyPayload =
                        !extracted?.title && !extracted?.summary && !extracted?.content &&
                        !extracted?.metaTitle && !extracted?.metaDescription;

                    if (sameAsBefore || isEmptyPayload) {
                        try { await postComment(taskId, MSG.noChanges(st.lastUpdateAt || st.skeletonCreatedAt)); } catch (err) {
                            logEvent({ kind: "warn", where: "postComment(update_no_changes_ack)", error: err?.message, taskId });
                        }
                        st.lastNoChangesAt = new Date().toISOString();
                        return;
                    }

                    // 6) Оновлення контентлету
                    try {
                        await postComment(taskId, MSG.updateStarting);
                        await updateContentletByIdentifier(extracted.identifier, { ...extracted });
                        st.lastUpdateAt = new Date().toISOString();
                        st.snapshot = extracted;
                        st.lastSnapshotHash = nextHash;
                        await postComment(taskId, MSG.updated);
                    } catch (err) {
                        logEvent({ kind: "error", where: "updateContentletByIdentifier", error: err?.response?.data || err?.message, taskId });
                        try {
                            await postComment(
                                taskId,
                                `❌ Не вдалося оновити статтю: ${stripHtml(err?.response?.data?.message || err?.message || "Unknown error")}`
                            );
                        } catch (e2) {
                            logEvent({ kind: "warn", where: "postComment(update_error)", error: e2?.message, taskId });
                        }
                    }
                }


            }
};

module.exports = {handleWrikeWebhook};
