const crypto = require( "crypto" );

const hmacSha256 = ( key,value ) => crypto.createHmac( "sha256",key ).update( value ).digest( "hex" );

const sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve,ms ) );

function createSlug( input,options = {} ){
    const {lower = true,remove = /[^a-zA-Z0-9\s-]/g,replacement = "-"} = options;
    if ( ! input ) return "";
    let slug = String( input )
        .normalize( "NFKD" )
        .replace( /[\u0300-\u036f]/g,"" )
        .replace( remove,"" )
        .trim()
        .replace( /\s+/g,replacement );
    if ( lower ) slug = slug.toLowerCase();
    return slug;
}


module.exports = {hmacSha256,sleep,createSlug};
