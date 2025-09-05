// const dotenv = require( 'dotenv' );
//
// dotenv.config();
const express = require( 'express' );
const cors = require( 'cors' );

const dotcmsRouter = require( './routes/dotcmsRouter' );
const backendRouter = require( './routes/backendRouter' );
const config = require( '../config' );
const wrikeRoutes = require( './routes/wrikeRoutes' );
const {ensureWebhookRegistered} = require( "./shared/utils/wrike-webhook/webhooks.util" );
const {startLocalTunnel} = require("./shared/utils/wrike-webhook/localtunnel.util");

const { PORT, LT_ENABLE, PUBLIC_BASE_URL } = require("./configurations/env.variables");

const app = express();

app.use( cors() );
app.set( "trust proxy",true );

app.use( express.json( {
    verify:( req,_res,buf ) => {
        req.rawBody = buf;
    }
} ) );

app.use( express.json( {strict:false} ) );

app.use( '/dotcms',dotcmsRouter );
app.use( '/back-end',backendRouter );
app.use( '/wrike',wrikeRoutes );

app.listen(PORT, async () => {
    console.log(`✅ Server on http://localhost:${PORT}`);
    let publicBaseUrl = (PUBLIC_BASE_URL || "").replace(/\/$/, "");
    console.log(`Public base (env): ${publicBaseUrl || "(not set)"}`);

    try {
        // if (LT_ENABLE || !publicBaseUrl) {
        //     const tunnel = await startLocalTunnel();
        //     publicBaseUrl = (tunnel?.url || "").replace(/\/$/, "");
        //     console.log(`   Public base (tunnel): ${publicBaseUrl}`);
        // }
        await ensureWebhookRegistered(publicBaseUrl);

    } catch (e) {
        console.warn("⚠️ Failed:", e?.response?.data || e?.message || e);
    }
});
