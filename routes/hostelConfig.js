// backend/routes/hostelConfig.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const HostelConfig = require('../models/HostelConfig');
const User = require('../models/User');

const authorised = allowRoles('admin', 'superadmin');

/**
 * GET /api/hostel-config
 * Returns the two warden lists (populated to id, name, email)
 */
router.get('/', protect, authorised, async (req, res) => {
  try {
    const cfg = await HostelConfig.getConfig();
    await cfg.populate([
      { path: 'hostler_wardens', select: 'name email role' },
      { path: 'non_hostler_wardens', select: 'name email role' },
    ]);

    res.json({
      hostler_wardens: cfg.hostler_wardens.map(u => ({ _id: u._id, name: u.name, email: u.email })),
      non_hostler_wardens: cfg.non_hostler_wardens.map(u => ({ _id: u._id, name: u.name, email: u.email })),
    });
  } catch (e) {
    res.status(500).json({ msg: 'Server error' });
  }
});

/**
 * PUT /api/hostel-config
 * Body: { hostler_wardens: [ids], non_hostler_wardens: [ids] }
 * Validates that all IDs are users with role 'warden'
 */
router.put('/', protect, authorised, async (req, res) => {
  try {
    const { hostler_wardens = [], non_hostler_wardens = [] } = req.body;

    const ids = [...new Set([...hostler_wardens, ...non_hostler_wardens].filter(Boolean))];
    const count = await User.countDocuments({ _id: { $in: ids }, role: 'warden' });
    if (count !== ids.length) {
      return res.status(400).json({ msg: 'One or more IDs are not warden accounts' });
    }

    const cfg = await HostelConfig.getConfig();
    cfg.hostler_wardens = hostler_wardens;
    cfg.non_hostler_wardens = non_hostler_wardens;
    await cfg.save();

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
