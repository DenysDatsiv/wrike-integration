module.exports = {
    env:    process.env.APP_ENV || 'production',
    proxy: {
        http:  process.env.HTTP_PROXY  || null,
        https: process.env.HTTPS_PROXY || null,
    },
    dotcms: {
        url:   process.env.TARGET_BASE || '',
        token: process.env.DOTCMS_TOKEN  || null,
    },
    server: {
        port: Number(process.env.PORT) || 3030,
    },
};