const axios = require( 'axios' );

const streamifier = require( 'streamifier' );
const FormData = require( 'form-data' );
const {validateTaskId,validateStatusId} = require( "../../validations/wrike.validation" );
const {wrikeApiClient} = require( "../../configurations/httpClients" );


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

async function uploadFileToWrike( taskId,pdfBuffer,fileName ){
    taskId = validateTaskId( taskId );

    try{
        const formData = new FormData();

        const fileStream = streamifier.createReadStream( pdfBuffer );

        formData.append( 'file',fileStream,{filename:fileName,contentType:'application/pdf'} );

        const response = await axios.post( `${WRIKE_API_URL}tasks/${taskId}/attachments`,formData,{
            headers:{
                'Authorization':`Bearer ${WRIKE_API_TOKEN}`,...formData.getHeaders(),
            },
        } );

        return response.data.data[0];
    }catch ( error ){
        throw new Error( 'Failed to upload file to Wrike' );
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