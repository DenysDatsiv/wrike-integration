const { toPlainError } = require("./helpers.util");
const { wrikeApiClient } = require("../../../configurations/httpClients");

const WANT_EVENTS = ["TaskCreated", "CommentAdded"];

async function ensureWebhookRegistered(baseUrlOverride) {
    const base = (baseUrlOverride || process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
    if (!base) throw new Error("PUBLIC_BASE_URL is not set (and not passed via baseUrlOverride)");

    if (!process.env.WEBHOOK_SECRET) {
        throw new Error("WEBHOOK_SECRET is not set — Wrike returns 400 without a valid secret");
    }

    const hookUrl = `${base}/wrike/webhook`;

    let list = [];
    try {
        const resp = await wrikeApiClient.get("/webhooks");
        list = resp?.data?.data || [];
    } catch (e) {
        console.warn("⚠️ Failed to fetch webhook list:", toPlainError(e));
    }

    const existing = list.find(w => w.hookUrl === hookUrl);
    if (existing?.id) {
        try {
            await wrikeApiClient.delete(`/webhooks/${encodeURIComponent(existing.id)}`);
            console.log(`ℹ️ Deleted previous webhook: ${existing.id}`);
        } catch (e) {
            console.warn("⚠️ Failed to delete existing webhook:", toPlainError(e));
        }
    }

    try {
        const { data } = await wrikeApiClient.post("/webhooks", {
            hookUrl,
            secret: process.env.WEBHOOK_SECRET,
            events: WANT_EVENTS,
        });
        console.log("✅ Webhook created:", data?.data?.[0]?.id || "(unknown)");
        return data?.data?.[0];
    } catch (eJson) {
        console.warn("⚠️ JSON create failed, retrying with form-urlencoded:", toPlainError(eJson));
    }

    // 4) Fallback: application/x-www-form-urlencoded
    const body = new URLSearchParams();
    body.set("hookUrl", hookUrl);
    body.set("secret", process.env.WEBHOOK_SECRET);
    for (const ev of WANT_EVENTS) body.append("events", ev);

    const { data } = await wrikeApiClient.post("/webhooks", body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    console.log("✅ Webhook created:", data?.data?.[0]?.id || "(unknown)");
    return data?.data?.[0];
}

module.exports = { ensureWebhookRegistered };
