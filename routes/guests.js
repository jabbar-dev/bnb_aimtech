/*  backend/routes/guests.js  */
const router          = require('express').Router();
const { protect }     = require('../middleware/auth');
const { allowRoles }  = require('../middleware/roles');
const Guest           = require('../models/Guest');

/* One-liner: gate-keeper OR vc-office OR superadmin */
const authorised = allowRoles('gatekeeper', 'vc-office', 'admin', 'superadmin','guest-house');

/* ── CREATE ─────────────────────────────────────── */
router.post('/', protect, authorised, async (req, res) => {
  const { name, cnic, visitingOffice, vehicleNo = '-', createdAt } = req.body;

  if (!name || !cnic || !visitingOffice)
    return res.status(400).json({ msg: 'name, cnic & visitingOffice are required' });

  if (!/^\d{13}$/.test(cnic))
    return res.status(400).json({ msg: 'CNIC must be 13 digits' });

  try {
    const guest = await Guest.create({
      name, cnic, visitingOffice, vehicleNo,
      gatekeeper : req.user.id,
      status     : 'pending',
      createdAt  : createdAt || Date.now(),
    });
    res.status(201).json(guest);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ── LIST / SEARCH ─────────────────────────────── */
router.get('/', protect, authorised, async (req, res) => {
  const { q } = req.query;
  const r = q ? { $regex: q, $options: 'i' } : null;
  const filter = r ? {
    $or: [{ name:r }, { cnic:r }, { visitingOffice:r }, { vehicleNo:r }]
  } : {};

  try {
    const guests = await Guest
      .find(filter)
      .populate('gatekeeper', 'role name')   // so UI knows who created it
      .sort('-createdAt');

    res.json(guests);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ── UPDATE status → IN / OUT ──────────────────── */
router.put('/:id', protect, authorised, async (req, res) => {
  const { status } = req.body;
  if (!['in', 'out'].includes(status))
    return res.status(400).json({ msg: 'Bad status value' });

  const g = await Guest.findById(req.params.id);
  if (!g) return res.status(404).json({ msg: 'Guest not found' });

  /* record timestamps once */
  if (status === 'in'  && !g.inAt)  g.inAt  = Date.now();
  if (status === 'out' && !g.outAt) g.outAt = Date.now();

  g.status = status;
  await g.save();
  res.json(g);
});

module.exports = router;
