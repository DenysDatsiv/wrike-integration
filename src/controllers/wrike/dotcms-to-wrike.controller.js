const { wrikeApiClient } = require('../../configurations/httpClients');

/* ==================== Custom Field IDs ==================== */
const CONTENT_FIELDS = {
    TITLE: 'IEAB3SKBJUAJBWGI',
    SUMMARY: 'IEAB3SKBJUAJBWGA',
    DATE_OF_PUBLICATION: 'IEAB3SKBJUAJBWFK',
    CONTENT: 'IEAB3SKBJUAI5VKH',
    MEDIA_TYPE: 'IEAB3SKBJUAJBYKR',
    META_DESCRIPTION: 'IEAB3SKBJUAJCDJC',
    META_TITLE: 'IEAB3SKBJUAJCDIR',
    IDENTIFIER: 'IEAB3SKBJUAJGDGR',
    CREATED_FLAG_ALLOW_UPDATE_ONLY: 'IEAB3SKBJUAJGE6G',
};

/* ==================== Helpers ==================== */
const isPermalinkId = (val) => /^[0-9]+$/.test(String(val).trim());
const capitalizeFirst = (s) =>
    typeof s === 'string' && s.length ? s[0].toUpperCase() + s.slice(1) : s;

const formatDateToDDMMYYYY = (val) => {
    if (!val) return val;
    try {
        const d = new Date(val);
        if (isNaN(d)) return val;
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    } catch {
        return val;
    }
};

/* ==================== ProseMirror JSON → HTML ==================== */
function escapeHtml(str = '') {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function renderMarks(text, marks = []) {
    if (!marks || !marks.length) return text;
    for (const m of marks) {
        if (m.type === 'bold' || m.type === 'strong') {
            text = `<strong>${text}</strong>`;
        } else if (m.type === 'italic' || m.type === 'em') {
            text = `<em>${text}</em>`;
        } else if (m.type === 'underline') {
            text = `<u>${text}</u>`;
        } else if (m.type === 'strike' || m.type === 'strikethrough') {
            text = `<s>${text}</s>`;
        } else if (m.type === 'code') {
            text = `<code>${text}</code>`;
        } else if (m.type === 'link' && m.attrs?.href) {
            const href = escapeHtml(m.attrs.href);
            const target = m.attrs?.target ? ` target="${escapeHtml(m.attrs.target)}"` : '';
            const rel = m.attrs?.rel ? ` rel="${escapeHtml(m.attrs.rel)}"` : '';
            text = `<a href="${href}"${target}${rel}>${text}</a>`;
        }
    }
    return text;
}

function renderInline(node) {
    if (node.type === 'text') {
        const safe = escapeHtml(node.text || '');
        return renderMarks(safe, node.marks);
    }
    if (node.type === 'hardBreak') {
        return '<br/>';
    }
    return '';
}

function renderInlineOrBlock(node) {
    if (node.type === 'text' || node.type === 'hardBreak') {
        return renderInline(node);
    }
    return renderBlock(node);
}

function renderBlock(node) {
    switch (node.type) {
        case 'paragraph': {
            const inner = (node.content || []).map(renderInlineOrBlock).join('');
            return `<p>${inner || '<br/>'}</p>`;
        }
        case 'heading': {
            const level = Math.min(6, Math.max(1, Number(node.attrs?.level || 1)));
            const inner = (node.content || []).map(renderInlineOrBlock).join('');
            return `<h${level}>${inner}</h${level}>`;
        }
        case 'blockquote': {
            const inner = (node.content || []).map(renderInlineOrBlock).join('');
            return `<blockquote>${inner}</blockquote>`;
        }
        case 'codeBlock': {
            const text = (node.content || [])
                .map((n) => (n.type === 'text' ? escapeHtml(n.text || '') : ''))
                .join('');
            return `<pre><code>${text}</code></pre>`;
        }
        case 'bulletList': {
            const items = (node.content || []).map(renderBlock).join('');
            return `<ul>${items}</ul>`;
        }
        case 'orderedList': {
            const start = node.attrs?.start ? ` start="${Number(node.attrs.start)}"` : '';
            const items = (node.content || []).map(renderBlock).join('');
            return `<ol${start}>${items}</ol>`;
        }
        case 'listItem': {
            const inner = (node.content || []).map(renderInlineOrBlock).join('');
            return `<li>${inner}</li>`;
        }
        case 'horizontalRule': {
            return `<hr/>`;
        }
        default: {
            if (node.content && Array.isArray(node.content)) {
                return node.content.map(renderInlineOrBlock).join('');
            }
            return '';
        }
    }
}

function proseToHtml(doc) {
    try {
        if (!doc) return '';
        const root = typeof doc === 'string' ? JSON.parse(doc) : doc;
        const blocks = Array.isArray(root.content) ? root.content : [];
        return blocks.map(renderBlock).join('');
    } catch (e) {
        return `<p>${escapeHtml(String(doc))}</p>`;
    }
}

/* ==================== Build Custom Fields ==================== */
function buildCustomFields(payload = {}) {
    const cf = [];
    const add = (id, val) => {
        if (val !== undefined && val !== null && val !== '') {
            cf.push({ id, value: val });
        }
    };

    add(CONTENT_FIELDS.TITLE, payload.titleCF);
    add(CONTENT_FIELDS.SUMMARY, payload.summary);

    if (payload.dateOfPublication) {
        add(CONTENT_FIELDS.DATE_OF_PUBLICATION, formatDateToDDMMYYYY(payload.dateOfPublication));
    }

    add(CONTENT_FIELDS.CONTENT, payload.content); // plain only
    add(CONTENT_FIELDS.MEDIA_TYPE, payload.mediaType);
    add(CONTENT_FIELDS.META_DESCRIPTION, payload.metaDescription);
    add(CONTENT_FIELDS.META_TITLE, payload.metaTitle);
    add(CONTENT_FIELDS.IDENTIFIER, payload.identifier);

    return cf;
}

/* ==================== Controller ==================== */
async function handleDotcmsToWrikeUpdate(req, res) {
    try {
        console.log('[dotcms-to-wrike-update] Payload:', JSON.stringify(req.body, null, 2));
    } catch {
        console.log('[dotcms-to-wrike-update] Payload (non-serializable)');
    }

    const { taskId, storyBlock, ...fields } = req.body || {};
    if (!taskId) return res.status(400).json({ error: 'taskId is required' });

    try {
        const raw = String(taskId).trim();
        let apiTaskId = raw;

        // resolve permalink ID → API id
        if (isPermalinkId(raw)) {
            const permalinkUrl = `https://www.wrike.com/open.htm?id=${encodeURIComponent(raw)}`;
            const searchResp = await wrikeApiClient.get('/tasks', {
                params: { permalink: permalinkUrl },
                headers: { Accept: 'application/json' },
            });
            const found = searchResp.data?.data?.[0];
            if (!found?.id) {
                return res.status(404).json({ ok: false, message: `Task ${raw} not found`, wrike: searchResp.data });
            }
            apiTaskId = found.id;
        }

        if (fields.mediaType) {
            fields.mediaType = capitalizeFirst(String(fields.mediaType));
        }

        const customFields = buildCustomFields(fields);

        // генеруємо HTML з storyBlock
        let descriptionHtml = null;
        if (storyBlock) {
            descriptionHtml = proseToHtml(storyBlock);
        }

        if (!customFields.length && !descriptionHtml) {
            return res.status(400).json({ ok: false, error: 'No fields or storyBlock provided' });
        }

        const updateBody = {};
        if (customFields.length) updateBody.customFields = customFields;
        if (descriptionHtml) updateBody.description = descriptionHtml;

        const updateResp = await wrikeApiClient.put(
            `/tasks/${encodeURIComponent(apiTaskId)}`,
            updateBody,
            { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
        );

        return res.status(200).json({
            ok: true,
            taskId: apiTaskId,
            updated: updateResp.data?.data?.[0] || null,
        });
    } catch (err) {
        const status = err.response?.status || 500;
        return res.status(status).json({
            ok: false,
            message: 'Failed to update Wrike ticket',
            error: err.message,
            wrike: err.response?.data,
        });
    }
}

module.exports = { handleDotcmsToWrikeUpdate };
