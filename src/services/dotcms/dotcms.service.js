const { toISODate } = require( "../../shared/utils/converters" );
const { dotcmsApiClient } = require( "../../configurations/httpClients" );

async function fireCreateOrPublish(actionId, contentletPayload) {
    const url = `/api/v1/workflow/actions/${encodeURIComponent(actionId)}/fire`;
    const body = { contentlet: contentletPayload };
    const { data } = await dotcmsApiClient.put(url, body);
    return data;
}

async function fireSaveContentlet(contentlet, { comments = "saving content", actionName = "save" } = {}) {
    const body = { actionName, comments, contentlet };
    const { data } = await dotcmsApiClient.put("/api/v1/workflow/actions/fire", body);
    return data;
}



async function createInsight({ body }) {
    const isoDate = toISODate(body.dateOfPublication);

    const contentlet = {
        contentType: 'usInsightArticle',
        languageId: 1,
        siteOrFolder: process.env.DOTCMS_SITE,
        title:   body.title,
        titleUrlSlug: body.titleUrlSlug,
        summary: body.summary,
        content:  body.content,
        wrikeTicketId: body.wrikeTicketId,
        dateOfPublication: isoDate,
        fullWidth: body.fullWidth || false,
        showBannerUnderTitle :body.showBannerUnderTitle || false,
        showBannerOnArticlePage :body.showBannerUnderTitle || false,
        useCustomDisclaimer :body.useCustomDisclaimer || false,
        siteType :body.siteType || {golf:false},
        mediaType :body.mediaType || false,
    };

    const actionId =  process.env.WORKFLOW_ACTION_ID_DEFAULT;

    try {
        const fired = await fireCreateOrPublish(actionId, contentlet );
        return { ok:true, fired };
    } catch (err) {

        const code = err?.code || err?.cause?.code;
        const status = err?.response?.status;
        const data = err?.response?.data;
        return {
            ok:false,
            error: code || status || err.message,
            details: status ? data : undefined,
        };
    }
}
async function getContentMetaByIdentifier(identifier) {
    const { data } = await dotcmsApiClient.get(`/api/content/id/${encodeURIComponent(identifier)}`);
    // Відповіді в різних версіях можуть мати трохи різні обгортки — витягуємо обережно:
    const ct =
        data?.contentType ||
        data?.entity?.contentType ||
        data?.contentlet?.contentType ||
        data?.content?.contentType;
    const lang =
        data?.languageId ||
        data?.entity?.languageId ||
        data?.contentlet?.languageId ||
        data?.content?.languageId ||
        1;

    if (!ct) throw new Error(`contentType not found for identifier=${identifier}`);
    return { contentType: ct, languageId: lang, raw: data };
}

/**
 * Оновлює існуючий контент ТІЛЬКИ тими полями, що передані у patch.
 * 1) Дізнається contentType за identifier
 * 2) Фаєрить workflow "save" з contentlet: { identifier, contentType, languageId, ...patch }
 */
async function updateByIdentifier(identifier, patch = {}, opts = {}) {
    if (!identifier) return { ok: false, status: 400, error: "identifier is required" };

    // фільтруємо undefined, щоб випадково не затирати поля
    const filtered = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => typeof v !== "undefined")
    );

    // конвертації дат, якщо присутні
    if ("dateOfPublication" in filtered && filtered.dateOfPublication) {
        filtered.dateOfPublication = toISODate(filtered.dateOfPublication);
    }

    let meta;
    try {
        meta = await getContentMetaByIdentifier(identifier);
    } catch (err) {
        return { ok: false, status: 404, error: err.message };
    }

    const contentlet = {
        identifier,
        contentType: meta.contentType,      // 🔑 знайдено з backend’а
        languageId: meta.languageId,
        ...filtered,                        // 🔧 лише змінені/передані поля
    };

    // Можна додати siteOrFolder, якщо ваша схема цього вимагає для save
    if (opts.siteOrFolder) contentlet.siteOrFolder = opts.siteOrFolder;

    try {
        const { data } = await dotcmsApiClient.put(`/api/v1/workflow/actions/fire`, {
            actionName: "save",               // або "Publish", якщо треба відразу публікація
            comments: opts.comment || "Updating via API",
            contentlet,
        });
        return { ok: true, data };
    } catch (err) {
        const status = err?.response?.status;
        const details = err?.response?.data;
        return { ok: false, status, error: err.message, details };
    }
}

module.exports = {
    getContentMetaByIdentifier,
    updateByIdentifier,
};
module.exports = { createInsight,getContentMetaByIdentifier,updateByIdentifier };
