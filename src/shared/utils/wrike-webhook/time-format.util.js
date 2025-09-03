const formatUsDateTime = ( iso ) => {
    if ( ! iso ) return "earlier";
    const d = new Date( iso );
    return new Intl.DateTimeFormat( "en-US",{
        month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",hour12:true
    } ).format( d );
};
module.exports = {formatUsDateTime}