// shared/utils/webhooks.util.js
// ↑ переконайтесь у коректному шляху (../utils/helpers.util). У вашому проєкті це "../shared/utils/helpers.util"

const {wrike, WEBHOOK_SECRET, PUBLIC_BASE_URL} = require("../../../configurations/env.variables");
const WANT_EVENTS = ["TaskCreated", "CommentAdded"];

/**
 * Регіструє вебхук на вказаний baseUrl (або бере PUBLIC_BASE_URL з env).
 * Перевага: можна явно передати URL із LocalTunnel/ngrok.
 */
async function ensureWebhookRegistered(baseUrlOverride) {
    const base = (baseUrlOverride || PUBLIC_BASE_URL || "").replace(/\/$/, "");
    if (!base) throw new Error("PUBLIC_BASE_URL не задано (і не передано baseUrlOverride)");

    if (!WEBHOOK_SECRET) {
        throw new Error("WEBHOOK_SECRET не задано — Wrike вертає 400 без валідного secret");
    }

    const hookUrl = `${base}/wrike/webhook`;

    // 1) Почистимо існуючий із тим же URL (idempotent)
    let list = [];
    try {
        const resp = await wrike.get("/webhooks");
        list = resp?.data?.data || [];
    } catch (e) {
        console.warn("⚠️ Не вдалося отримати список вебхуків:", toPlainError(e));
    }
    const existing = list.find(w => w.hookUrl === hookUrl);
    if (existing?.id) {
        try {
            await wrike.delete(`/webhooks/${encodeURIComponent(existing.id)}`);
            console.log(`ℹ️ Видалено попередній вебхук: ${existing.id}`);
        } catch (e) {
            console.warn("⚠️ Не вдалося видалити існуючий вебхук:", toPlainError(e));
        }
    }

    // 2) Спроба створити як JSON (часто працює стабільніше)
    try {
        const { data } = await wrike.post("/webhooks", {
            hookUrl,
            secret: WEBHOOK_SECRET,
            events: WANT_EVENTS,
        });
        console.log("✅ Вебхук створено:", data?.data?.[0]?.id || "(unknown)");
        return data?.data?.[0];
    } catch (eJson) {
        console.warn("⚠️ JSON create failed, retry form-urlencoded:", toPlainError(eJson));
    }

    // 3) Фолбек: application/x-www-form-urlencoded із множинними полями "events"
    const body = new URLSearchParams();
    body.set("hookUrl", hookUrl);
    body.set("secret", WEBHOOK_SECRET);
    for (const ev of WANT_EVENTS) body.append("events", ev);

    const { data } = await wrike.post("/webhooks", body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    console.log("✅ Вебхук створено:", data?.data?.[0]?.id || "(unknown)");
    return data?.data?.[0];
}

module.exports = { ensureWebhookRegistered };
