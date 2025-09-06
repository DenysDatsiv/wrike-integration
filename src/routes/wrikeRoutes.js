const express = require( 'express' );
const router = express.Router();
const {generatePdf} = require( '../controllers/wrike/pdf.controller' );
const { uploadFileToWrike,addCommentToWrikeTask,updateWrikeTaskStatus,getWrikeTaskId} = require( '../controllers/wrike/wrike.controller' );
const {extractFileNameFromUrl} = require( "../shared/utils/article-name-extracting" );
const {handleWrikeWebhook} = require( "../controllers/wrike/wrike-webhook.controller" );
const {dotcmsApiClient} = require("../configurations/httpClients");
const axios = require("axios");
const { randomBytes } = require('crypto');


function normalizeToBuffer(input) {
    if (!input) throw new Error('No PDF payload');

    // Вже Buffer
    if (Buffer.isBuffer(input)) return input;

    // Uint8Array або ArrayBuffer
    if (input instanceof Uint8Array) return Buffer.from(input);
    if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input));

    // Серіалізований Buffer ({ type: 'Buffer', data: [...] })
    if (typeof input === 'object' && Array.isArray(input.data)) {
        return Buffer.from(input.data);
    }

    // data URL або чистий base64
    if (typeof input === 'string') {
        const s = input.trim();
        const m = s.match(/^data:application\/pdf;base64,(.*)$/i);
        if (m) return Buffer.from(m[1], 'base64');

        // якщо це чистий base64 (без data URL) — пробуємо декодувати
        // (можеш додати дод. валідацію за потреби)
        return Buffer.from(s, 'base64');
    }

    throw new Error('Unsupported PDF payload type');
}
// services/fakePdf.service.js
function generateRandomPdf(text = `Random ${Date.now()}`) {
    const pdf = `%PDF-1.4
1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj
2 0 obj <</Type/Pages/Count 1/Kids[3 0 R]>> endobj
3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R>> endobj
4 0 obj <</Length 56>> stream
BT /F1 12 Tf 72 100 Td (${text}) Tj ET
endstream endobj
xref 0 5
0000000000 65535 f 
0000000010 00000 n 
0000000056 00000 n 
0000000109 00000 n 
0000000207 00000 n 
trailer <</Root 1 0 R/Size 5>>
startxref
300
%%EOF`;
    return Buffer.from(pdf, 'utf-8');
}


router.post( '/send-for-review',async ( req,res ) => {
    const { url,taskId,persona } = req.body;
    try{
        const id =  await getWrikeTaskId(taskId)

        await generatePdf(url);

        const pdfBuffer = normalizeToBuffer(generateRandomPdf('No URL provided'));

        // const sanitizedFileName = extractFileNameFromUrl( url );
        const fileName = `${"denys"}.pdf`;
        await uploadFileToWrike(id, pdfBuffer, fileName);
        await addCommentToWrikeTask( id,url,fileName );

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
