const {HttpsProxyAgent} = require( "https-proxy-agent" );
const {HttpProxyAgent} = require( "http-proxy-agent" );

const axios = require( "axios" );

const DOTCMS_API_URL   = process.env.DOTCMS_API_URL;
const DOTCMS_API_TOKEN = process.env.DOTCMS_API_TOKEN;

const WRIKE_API_TOKEN = process.env.WRIKE_API_TOKEN;
const WRIKE_API_URL = process.env.WRIKE_API_URL;


const httpsAgent = process.env.HTTPS_PROXY ? new HttpsProxyAgent( process.env.HTTPS_PROXY ) : undefined;
const httpAgent = process.env.HTTP_PROXY ? new HttpProxyAgent( process.env.HTTP_PROXY ) : undefined;


const dotcmsApiClient = axios.create({
    baseURL:DOTCMS_API_URL,
    proxy:false,
    timeout: 30000,
    headers: {
        Authorization: `Bearer ${DOTCMS_API_TOKEN}`,
        'Content-Type': 'application/json',
    },
});


const wrikeApiClient = axios.create( {
    baseURL:WRIKE_API_URL,
    proxy:false,
    timeout:30000,
    headers:{
        'Authorization':`Bearer ${WRIKE_API_TOKEN}`,
    },
});


module.exports = {dotcmsApiClient,wrikeApiClient};