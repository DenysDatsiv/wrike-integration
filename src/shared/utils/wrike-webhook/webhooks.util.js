// shared/utils/webhooks.util.js
// Перевір шляхи імпортів під свій проєкт

const { wrike, WEBHOOK_SECRET, PUBLIC_BASE_URL } = require("../../../configurations/env.variables");
const { toPlainError } = require("./helpers.util");

// ВАЛІДНИЙ формат для Wrike: "[TaskCreated,CommentAdded]"
const WANT_EVENTS = ["TaskCreated", "CommentAdded"];
const EVENTS_STRING = `[${WANT_EVENTS.join(",")}]`;

/**
 * Регіструє вебхук на baseUrl (або бере PUBLIC_BASE_URL з env).
 * Порада: для Render не запускай сервер у build-команді — зроби Start Command окремо.
 */
sync function ensureWebhookRegistered(baseUrlOverride) {
    const base = (baseUrlOverride || PUBLIC_BASE_URL || "").replace(/\/$/, "");
    if (!base) throw new Error("PUBLIC_BASE_URL не задано");
    if (!WEBHOOK_SECRET) throw new Error("WEBHOOK_SECRET не задано");

    const hookUrl = `${base}/wrike/webhook`;

    console.log("🔄 Registering webhook at:", hookUrl);

    // Remove existing webhook
    let list = [];
    try {
        const resp = await wrike.get("/webhooks");
        list = resp?.data?.data || [];
        console.log(`📋 Found ${list.length} existing webhooks`);
    } catch (e) {
        console.warn("⚠️ Не вдалося отримати список вебхуків:", toPlainError(e));
    }

    const existing = list.find(w => w.hookUrl === hookUrl);
    if (existing?.id) {
        try {
            await wrike.delete(`/webhooks/${encodeURIComponent(existing.id)}`);
            console.log(`🗑️ Видалено попередній вебхук: ${existing.id}`);
        } catch (e) {
            console.warn("⚠️ Не вдалося видалити існуючий вебхук:", toPlainError(e));
        }
    }

    // Create new webhook with proper form encoding
    const body = new URLSearchParams();
    body.set("hookUrl", hookUrl);
    body.set("secret", WEBHOOK_SECRET);
    body.set("events", EVENTS_STRING); // "[TaskCreated,CommentAdded]"

    console.log("📤 Creating webhook with events:", EVENTS_STRING);

    try {
        const {data} = await wrike.post("/webhooks", body.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json"
            },
            timeout: 30000 // 30 second timeout
        });

        const created = data?.data?.[0];
        if (!created?.id) throw new Error("Створення вебхука відбулося без ID у відповіді");

        console.log("✅ Вебхук створено успішно:");
        console.log("   ID:", created.id);
        console.log("   URL:", created.hookUrl);
        console.log("   Events:", created.events);

        return created;
    } catch (e) {
        const errText = toPlainError(e);
        console.error("❌ Створення вебхука не вдалося:");
        console.error("   Error:", errText);
        console.error("   Status:", e?.response?.status);
        console.error("   Data:", e?.response?.data);

        if (/handshake/i.test(errText)) {
            console.error("💡 Handshake failed - check:");
            console.error("   1. Your server is publicly accessible");
            console.error("   2. HTTPS is working properly");
            console.error("   3. Webhook endpoint responds correctly");
            console.error("   4. WEBHOOK_SECRET is properly configured");
        }

        throw e;
    }
}
module.exports = { ensureWebhookRegistered };
