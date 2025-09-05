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
function extractWrikeTaskId(input) {
    if (input == null) return null;

    const str = String(input).trim();

    // Якщо вже передали чистий id (тільки цифри) — повертаємо як є
    if (/^\d+$/.test(str)) return str;

    // Спробувати як URL
    try {
        const u = new URL(str);

        // 1) Класичний варіант: ...open.htm?id=123
        const byQuery = u.searchParams.get('id');
        if (byQuery && /^\d+$/.test(byQuery)) return byQuery;

        // 2) Варіанти у hash: ...workspace.htm#...&t=123 або ...#...&id=123
        if (u.hash) {
            const h = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
            const sp = new URLSearchParams(h);
            const t = sp.get('t') || sp.get('id');
            if (t && /^\d+$/.test(t)) return t;

            // Як fallback: пошук id=123 у hash рядку
            const hm = h.match(/\b(?:id|t)=(\d+)\b/i);
            if (hm) return hm[1];
        }

        // 3) Інколи id зустрічається у шляху: /tasks/1742609723
        const pathMatch = u.pathname.match(/(\d{6,})/);
        if (pathMatch) return pathMatch[1];
    } catch {
        // Не URL — шукаємо шаблони прямо у рядку
        const m =
            str.match(/\b(?:id|t)=(\d+)\b/i) || // id=123 або t=123
            str.match(/(\d{6,})/);             // будь-які 6+ цифр поспіль
        if (m) return m[1];
    }

    return null;
}
module.exports = {
    logEvent,
    toPlainError,
    extractWrikeTaskId,
    stripHtml,
    isCommand,
    normalizeForMatch,
    normalizedCommand,
    hashObject,
    makeDedupeKey,
    getCustomFieldValueById,
    normalizeExtracted
}