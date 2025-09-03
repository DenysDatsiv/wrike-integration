function toBoolean(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 1;
    if (typeof v === 'string') return ['true','1','yes','on'].includes(v.toLowerCase());
    return false;
}

function toISODate(v) {
    if (typeof v === 'number') return new Date(v).toISOString();
    if (typeof v === 'string') {
        const d = new Date(v);
        if (!isNaN(d.getTime())) return d.toISOString();
    }
    return null;
}

module.exports = { toBoolean, toISODate };
