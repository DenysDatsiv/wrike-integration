const express = require( 'express' );
const router = express.Router();
const {generatePdf} = require( '../controllers/wrike/pdf.controller' );
const { uploadFileToWrike,addCommentToWrikeTask,updateWrikeTaskStatus,getWrikeTaskId} = require( '../controllers/wrike/wrike.controller' );
const {extractFileNameFromUrl} = require( "../shared/utils/article-name-extracting" );
const {handleWrikeWebhook} = require( "../controllers/wrike/wrike-webhook.controller" );
const {dotcmsApiClient} = require("../configurations/httpClients");
const axios = require("axios");


router.post( '/send-for-review',async ( req,res ) => {
    const { url,taskId,persona } = req.body;
    try{
        const id =  await getWrikeTaskId(taskId)

        const pdfBuffer = await generatePdf(url);


        // const sanitizedFileName = extractFileNameFromUrl( url );
        const fileName = `${"denys"}.pdf`;
        // await uploadFileToWrike( id,pdfBuffer,fileName );
        // await addCommentToWrikeTask( id,url,fileName );

        res.status( 200 ).json( {message:'PDF generated, uploaded as attachment, and comment added to Wrike task.'} );
    }catch ( error ){
        res.status( 500 ).send( 'An error occurred while generating the PDF or sending it to Wrike.' );
    }
} );

router.post( '/update-status',async ( req,res ) => {
    try{
        console.log(req.body);
        const {taskId,customStatus} = req.body;
        const id =  await getWrikeTaskId(taskId)
        console.log(id)
        const data = await updateWrikeTaskStatus(id, customStatus);
        return res.status(200).json({ ok: true, id, customStatus, data });
    } catch (e) {
        const status = e.response?.status || 502;
        return res.status(status).json({
            message: e.message,
            details: e.response?.data || e.details || null,
        });
    }
});

router.post("/webhook", handleWrikeWebhook);

router.get('/ping', async (_, res) => {
    try {
        const r = await axios.get('https://www.wrike.com/api/v4/version', {
            headers: { Authorization: `Bearer ${process.env.WRIKE_API_TOKEN}` }
        });
        res.json({ ok:true, version: r.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ ok:false, err: e.response?.data || e.message });
    }
});
module.exports = router;
