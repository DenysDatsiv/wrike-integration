const axios = require('axios');
const {URL} = require('url');
const {HttpProxyAgent} = require('http-proxy-agent');
const {HttpsProxyAgent} = require('https-proxy-agent');
const config = require('../../config');

const httpAgent = config.proxy.http ? new HttpProxyAgent(config.proxy.http) : null;
const httpsAgent = config.proxy.https ? new HttpsProxyAgent(config.proxy.https) : null;


const rawNoProxy = process.env.NO_PROXY || '';
const noProxyList = rawNoProxy
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

function shouldBypass(hostname) {
    return noProxyList.some(pattern => {
        if (pattern.startsWith('.')) {
            return hostname.endsWith(pattern);
        }
        return hostname === pattern || hostname.startsWith(pattern);
    });
}

async function proxyRequest({req, res, targetBase, buildPath, token}) {
    let fullUrl;
    try {
        fullUrl = new URL(buildPath(req.params.apiName), targetBase).href;
    } catch (err) {
        console.error('Invalid target URL:', err.message);
        return res.status(500).json({error: 'Invalid target URL', details: err.message});
    }

    const {hostname} = new URL(fullUrl);
    const isLocal = config.env === 'local';
    const bypass = isLocal && shouldBypass(hostname);

    console.log(`Fetching ${fullUrl}  (useProxy=${isLocal && !bypass})`);

    const axiosConfig = {
        method: req.method,
        url: fullUrl,
        headers: {
            ...req.headers,
            host: undefined,
            ...(token ? {Authorization: `Bearer ${token}`} : {}),
        },
        params: req.query,
        data: req.body,
    };

    if (isLocal && !bypass) {
        axiosConfig.proxy = false;
        axiosConfig.httpAgent = httpAgent;
        axiosConfig.httpsAgent = httpsAgent;
    }

    try {
        const upstream = await axios(axiosConfig);
        return res
            .status(upstream.status)
            .json(upstream.data);

    } catch (err) {
        return res.status(502).json({error: 'Bad gateway', details: err.message});
    }
}

module.exports = {proxyRequest};
