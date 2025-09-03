const { createInsight } = require('../../../services/dotcms/dotcms.service');

async function postInsight(req, res) {
    try {
        const result = await createInsight({ body: req.body || {} });
        if (!result.ok) return res.status(result.status || 400).json(result);
        return res.json(result);
    } catch (err) {
        const status = err?.response?.status || 500;
        const data   = err?.response?.data || err?.message || String(err);
        return res.status(status).json({ ok:false, error:data });
    }
}

module.exports = { postInsight };
