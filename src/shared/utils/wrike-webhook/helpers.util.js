const crypto = require( "crypto" );
const {COMMAND_PATTERNS} = require( "../../constants/wrike-webhook/commands.constant" );

const logEvent = ( payload ) => {
    const record = {at:new Date().toISOString(),...payload};
    console.log( record );
};

const toPlainError = ( err ) => {
    if ( ! err ) return "";
    if ( typeof err === "string" ) return err;
    if ( err instanceof Error && err.message ) return err.message;
    const status = err?.status ?? err?.response?.status;
    const data = err?.data ?? err?.response?.data;
    return `${status || ""} ${JSON.stringify( data )}`;
};

const stripHtml = ( html ) => {
    if ( ! html ) return "";
    const noTags = String( html ).replace( /<[^>]*>/g,"" );
    return noTags
        .replace( /&nbsp;/g," " )
        .replace( /&amp;/g,"&" )
        .replace( /&lt;/g,"<" )
        .replace( /&gt;/g,">" )
        .replace( /&#39;/g,"'" )
        .replace( /&quot;/g,'"' );
};
const normalizeForMatch = ( text ) => String( text || "" )
    .normalize( "NFKC" )
    .replace( /[\u0421\u0441]/g,"C" );

const normalizedCommand = ( text ) => normalizeForMatch( stripHtml( text ) )
    .replace( /\s+/g," " )
    .trim()
    .toLowerCase();

const isCommand = ( text,kind ) => {
    const t = normalizedCommand( text );
    const patterns = COMMAND_PATTERNS[kind] || [];
    return patterns.some( ( re ) => re.test( t ) );
};

const hashObject = ( obj ) => crypto.createHash( "sha256" ).update( JSON.stringify( obj || {} ) ).digest( "hex" );

const makeDedupeKey = ( e ) => [e.webhookId || "",e.eventType || "",e.commentId || e.taskId || e.folderId || e.workItemId || "",e.createdDate || e.lastUpdatedDate || ""].join( "|" );


const getCustomFieldValueById = ( customFields = [],id ) => {
    if ( ! id || ! Array.isArray( customFields ) ) return null;
    const f = customFields.find( x => x && x.id === id );
    return f ? (f.value ?? null) : null;
};

const normalizeExtracted = ( x ) => {
    if ( ! x ) return null;
    const norm = ( v ) => (typeof v === "string" ? v.trim() : v);
    return {
        wrikeTicketId:x.wrikeTicketId,
        identifier:x.identifier,
        title:norm( x.title ),
        titleUrlSlug:norm( x.titleUrlSlug ),
        summary:norm( x.summary ),
        dateOfPublication:norm( x.dateOfPublication ),
        content:norm( x.content ),
        mediaType:norm( (x.mediaType || "").toLowerCase() ),
        metaDescription:norm( x.metaDescription ),
        metaTitle:norm( x.metaTitle ),
        allowOnlyUpdate:x.allowOnlyUpdate
    };
};
module.exports = {
    logEvent,
    toPlainError,
    stripHtml,
    isCommand,
    normalizeForMatch,
    normalizedCommand,
    hashObject,
    makeDedupeKey,
    getCustomFieldValueById,
    normalizeExtracted
}