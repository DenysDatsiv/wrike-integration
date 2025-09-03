const express = require('express');
const { handleFdsQuery } = require("../controllers/back-end/backend.controller");
const router = express.Router();

router.get('/:apiName', handleFdsQuery);

module.exports = router;