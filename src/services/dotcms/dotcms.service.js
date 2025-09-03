const { toISODate } = require( "../../shared/utils/converters" );
const { dotcmsApiClient } = require( "../../configurations/httpClients" );

async function fireCreateOrPublish(actionId, contentletPayload) {
    const url = `/api/v1/workflow/actions/${encodeURIComponent(actionId)}/fire`;
    const body = { contentlet: contentletPayload };
    const { data } = await dotcmsApiClient.put(url, body);
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
module.exports = { createInsight };
