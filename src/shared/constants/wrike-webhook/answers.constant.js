const {formatUsDateTime} = require( "../../utils/wrike-webhook/time-format.util" );

const MSG = {
    alreadyCreated: (iso) => `⚠️ Article already created on ${formatUsDateTime(iso)}.`,
    created: 'Article created ✅',
    pleaseCreateFirst: 'Please create article first❗',
    updated: 'Article updated 📝',
    noChanges: (sinceIso) => `Nothing to update — no changes detected since ${formatUsDateTime(sinceIso)}.❗️`,
    updateStarting:  `⏳ Starting update. This may take a while...`,

};
module.exports = {MSG};