// backend/routes/analytics.js
const router  = require('express').Router();
const { protect }    = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const controller     = require('../controllers/analytics');

router.get('/stats', protect, allowRoles('admin', 'superadmin'), controller.getStats);

module.exports = router;
