const {
    logEvent,
    toPlainError,
    isCommand,
    stripHtml,
    hashObject,
    makeDedupeKey,
    normalizeExtracted,
    getCustomFieldValueById
} = require( "../../shared/utils/wrike-webhook/helpers.util" );
const {MSG} = require( "../../shared/constants/wrike-webhook/answers.constant" );
const {validateRequired,buildValidationComment} = require( "../../validations/wrike.validation" );
const {wrikeApiClient} = require( "../../configurations/httpClients" );
const {createSlug,hmacSha256,sleep} = require( "../../shared/utils/wrike-webhook/common.util" );
const {createInsight} = require( "../../services/dotcms/dotcms.service" );
const {wrike} = require("../../configurations/env.variables");

const taskState = new Map();
const seen = new Set();
const SEEN_MAX = 500;
const contactsCache = new Map();
const CONTACTS_CACHE_MAX = 500;

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
            META_TITLE:"IEAB3SKBJUAJCDIR"
        };

        const buildExtracted = async ( tid ) => {
            const payload = await safeFetchTask( tid );
            const tk = payload?.data?.[0] || {};
            const cfs = tk.customFields || [];
            const titleFromCF = getCustomFieldValueById( cfs,contentFields.TITLE );
            const summaryFromCF = getCustomFieldValueById( cfs,contentFields.SUMMARY );
            const dateOfPublicationFromCF = getCustomFieldValueById( cfs,contentFields.DATE_OF_PUBLICATION );
            const contentFromCF = getCustomFieldValueById( cfs,contentFields.CONTENT );
            const mediaTypeFromCF = getCustomFieldValueById( cfs,contentFields.MEDIA_TYPE );
            const metaDescriptionFromCF = getCustomFieldValueById( cfs,contentFields.META_DESCRIPTION );
            const metaTitleFromCF = getCustomFieldValueById( cfs,contentFields.META_TITLE );
            return normalizeExtracted( {
                wrikeTicketId:tid,
                title:titleFromCF,
                titleUrlSlug:createSlug( titleFromCF ),
                summary:summaryFromCF,
                dateOfPublication:dateOfPublicationFromCF,
                content:contentFromCF,
                mediaType:(mediaTypeFromCF || ""),
                metaDescription:metaDescriptionFromCF,
                metaTitle:metaTitleFromCF
            } );
        };

        if ( isCommand( comment?.text,"create" ) ){
            const extracted = await buildExtracted( taskId );

            const v = validateRequired( extracted );
            if ( ! v.ok ){
                try{
                    await postComment( taskId,buildValidationComment( v ) );
                }catch ( err ){
                    logEvent( {kind:"warn",where:"postComment(create_validation)",error:err?.message,taskId} );
                }
                continue;
            }

            const nowIso = new Date().toISOString();
            if ( st.skeletonCreated ){
                try{
                    await postComment( taskId,MSG.alreadyCreated( st.skeletonCreatedAt ) );
                }catch ( err ){
                    logEvent( {kind:"warn",where:"postComment(already)",error:err?.message,taskId} );
                }
            }else{
                st.skeletonCreated = true;
                st.skeletonCreatedAt = nowIso;
                try{
                    await createInsight( {body:extracted || {}} );
                    await postComment( taskId,MSG.created );
                }catch ( err ){
                    logEvent( {kind:"warn",where:"postComment(created)",error:err?.message,taskId} );
                }

                st.snapshot = extracted;
                st.lastSnapshotHash = hashObject( extracted );
            }
            continue;
        }

        if ( isCommand( comment?.text,"update" ) ){
            if ( ! st.skeletonCreated ){
                try{
                    await postComment( taskId,MSG.pleaseCreateFirst );
                }catch ( err ){
                    logEvent( {kind:"warn",where:"postComment(update_before_create)",error:err?.message,taskId} );
                }

            }else{
                const extracted = await buildExtracted( taskId );
                const v = validateRequired( extracted );
                if ( ! v.ok ){
                    try{
                        await postComment( taskId,buildValidationComment( v ) );
                    }catch ( err ){
                        logEvent( {kind:"warn",where:"postComment(update_validation)",error:err?.message,taskId} );
                    }
                    logEvent( {kind:"update_validation_failed",...extracted,latestComment:comment,state:{...st}} );
                    continue;
                }
                const isEmptyPayload = ! extracted?.title && ! extracted?.summary && ! extracted?.content && ! extracted?.metaTitle && ! extracted?.metaDescription;

                const nextHash = hashObject( extracted );
                const sameAsBefore = st.lastSnapshotHash && st.lastSnapshotHash === nextHash;

                if ( sameAsBefore || isEmptyPayload ){
                    try{
                        await postComment( taskId,MSG.noChanges( st.lastUpdateAt || st.skeletonCreatedAt ) );
                    }catch ( err ){
                        logEvent( {kind:"warn",where:"postComment(update_no_changes_ack)",error:err?.message,taskId} );
                    }
                    st.lastNoChangesAt = new Date().toISOString();
                }else{
                    try{
                        await postComment( taskId,MSG.updateStarting );
                    }catch ( err ){
                        logEvent( {kind:"warn",where:"postComment(update_notice)",error:err?.message,taskId} );
                    }

                    st.lastUpdateAt = new Date().toISOString();
                    st.snapshot = extracted;
                    st.lastSnapshotHash = nextHash;

                    try{
                        await postComment( taskId,MSG.updated );
                    }catch ( err ){
                        logEvent( {kind:"warn",where:"postComment(update_ack)",error:err?.message,taskId} );
                    }

                }
            }
        }

    }
};

module.exports = {handleWrikeWebhook};
