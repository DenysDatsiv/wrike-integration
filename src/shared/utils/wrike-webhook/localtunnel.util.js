const { LT_ENABLE, LT_SUBDOMAIN, PORT, PUBLIC_BASE_URL } = require("../../../configurations/env.variables");

if (!PUBLIC_BASE_URL && !LT_ENABLE) {
    console.warn("⚠️  PUBLIC_BASE_URL не задано і LT_ENABLE=0 — вебхук не зареєструється.");
}

async function startLocalTunnel() {
    const { default: localtunnel } = await import("localtunnel");
    const tunnel = await localtunnel({
        port: Number(PORT),
        subdomain: LT_SUBDOMAIN || undefined,
    });
    console.log(`🌐 LocalTunnel URL: ${tunnel.url}`);

    const close = () => { try { tunnel.close(); } catch {} process.exit(0); };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);

    return tunnel;
}

module.exports = { startLocalTunnel };
