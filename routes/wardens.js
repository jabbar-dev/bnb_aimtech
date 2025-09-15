const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const User = require('../models/User');
const WardenConfig = require('../models/WardenConfig');

const authorised = allowRoles('admin','superadmin');

/** List all wardens (for picker) */
router.get('/', protect, authorised, async (req,res) => {
  const wardens = await User.find({ role: 'warden' })
    .select('_id name email')
    .sort('name');
  res.json(wardens);
});

/** Get current assignment config */
router.get('/assignments', protect, authorised, async (req,res) => {
  const cfg = await WardenConfig.getOrCreate();
  const populated = await cfg.populate([
    { path: 'hostler', select: '_id name email' },
    { path: 'nonHostler', select: '_id name email' },
  ]);
  res.json({
    hostler: populated.hostler,
    nonHostler: populated.nonHostler,
  });
});

/** Update assignments: { hostler:[ids], nonHostler:[ids] } */
router.put('/assignments', protect, authorised, async (req,res) => {
  let { hostler = [], nonHostler = [] } = req.body;
  hostler = Array.isArray(hostler) ? hostler : [];
  nonHostler = Array.isArray(nonHostler) ? nonHostler : [];

  // Validate all are wardens
  const allIds = [...new Set([...hostler, ...nonHostler])];
  if (allIds.length) {
    const count = await User.countDocuments({ _id: { $in: allIds }, role: 'warden' });
    if (count !== allIds.length)
      return res.status(400).json({ msg: 'One or more IDs are not warden accounts' });
  }

  const cfg = await WardenConfig.getOrCreate();
  cfg.hostler = hostler;
  cfg.nonHostler = nonHostler;
  await cfg.save();

  res.json({ ok: true });
});

module.exports = router;
