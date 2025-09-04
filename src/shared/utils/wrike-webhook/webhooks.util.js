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
async function ensureWebhookRegistered(baseUrlOverride) {
    const base = (baseUrlOverride || PUBLIC_BASE_URL || "").replace(/\/$/, "");
    if (!base) throw new Error("PUBLIC_BASE_URL не задано (і не передано baseUrlOverride)");
    if (!WEBHOOK_SECRET) throw new Error("WEBHOOK_SECRET не задано — Wrike вертає 400 без валідного secret");

    const hookUrl = `${base}/wrike/webhook`;

    // 1) Ідемпотентність: прибираємо старий хук з тим самим URL
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

    // 2) ЄДИНИЙ коректний спосіб: form-urlencoded із РЯДКОМ у полі "events"
    //    ВАЖЛИВО: не .append("events", ...), не JSON-масив — тільки рядок "[A,B]"
    const body = new URLSearchParams();
    body.set("hookUrl", hookUrl);
    body.set("secret", WEBHOOK_SECRET);
    body.set("events", EVENTS_STRING); // ← ключовий момент

    try {
        const { data } = await wrike.post("/webhooks", body.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        const created = data?.data?.[0];
        if (!created?.id) throw new Error("Створення вебхука відбулося без ID у відповіді");
        console.log("✅ Вебхук створено:", created.id);
        return created;
    } catch (e) {
        // Підкажемо, якщо знов подано некоректний формат events
        const errText = toPlainError(e);
        console.warn("⚠️ Створення вебхука не вдалося:", errText);
        if (/events/i.test(errText)) {
            console.warn(`💡 Перевір значення 'events': має бути саме ${EVENTS_STRING} у form-urlencoded.`);
        }
        throw e;
    }
}

module.exports = { ensureWebhookRegistered };
