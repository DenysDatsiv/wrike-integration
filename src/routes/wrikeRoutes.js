const express = require( 'express' );
const router = express.Router();
const {generatePdf} = require( '../controllers/wrike/pdf.controller' );
const { uploadFileToWrike,addCommentToWrikeTask,updateWrikeTaskStatus,getWrikeTaskId} = require( '../controllers/wrike/wrike.controller' );
const {extractFileNameFromUrl} = require( "../shared/utils/article-name-extracting" );
const {handleWrikeWebhook} = require( "../controllers/wrike/wrike-webhook.controller" );
const {dotcmsApiClient} = require("../configurations/httpClients");


router.post('/send-for-review', async (req, res) => {
    const {url, taskId, persona} = req.body;
    console.log(url, taskId);
})
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
router.get('/puppeteer/path', (req, res) => {
    const p = typeof executablePath === 'function' ? executablePath() : '(unknown)';
    res.json({ path: p });
});
router.post("/webhook", handleWrikeWebhook);

module.exports = router;
