const express = require('express');
const { handleDotcms, handleDotcmsContent,handleDotcmsApi } = require('../controllers/dotcms/dotcms.controller');
const {dotcmsApiClient} = require("../configurations/httpClients");

const router = express.Router();

router.all('/api/vtl/:apiName', handleDotcms);

router.get('/api/content/id/:id', handleDotcmsContent);

router.get('/api/v1/:apiName', handleDotcmsApi);

module.exports = router;