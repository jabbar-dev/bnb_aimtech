// backend/routes/requests.js
const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const mongoose = require('mongoose');

const Request      = require('../models/Request');
const User         = require('../models/User');
const HostelConfig = require('../models/HostelConfig');
const WardenConfig = require('../models/WardenConfig'); // assignment source

const { protect }    = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const mailer         = require('../config/mailer');

/* ───────── ZONG SMS (CBS) — config & helpers ───────── */
const ZONG_LOGIN_ID  = process.env.ZONG_LOGIN_ID  || '';        // required
const ZONG_LOGIN_PASS= process.env.ZONG_LOGIN_PASS|| '';        // required
const ZONG_MASK      = process.env.ZONG_MASK      || 'BNBWU-SUK'; // approved mask

/** Normalize to ZONG format 92XXXXXXXXXX (no +). */
function normalizeToPK92(num) {
  if (!num) return null;
  let d = String(num).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0092')) d = '92' + d.slice(4);
  else if (d.startsWith('0')) d = '92' + d.slice(1);
  else if (!d.startsWith('92') && d.length === 10) d = '92' + d;
  return d;
}

/** Send SMS through ZONG CBS SendQuickSMS endpoint. */
async function sendSMS_ZONG(destination, message, { unicode = '0' } = {}) {
  const dest = normalizeToPK92(destination);
  if (!dest) return;

  // Guard against missing creds to avoid 401/403 loops in prod logs
  if (!ZONG_LOGIN_ID || !ZONG_LOGIN_PASS) {
    console.warn('[SMS] ZONG credentials missing. Skipping SMS send.');
    return;
  }

  const payload = {
    loginId:           ZONG_LOGIN_ID,
    loginPassword:     ZONG_LOGIN_PASS,
    Destination:       dest,
    Mask:              ZONG_MASK,
    Message:           message,
    UniCode:           unicode,          // '0' for GSM7, '1' for Unicode (Urdu etc.)
    ShortCodePrefered: 'n'
  };

  try {
    const { data } = await axios.post(
      'https://cbs.zong.com.pk/reachrestapi/home/SendQuickSMS',
      payload,
      { timeout: 15000 }
    );
    console.log('[SMS] ZONG queued ->', dest, data);
  } catch (err) {
    console.warn('[SMS] ZONG error ->', err?.response?.data || err.message);
  }
}

/* ───────── auth/role helpers ───────── */
const ensureRole = (role) => (req, res, next) =>
  req.user.role !== role
    ? res.status(403).json({ msg: 'Forbidden: insufficient privileges' })
    : next();

/* ───────── mappers & small utils ───────── */
const mapReq = (r) => {
  const base = r._doc ?? r;
  const stu  = base.student;
  return {
    _id: base._id,
    student: base.student,
    studentId: (stu && stu.studentId) ?? base.studentId ?? 'N/A',
    name:      (stu && stu.name)      ?? base.name      ?? 'N/A',
    email:     (stu && stu.email)     ?? base.email     ?? 'N/A',
    hostelType: base.hostelType,
    leaveFor:   base.leaveFor,
    pickUpWith: base.pickUpWith,
    transport:  base.transport,
    vehicleNo:  base.vehicleNo,
    driverName: base.driverName,
    dateTime:   base.dateTime,
    status:     base.status,
    wardenComment: base.wardenComment || '',
  };
};

const formatDetails = (r) => `
Reason       : ${r.leaveFor}
Leaving with : ${r.pickUpWith}
Transport    : ${r.transport}
Vehicle No   : ${r.vehicleNo}
Date & Time  : ${new Date(r.dateTime).toLocaleString()}
`.trim();

function normalizeHostelType(v) {
  const s = String(v || '').toLowerCase().trim();
  if (s === 'hostler') return 'hostler';
  if (s === 'non-hostler' || s === 'nonhostler' || s === 'non_hostler') return 'non-hostler';
  return s;
}

function toIdStrings(arr) {
  return (arr || [])
    .map(v => {
      if (!v) return null;
      if (typeof v === 'string') return v;
      if (v._id) return String(v._id);
      if (typeof v.toHexString === 'function') return v.toHexString();
      try { return String(v); } catch { return null; }
    })
    .filter(Boolean);
}

function toObjectIds(strs) {
  return Array.from(new Set(strs))
    .map(s => mongoose.isValidObjectId(s) ? new mongoose.Types.ObjectId(s) : null)
    .filter(Boolean);
}

/** Read wardens for a hostelType by scanning newest configs in ALL 3 collections. */
async function getAssignedWardensIds(hostelTypeRaw) {
  const hostelType  = normalizeHostelType(hostelTypeRaw);
  const mainField   = hostelType === 'hostler' ? 'hostler' : 'nonHostler';
  const legacyField = hostelType === 'hostler' ? 'hostlerWardenIds' : 'nonHostlerWardenIds';

  async function scan(Model, label, useLegacy = true) {
    const cfgs = await Model.find({}, null, { sort: { updatedAt: -1, createdAt: -1 }, limit: 10 }).lean();
    for (const cfg of cfgs) {
      const fromMain   = Array.isArray(cfg[mainField])   ? cfg[mainField]   : [];
      const fromLegacy = useLegacy && Array.isArray(cfg[legacyField]) ? cfg[legacyField] : [];
      const idStrings  = toIdStrings(fromMain).concat(toIdStrings(fromLegacy));
      const ids        = toObjectIds(idStrings);

      if (ids.length) {
        const wardens = await User.find({ _id: { $in: ids }, role: 'warden' }).select('_id').lean();
        if (wardens.length) return wardens.map(w => w._id);
        return ids;
      }
    }
    return [];
  }

  let ids = await scan(HostelConfig, 'hostelconfigs', true);
  if (ids.length) return ids;

  if (HostelConfig.Alt) {
    ids = await scan(HostelConfig.Alt, 'waden_config', true);
    if (ids.length) return ids;
  }

  ids = await scan(WardenConfig, 'warden_config', false);
  if (ids.length) return ids;

  const anyWardens = await User.find({ role: 'warden' }).select('_id').lean();
  return anyWardens.map(w => w._id);
}

/* ───────── 1) STUDENT ───────── */
router.post('/', protect, ensureRole('student'), async (req, res) => {
  const { leaveFor, pickUpWith, transport, vehicleNo, driverName, dateTime } = req.body;

  if (!leaveFor || !pickUpWith || !transport || !dateTime)
    return res.status(400).json({ msg: 'Missing required fields' });

  if (transport === 'private' && (!vehicleNo || !driverName))
    return res.status(400).json({ msg: 'Vehicle & driver required for private transport' });

  try {
    const student = await User.findById(req.user.id)
      .select('studentId name email hostelType')
      .lean();

    if (!student) return res.status(400).json({ msg: 'Student not found' });

    const hostelType = normalizeHostelType(student.hostelType);
    if (!['hostler', 'non-hostler'].includes(hostelType))
      return res.status(400).json({ msg: 'Your hostelType is not set (hostler / non-hostler).' });

    const wardenIds = await getAssignedWardensIds(hostelType);
    if (!wardenIds.length)
      return res.status(409).json({ msg: `No wardens configured for ${hostelType}. Please contact admin.` });

    const doc = await Request.create({
      student   : req.user.id,
      studentId : student.studentId,
      name      : student.name,
      email     : student.email,
      leaveFor, pickUpWith, transport,
      vehicleNo : transport === 'public' ? '-' : vehicleNo,
      driverName: transport === 'public' ? '-' : driverName,
      dateTime,
      hostelType,
      wardenIds,
    });

    if (mailer?.sendMail) {
      const wardens = await User.find({ _id: { $in: wardenIds } }).select('email').lean();
      const to = wardens.map(w => w.email).filter(Boolean);
      if (to.length) {
        await mailer.sendMail({
          from   : '"Hostel System (BNBWU)" <bnbaimtech@gmail.com>',
          to     : to.join(','),
          subject: 'New Leave Request Submitted',
          text   : `
Dear Warden,

A student has submitted a new leave request.

Student  : ${student.name} (${student.studentId})
E-mail   : ${student.email}
Hostel   : ${hostelType}

${formatDetails(doc)}

Please log in to approve or reject.

Thank you.
`.trim(),
        });
      }
    }

    res.status(201).json(mapReq(doc));
  } catch (e) {
    console.error('Create request error:', e);
    res.status(500).json({ msg: 'Server error' });
  }
});

/* view own */
router.get('/', protect, ensureRole('student'), async (req, res) => {
  try {
    const list = await Request.find({ student: req.user.id })
      .sort('-dateTime')
      .lean();
    res.json(list.map(mapReq));
  } catch (e) {
    console.error(e);
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ───────── 2) WARDEN ───────── */
router.get('/warden', protect, ensureRole('warden'), async (req, res) => {
  try {
    const me = new mongoose.Types.ObjectId(String(req.user._id));
    const filter = { wardenIds: { $in: [me] } };
    if (req.query.status) filter.status = req.query.status;

    const requests = await Request.find(filter)
      .sort('-dateTime')
      .populate('student', 'studentId name email hostelType')
      .lean();

    res.json(requests.map(mapReq));
  } catch (e) {
    console.error(e);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.put('/warden/:id', protect, ensureRole('warden'), async (req, res) => {
  try {
    const me = String(req.user._id);
    const doc = await Request.findById(req.params.id)
      .populate('student', 'studentId name email')
      .exec();
    if (!doc) return res.status(404).json({ msg: 'Request not found' });

    if (!doc.wardenIds.map(String).includes(me))
      return res.status(403).json({ msg: 'Not allowed for this request' });

    const { status, wardenComment } = req.body;
    if (status && !['pending','approved','rejected','in','out'].includes(status))
      return res.status(400).json({ msg: 'Invalid status' });

    if (status) doc.status = status;
    if (wardenComment !== undefined) doc.wardenComment = String(wardenComment);
    if (!doc.studentId) doc.studentId = doc.student?.studentId ?? 'N/A';

    await doc.save();

    if (mailer?.sendMail) {
      await mailer.sendMail({
        from   : '"Hostel System" <bnbaimtech@gmail.com>',
        to     : doc.student.email,
        subject: `Your leave request has been ${doc.status.toUpperCase()}`,
        text   : `
Dear ${doc.student.name},

Your leave request has been ${doc.status.toUpperCase()}.

${formatDetails(doc)}

Warden’s comment:
${doc.wardenComment || '—'}

Thank you.
`.trim(),
      });
    }

    res.json(mapReq(doc));
  } catch (e) {
    console.error(e);
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ───────── 3) GATE-KEEPER ───────── */
router.get('/gatekeeper', protect, ensureRole('gatekeeper'), async (_req, res) => {
  try {
    const list = await Request.find({ status: { $in: ['approved', 'out'] } })
      .sort('-dateTime')
      .populate('student', 'studentId name email guardian_contact')
      .lean();
    res.json(list.map(mapReq));
  } catch (e) {
    console.error(e);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.put('/gatekeeper/:id', protect, ensureRole('gatekeeper'), async (req, res) => {
  const { status } = req.body; // 'out' | 'in'
  if (!['out', 'in'].includes(status))
    return res.status(400).json({ msg: 'Bad status' });

  try {
    const doc = await Request.findById(req.params.id)
      .populate('student', 'studentId name email guardian_contact')
      .exec();
    if (!doc) return res.status(404).json({ msg: 'Not found' });

    if (status === 'out' && doc.status !== 'approved')
      return res.status(400).json({ msg: 'Only approved → out allowed' });
    if (status === 'in' && doc.status !== 'out')
      return res.status(400).json({ msg: 'Only out → in allowed' });

    doc.status = status;
    await doc.save();

    const stamp = new Date().toLocaleString();
    const transportStr =
      doc.transport === 'private'
        ? `by Private Transport (Vehicle ${doc.vehicleNo}, Driver ${doc.driverName})`
        : 'by Public Transport';

    const smsBody =
      status === 'out'
        ? `Dear Parent/Guardian, ${doc.student.name} (${doc.student.studentId}) has LEFT Begum Nusrat Bhutto Women University ${transportStr}. Reason: ${doc.leaveFor}. on ${stamp}`
        : `Dear Parent/Guardian, ${doc.student.name} (${doc.student.studentId}) has RETURNED and CHECKED-IN at Begum Nusrat Bhutto Women University on ${stamp}.`;

    // Send ONLY to guardian_contact (no master number)
    const guardian = doc.student.guardian_contact
      ?? (await User.findById(doc.student._id).select('guardian_contact').lean())?.guardian_contact;

    if (guardian) await sendSMS_ZONG(guardian, smsBody);

    res.json(mapReq(doc));
  } catch (e) {
    console.error(e);
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ───────── 4) ADMIN / SUPERADMIN ───────── */
router.get('/admin', protect, allowRoles('admin', 'superadmin'), async (_req, res) => {
  try {
    const list = await Request.find()
      .sort('-dateTime')
      .populate('student', 'studentId name email hostelType')
      .lean();
    res.json(list.map(mapReq));
  } catch (e) {
    console.error(e);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
