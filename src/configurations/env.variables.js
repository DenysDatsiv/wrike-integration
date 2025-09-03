// config/.js
const axios = require("axios");

const PORT = Number(process.env.PORT || 3000);
const WRIKE_API_URL = process.env.WRIKE_API_URL || "https://www.wrike.com/api/v4";
const WRIKE_API_TOKEN = process.env.WRIKE_API_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

let PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");

const LT_ENABLE = String(1 || "0") === "1";
const LT_SUBDOMAIN = "my-webhook-3030" || undefined;

if (!WRIKE_API_TOKEN) console.warn("⚠️  WRIKE_API_TOKEN не задано");
if (!WEBHOOK_SECRET) console.warn("⚠️  WEBHOOK_SECRET не задано");
if (!PUBLIC_BASE_URL && !LT_ENABLE)
    console.warn("⚠️  PUBLIC_BASE_URL не задано і LT_ENABLE=0 — вебхук не зареєструється.");

const wrike = axios.create({
    baseURL: WRIKE_API_URL,
    timeout: 20000,
    headers: { Authorization: `bearer ${WRIKE_API_TOKEN}` },
});

module.exports = {
    wrike,
    PORT,
    WRIKE_API_URL,
    WRIKE_API_TOKEN,
    WEBHOOK_SECRET,
    PUBLIC_BASE_URL,
    LT_ENABLE,
    LT_SUBDOMAIN,
};
