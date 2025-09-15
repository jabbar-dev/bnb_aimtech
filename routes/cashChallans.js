/* backend/routes/cashChallans.js
   Fixed — 2025‑07‑29 (ReferenceError: challanNo is not defined)
   ------------------------------------------------------------------ */
const router         = require('express').Router();
const { protect }    = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const CashChallan    = require('../models/CashChallan');
const GuestHouse     = require('../models/GuestHouse');
const upload         = require('../config/multer');

const authorised = allowRoles('gatekeeper', 'vc-office', 'admin', 'superadmin','guest-house');

/* ───────── 1. pending cash total ───────── */
router.get('/pending-total', protect, authorised, async (_req, res) => {
  const [agg] = await GuestHouse.aggregate([
    { $match: { paymentMethod: 'cash', deposited: false } },
    { $group: { _id: null, sum: { $sum: '$billAmount' } } }
  ]);
  res.json({ pending: agg?.sum || 0 });
});

/* ───────── 2. list challans ───────── */
router.get('/', protect, authorised, async (req, res) => {
  const filter = req.query.status ? { status: req.query.status } : {};
  const list   = await CashChallan.find(filter).sort('-createdAt');
  res.json(list);
});

/* ───────── 3. create challan ───────── */
router.post('/', protect, authorised, async (req, res) => {
  try {
    const {
      amount: reqAmt,
      dueDate,
      depositorName = '-',
      depositorCnic = ''
    } = req.body;

    if (!dueDate)
      return res.status(400).json({ msg: 'dueDate required' });

    if (!/^\d{13}$/.test(depositorCnic))
      return res.status(400).json({ msg: 'depositorCnic must be 13 digits' });

    /* 1️⃣  collect all unde­posited cash rows (FIFO) */
    const cashRows = await GuestHouse
      .find({ paymentMethod: 'cash', deposited: false })
      .sort('createdAt');

    const pendingCash = cashRows.reduce((s, g) => s + g.billAmount, 0);
    if (!pendingCash)
      return res.status(409).json({ msg: 'Nothing to deposit' });

    const minNeeded = reqAmt ? Number(reqAmt) : pendingCash;
    if (isNaN(minNeeded) || minNeeded < 1)
      return res.status(400).json({ msg: 'amount must be > 0' });
    if (minNeeded > pendingCash)
      return res.status(400).json({ msg: 'amount exceeds cash‑in‑hand' });

    /* 2️⃣  pick rows until total ≥ minNeeded */
    const pickedIds = [];
    let   pickedSum = 0;
    for (const r of cashRows) {
      pickedIds.push(r._id);
      pickedSum += r.billAmount;
      if (pickedSum >= minNeeded) break;
    }

    /* 3️⃣  determine next challan number (start at 100) */
    const [{ challanNo: last = 99 } = {}] = await CashChallan
      .find({ challanNo: { $type: 'number' } })
      .sort({ challanNo: -1 })
      .limit(1)
      .lean();
    const nextNo = last + 1;

    /* 4️⃣  create challan  (← fixed block) */
    const challan = await CashChallan.create({
      challanNo     : nextNo,
      depositorName,
      depositorCnic,
      amount        : pickedSum,
      dueDate,
      status        : 'pending'
    });

    /* 5️⃣  mark the picked guest rows */
    await GuestHouse.updateMany(
      { _id: { $in: pickedIds } },
      { deposited: true, cashChallanId: challan._id }
    );

    res.status(201).json(challan);
  } catch (err) {
    console.error('cash‑challan create', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ───────── 4. upload receipt & settle ───────── */
router.patch('/:id/upload',
  protect,
  authorised,
  upload.single('file'),
  async (req, res) => {
    const ch = await CashChallan.findById(req.params.id);
    if (!ch)                     return res.status(404).json({ msg: 'Not found' });
    if (ch.status !== 'pending') return res.status(409).json({ msg: 'Already settled' });

    if (req.file)
      ch.receiptFile = `/uploads/${req.file.filename}`;

    ch.status     = 'paid';
    ch.method     = 'cash';
    ch.uploadedAt = new Date();
    await ch.save();

    res.json(ch);
  }
);

module.exports = router;
