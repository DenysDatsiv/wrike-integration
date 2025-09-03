const {loadEnv} = require( './configurations/loadEnv' );
loadEnv( process.env.APP_ENV );

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

app.listen( config.server.port,async () => {
    console.log( `Server is running at http://localhost:${config.server.port} in ${config.env} mode` );

    let publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").replace( /\/$/,"" );

    try{
        await ensureWebhookRegistered( publicBaseUrl );
    }catch ( e ){
        console.warn( "⚠️ Webhook auto-registration failed:",e?.response?.data || e?.message || e );
    }
} );
