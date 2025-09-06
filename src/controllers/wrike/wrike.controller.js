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

module.exports = {
    uploadFileToWrike,addCommentToWrikeTask,updateWrikeTaskStatus,getWrikeTaskId
};