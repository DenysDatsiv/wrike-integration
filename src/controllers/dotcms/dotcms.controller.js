const {proxyRequest} = require( '../../services/proxyService' );
const config = require( '../../../config' );
const makeProxyHandler = ( buildPathFromReq ) => async ( req,res ) => {
    try{
        const buildPath = ( arg ) => buildPathFromReq( req,arg );

        await proxyRequest( {
            req,res,targetBase:config.dotcms.url,buildPath,token:config.dotcms.token,
        } );
    }catch ( error ){
        if ( ! res.headersSent ) res.status( 500 ).send( 'Internal Server Error' );
    }
};

const handleDotcms = makeProxyHandler( ( req,apiName ) => `/api/vtl/${apiName}` );
const handleDotcmsApi = makeProxyHandler( ( req,apiName ) => `/api/v1/${apiName}` );
const handleDotcmsContent = makeProxyHandler( ( req ) => `/api/content/id/${req.params.id}` );


module.exports = {handleDotcms,handleDotcmsContent,handleDotcmsApi};
