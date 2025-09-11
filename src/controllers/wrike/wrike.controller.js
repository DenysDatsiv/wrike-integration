const axios = require( 'axios' );

const streamifier = require( 'streamifier' );
const FormData = require( 'form-data' );
const {validateTaskId,validateStatusId} = require( "../../validations/wrike.validation" );
const {wrikeApiClient} = require( "../../configurations/httpClients" );
const {WRIKE_API_URL, WRIKE_API_TOKEN} = require("../../configurations/env.variables");


wrikeApiClient.interceptors.request.use( ( config ) => {
    return config;
},( error ) => {
    return Promise.reject( error );
} );

wrikeApiClient.interceptors.response.use( ( response ) => {
    return response;
},( error ) => {
    return Promise.reject( error );
} );
async function uploadFileToWrike(taskId, pdfBuffer, fileName) {
    try {
        console.log("➡️ uploadFileToWrike called with:", { taskId, fileName });

        if (!taskId) throw new Error("taskId is required");
        if (!Buffer.isBuffer(pdfBuffer) && !(pdfBuffer instanceof Uint8Array)) {
            throw new Error("pdfBuffer must be Buffer or Uint8Array");
        }
        if (!fileName) throw new Error("fileName is required");

        console.log("✅ Input validation passed");

        // якщо це Uint8Array — перетворюємо в Buffer
        const buf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
        console.log("📦 Buffer prepared, size:", buf.length);

        const form = new FormData();
        form.append("file", buf, {
            filename: fileName,
            contentType: "application/pdf",
        });
        console.log("📑 FormData created with headers:", form.getHeaders());


        console.log("🔧 Axios client initialized");

        console.log("📤 Sending request to Wrike...");
        const { data } = await wrikeApiClient.post(
            `/tasks/${encodeURIComponent(taskId)}/attachments`,
            form
        );

        console.log("📥 Response received:", JSON.stringify(data, null, 2));

        const [attachment] = data?.data || [];
        if (!attachment) {
            console.log("⚠️ No attachment in Wrike response");
            throw new Error("Unexpected Wrike response: no attachment returned");
        }

        console.log("✅ Attachment uploaded:", { id: attachment.id, name: attachment.name });
        return attachment;
    } catch (err) {
        console.error("❌ uploadFileToWrike failed:", err.message);
        if (err.response) {
            console.error("📡 Wrike API error:", err.response.status, err.response.data);
        }
        throw err;
    }
}

async function addCommentToWrikeTask( taskId,pdfLink,fileName ){
    try{
        const comment = `
              <div>
                <p>The PDF for the article has been successfully generated. Please review the content and confirm the details. Your feedback is appreciated.</p>
                <h3 style="color: #2a7e99;">🔗 <strong>Access the WebSite:</strong></h3>
                <p style="font-size: 16px; color: #333;">
                    <a href="${pdfLink}" target="_blank" style="color: #1d74d7; text-decoration: none; font-weight: bold;">Click here </a>
                </p>
                <br />
                <br />
                <p style="font-size: 16px; color: #333;"><strong style="color: #5e9ed6;">🔗 Attached PDF Name:</strong> <span style="font-weight: bold; color: #ff6347;">${fileName}</span></p>
            </div>
`;
        await axios.post( `${WRIKE_API_URL}tasks/${taskId}/comments`,{
            text:comment,
        },{
            headers:{
                'Authorization':`Bearer ${WRIKE_API_TOKEN}`,'Content-Type':'application/json',
            },
        } );
    }catch ( error ){
    }
}

async function getWrikeTaskId(taskId) {
    const url = `tasks/?permalink=https://www.wrike.com/open.htm?id=${encodeURIComponent(taskId)}`;

    const response = await wrikeApiClient.get(url);

    const tasks = response?.data?.data;
    if (!Array.isArray(tasks) || tasks.length === 0) {
        const err = new Error(`Task not found for permalink id=${taskId}`);
        err.status = 404;
        throw err;
    }
    return tasks[0].id;
}

async function updateWrikeTaskStatus( taskId,newStatusId,axiosCfg = {} ){
    newStatusId = validateStatusId( newStatusId )

    const form = new URLSearchParams( {customStatus:newStatusId} );
    const res = await wrikeApiClient.put( `tasks/${encodeURIComponent( taskId )}`,form,{
        headers:{'Content-Type':'application/x-www-form-urlencoded'},...axiosCfg,
    } );

    return res.data;
}


// ---- 2) Custom Fields (ваші ідентифікатори) --------------------------------
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
    TOUCHED_IN_DOTCMS: 'IEAB3SKBJUAJHH5S', // <- same field used to gate actions
};

// ---- 3) Допоміжні утиліти --------------------------------------------------
function toYyyyMmDd(input) {
    if (!input) return undefined;
    // приймає Date | number | string і приводить до YYYY-MM-DD
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return undefined;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function truthyYesNo(v) {
    // приводимо до 'yes'/'no' (lowercase), за замовчуванням 'no'
    const t = typeof v === 'string' ? v.trim().toLowerCase() : v;
    const isTrue =
        t === true ||
        t === 'true' ||
        t === '1' ||
        t === 'yes' ||
        t === 'y' ||
        t === 1;
    return isTrue ? 'yes' : 'no';
}

function pushIfDefined(arr, id, value) {
    if (value !== undefined && value !== null && value !== '') {
        arr.push({ id, value });
    }
}

// ---- 4) Контролер (все-в-одному) -------------------------------------------
/**
 * Очікуване тіло запиту (JSON):
 * {
 *   "folderId": "IEAB3...",        // (опційно) куди створюємо задачy: /folders/{id}/tasks; якщо нема — /tasks
 *   "title": "Заголовок задачі",   // (обов'язково)
 *   "summary": "Короткий опис",
 *   "content": "<p>HTML або текст</p>",
 *   "dateOfPublication": "2025-09-30" | 1696032000000 | "2025-09-30T00:00:00Z",
 *   "mediaType": "Article" | "Video" | "...", // значення вашого CF (тип залежить від конфігурації у Wrike)
 *   "metaDescription": "SEO description",
 *   "metaTitle": "SEO title",
 *   "identifier": "ext-12345",
 *   "allowUpdateOnly": true | false | "yes" | "no"
 * }
 */
async function createWrikeTicketController(req, res) {
    try {
        const {
            folderId,
            title,
            summary,
            content,
            dateOfPublication,
            mediaType,
            metaDescription,
            metaTitle,
            identifier,
            allowUpdateOnly,
            updatedInDotcms
        } = req.body || {};

        // --- валідація мінімуму
        if (!title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ error: 'Field "title" is required' });
        }

        // --- формуємо customFields масив
        const customFields = [];
        pushIfDefined(customFields, CONTENT_FIELDS.TITLE, title);
        pushIfDefined(customFields, CONTENT_FIELDS.SUMMARY, summary);
        pushIfDefined(
            customFields,
            CONTENT_FIELDS.DATE_OF_PUBLICATION,
            toYyyyMmDd(dateOfPublication)
        );
        pushIfDefined(customFields, CONTENT_FIELDS.CONTENT, content);
        pushIfDefined(customFields, CONTENT_FIELDS.MEDIA_TYPE, mediaType);
        pushIfDefined(customFields, CONTENT_FIELDS.META_DESCRIPTION, metaDescription);
        pushIfDefined(customFields, CONTENT_FIELDS.META_TITLE, metaTitle);
        pushIfDefined(customFields, CONTENT_FIELDS.IDENTIFIER, identifier);
        pushIfDefined(
            customFields,
            CONTENT_FIELDS.CREATED_FLAG_ALLOW_UPDATE_ONLY,
            truthyYesNo(allowUpdateOnly)
        );
        pushIfDefined(customFields, CONTENT_FIELDS.TOUCHED_IN_DOTCMS, truthyYesNo(updatedInDotcms));


        // --- Wrike payload (мінімальний)
        const payload = {
            title: title,
            description: summary || '', // можна зібрати summary+content, якщо потрібно
            customFields,
        };

        // --- endpoint: у папку чи загальний
        const endpoint = folderId
            ? `/folders/${encodeURIComponent(folderId)}/tasks`
            : `/tasks`;

        const { data } = await wrikeApiClient.post(endpoint, payload);

        // Стандартна відповідь Wrike: { kind: "tasks", data: [ { id, permalink, ... } ] }
        const created = Array.isArray(data?.data) ? data.data[0] : undefined;
        if (!created) {
            return res.status(502).json({
                error: 'Unexpected Wrike response',
                raw: data,
            });
        }

        return res.status(201).json({
            id: created.id,
            permalink: created.permalink,
            title: created.title,
            customFieldsApplied: customFields.length,
        });
    } catch (err) {
        // уніфікована помилка
        const status = err.response?.status || 500;
        return res.status(status).json({
            error: err.response?.data?.errorDescription || err.message || 'Wrike error',
            details: err.response?.data || null,
        });
    }
}
async function updateWrikeTicketController(req, res) {
    try {
        const {
            taskId: rawTaskId, // може бути: канонічний, числовий permalink id, або повний permalink URL
            title,
            summary,
            content,
            dateOfPublication,
            mediaType,
            metaDescription,
            metaTitle,
            identifier,
            allowUpdateOnly,
            updatedInDotcms
        } = req.body || {};

        if (!rawTaskId || typeof rawTaskId !== 'string') {
            return res.status(400).json({ error: 'Field "taskId" is required' });
        }

        // 1) перетворюємо у канонічний Wrike taskId
        const taskId = await getWrikeTaskId(rawTaskId);
console.log(taskId)
        // 2) формуємо customFields
        const customFields = [];
        pushIfDefined(customFields, CONTENT_FIELDS.TITLE, title);
        pushIfDefined(customFields, CONTENT_FIELDS.SUMMARY, summary);
        pushIfDefined(customFields, CONTENT_FIELDS.DATE_OF_PUBLICATION, toYyyyMmDd(dateOfPublication));
        pushIfDefined(customFields, CONTENT_FIELDS.CONTENT, content);
        pushIfDefined(customFields, CONTENT_FIELDS.MEDIA_TYPE, mediaType);
        pushIfDefined(customFields, CONTENT_FIELDS.META_DESCRIPTION, metaDescription);
        pushIfDefined(customFields, CONTENT_FIELDS.META_TITLE, metaTitle);
        pushIfDefined(customFields, CONTENT_FIELDS.IDENTIFIER, identifier);
        pushIfDefined(customFields, CONTENT_FIELDS.CREATED_FLAG_ALLOW_UPDATE_ONLY, truthyYesNo(allowUpdateOnly));
        pushIfDefined(customFields, CONTENT_FIELDS.TOUCHED_IN_DOTCMS, truthyYesNo(updatedInDotcms));

        // 3) PUT /tasks/{taskId}
        const payload = { title, description: summary || '', customFields };
        const { data } = await wrikeApiClient.put(`/tasks/${encodeURIComponent(taskId)}`, payload);

        const updated = Array.isArray(data?.data) ? data.data[0] : undefined;
        if (!updated) {
            return res.status(502).json({ error: 'Unexpected Wrike response', raw: data });
        }

        return res.status(200).json({
            id: updated.id,
            permalink: updated.permalink,
            title: updated.title,
            customFieldsApplied: customFields.length,
        });
    } catch (err) {
        const status = err.response?.status || err.status || 500;
        return res.status(status).json({
            error: err.response?.data?.errorDescription || err.message || 'Wrike update error',
            details: err.response?.data || null,
        });
    }
}

module.exports = {
    uploadFileToWrike,addCommentToWrikeTask,updateWrikeTaskStatus,getWrikeTaskId,createWrikeTicketController,updateWrikeTicketController
};