const {formatUsDateTime} = require( "../../utils/wrike-webhook/time-format.util" );

const MSG = {
    alreadyCreated: `⚠️ Article already created.`,
    created: 'Article created ✅',
    pleaseCreateFirst: 'Update could not be completed. No page was created previously in DotCMS❗',
    updated: 'Article updated 📝',
    noChanges: (sinceIso) => `Nothing to update — no changes detected since ${formatUsDateTime(sinceIso)}.❗️`,
    updateStarting:  `⏳ Starting update. This may take a while...`,

};
module.exports = {MSG};