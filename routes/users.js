const router = require('express').Router();
const { protect }    = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const User           = require('../models/User'); // <-- direct Mongoose model import

/* ---------------------------------------------
   mailer (best-effort)
---------------------------------------------- */
let sendMail = async () => {};
try {
  const mail = require('../config/mailer');
  if (typeof mail?.sendMail === 'function') {
    sendMail = mail.sendMail;
  } else if (mail?.transporter?.sendMail) {
    sendMail = mail.transporter.sendMail.bind(mail.transporter);
  }
} catch (e) {
  console.error('⚠️ Mailer not configured properly:', e.message);
}

/* ---------------------------------------------
   constants / helpers
---------------------------------------------- */
const authorised     = allowRoles('admin','superadmin');
const ALLOWED_ROLES  = ['student','warden','gatekeeper','vc-office','guest-house','admin','superadmin'];
const HOSTEL_TYPES   = ['hostler','non-hostler'];

const getUserId = (req) => String(req.user?.id || req.user?._id || '');

function genSimplePassword(len = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** Normalize to 92xxxxxxxxxx (Pakistan) */
function normalizePKPhone(v) {
  if (v === undefined || v === null) return undefined;
  let d = String(v).replace(/\D/g, '');
  if (!d) return undefined;
  if (d.startsWith('0092')) d = '92' + d.slice(4);
  else if (d.startsWith('0')) d = '92' + d.slice(1);
  if (!d.startsWith('92') && d.length === 10) d = '92' + d;
  return d;
}

function renderWelcomeEmail({ name, email, tempPassword }) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45">
      <h2 style="margin:0 0 10px">Your account is ready</h2>
      <p>Hi ${name ? name.split(' ')[0] : 'there'},</p>
      <p>An account has been created for you.</p>
      <ul>
        <li><b>Email</b>: ${email}</li>
        <li><b>Temporary password</b>: <code>${tempPassword}</code></li>
      </ul>
      <p>Please sign in; you will be asked to set a new password.</p>
      <p style="opacity:.7">If you didn’t expect this, please contact support.</p>
    </div>
  `;
}
function renderResetEmail({ name, email, tempPassword }) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45">
      <h2 style="margin:0 0 10px">Password reset</h2>
      <p>Hi ${name ? name.split(' ')[0] : 'there'},</p>
      <p>Your password has been reset by an administrator.</p>
      <ul>
        <li><b>Email</b>: ${email}</li>
        <li><b>Temporary password</b>: <code>${tempPassword}</code></li>
      </ul>
      <p>Please sign in and set a new password when prompted.</p>
    </div>
  `;
}

/* ============ SELF (no admin required) ============ */

/** Get the current authenticated user (safe fields) */
router.get('/me', protect, async (req, res) => {
  try {
    const u = await User.findById(getUserId(req)).select('-password -otpHash -otpExpires');
    if (!u) return res.status(404).json({ msg: 'User not found' });
    res.json(u);
  } catch (e) {
    res.status(500).json({ msg: 'Server error' });
  }
});

/** Get current user's saved guardians */
router.get('/me/guardians', protect, async (req, res) => {
  try {
    const u = await User.findById(getUserId(req)).select('guardians_info guardian_contact role');
    if (!u) return res.status(404).json({ msg: 'User not found' });

    const arr = Array.isArray(u.guardians_info) ? u.guardians_info : [];
    res.json({
      guardians: arr,
      guardians_info: arr,
      user: { guardians_info: arr },
      guardian_contact: u.guardian_contact || null
    });
  } catch (e) {
    res.status(500).json({ msg: 'Server error' });
  }
});

/** Alias: /api/users/guardians */
router.get('/guardians', protect, async (req, res) => {
  try {
    const u = await User.findById(getUserId(req)).select('guardians_info guardian_contact');
    if (!u) return res.status(404).json({ msg: 'User not found' });

    const arr = Array.isArray(u.guardians_info) ? u.guardians_info : [];
    res.json({
      guardians: arr,
      guardians_info: arr,
      user: { guardians_info: arr },
      guardian_contact: u.guardian_contact || null
    });
  } catch (e) {
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ============ LIST (admin/superadmin) ============ */
router.get('/', protect, authorised, async (req,res) => {
  try {
    const { q = '', role, verified, hostelType } = req.query;
    const filter = {};
    if (q) {
      const r = { $regex: String(q), $options: 'i' };
      filter.$or = [{ name: r }, { email: r }, { studentId: r }, { role: r }];
    }
    if (role) filter.role = role;
    if (verified === 'true')  filter.verified = true;
    if (verified === 'false') filter.verified = false;
    if (hostelType && HOSTEL_TYPES.includes(hostelType)) filter.hostelType = hostelType;

    const users = await User.find(filter)
      .select('-password -otpHash -otpExpires')
      .sort({ role: 1, name: 1 });

    res.json(users);
  } catch (e) {
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ============ VERIFY (admin/superadmin) ============ */
router.patch('/:id/verify', protect, authorised, async (req,res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ msg: 'User not found' });
    if (u.verified) return res.status(409).json({ msg: 'Already verified' });
    u.verified = true;
    await u.save();
    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ============ UPDATE (admin/superadmin) ============ */
router.put('/:id', protect, authorised, async (req,res) => {
  try {
    const {
      name,
      email,
      role,            // optional change
      studentId,       // optional change
      hostelType,      // optional change
      guardian_contact,
      guardians_info
    } = req.body;

    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ msg: 'User not found' });

    if ((u.role === 'superadmin' || role === 'superadmin') && req.user.role !== 'superadmin')
      return res.status(403).json({ msg: 'Only superadmin may modify superadmin accounts' });

    if (role && !ALLOWED_ROLES.includes(role))
      return res.status(400).json({ msg: 'Invalid role' });

    const targetRole = role ?? u.role;

    if (targetRole === 'student' && (studentId === undefined ? !u.studentId : !String(studentId).trim()))
      return res.status(400).json({ msg: 'studentId is required for student role' });

    if (targetRole === 'student') {
      const finalHostelType = hostelType ?? u.hostelType;
      if (!HOSTEL_TYPES.includes(finalHostelType || ''))
        return res.status(400).json({ msg: 'hostelType must be hostler or non-hostler' });
    }

    if (name  !== undefined) u.name  = String(name).trim();
    if (email !== undefined) u.email = String(email).trim().toLowerCase();
    if (role  !== undefined) u.role  = role;

    if (targetRole === 'student') {
      if (studentId !== undefined) u.studentId = String(studentId).trim();
      if (hostelType !== undefined) u.hostelType = hostelType;
      if (guardian_contact !== undefined) {
        const normalized = normalizePKPhone(guardian_contact);
        u.guardian_contact = normalized ?? null;
      }
      if (Array.isArray(guardians_info)) {
        u.guardians_info = guardians_info
          .map(g => ({
            name:    (g.name||'').trim(),
            relation:(g.relation||'').trim(),
            contact: normalizePKPhone(g.contact) || null,
          }))
          .filter(g => g.name || g.contact)
          .slice(0,5);
      }
    } else {
      u.studentId = undefined;
      u.hostelType = undefined;
      u.guardian_contact = null;
      u.guardians_info = [];
    }

    await u.save();
    const { password, otpHash, otpExpires, ...safe } = u.toObject();
    res.json(safe);
  } catch (e) {
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ============ CREATE (admin/superadmin) ============ */
router.post('/', protect, authorised, async (req,res) => {
  try {
    const {
      name, email, role, studentId,
      hostelType,
      guardian_contact,
      guardians_info = []
    } = req.body;

    if (!name || !email || !ALLOWED_ROLES.includes(role))
      return res.status(400).json({ msg: 'name, email, role are required' });

    if (role === 'student') {
      if (!studentId) return res.status(400).json({ msg: 'studentId is required for student role' });
      if (!HOSTEL_TYPES.includes(hostelType || ''))
        return res.status(400).json({ msg: 'hostelType must be hostler or non-hostler' });
    }

    const emailNorm    = String(email).trim().toLowerCase();
    const tempPassword = genSimplePassword(6);

    const payload = {
      name: String(name).trim(),
      email: emailNorm,
      role,
      password: tempPassword,
      verified: true,
      mustChangePassword: true,
    };

    if (role === 'student') {
      payload.studentId = String(studentId).trim();
      payload.hostelType = hostelType;
      payload.guardian_contact = normalizePKPhone(guardian_contact) ?? null;
      payload.guardians_info = (guardians_info||[])
        .map(g => ({
          name:(g.name||'').trim(),
          relation:(g.relation||'').trim(),
          contact: normalizePKPhone(g.contact) || null,
        }))
        .filter(g => g.name || g.contact)
        .slice(0,5);
    }

    const doc = await User.create(payload);

    try {
      await sendMail({
        to: emailNorm,
        subject: 'Your account has been created',
        html: renderWelcomeEmail({ name: doc.name, email: emailNorm, tempPassword }),
      });
    } catch (mailErr) {
      console.error('Email send failed (create):', mailErr.message);
    }

    const { password, otpHash, otpExpires, ...safe } = doc.toObject();
    res.status(201).json(safe);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ msg: 'Duplicate email or studentId' });
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ============ BULK CREATE (admin/superadmin) ============ */
router.post('/bulk', protect, authorised, async (req,res) => {
  try {
    const { users = [] } = req.body;
    const created = [], skipped = [];
    for (const r of users) {
      try {
        const {
          name, email, role, studentId,
          hostelType,
          guardian_contact,
          guardians_info = []
        } = r;

        if (!name || !email || !ALLOWED_ROLES.includes(role)) { skipped.push({ email, reason: 'invalid fields' }); continue; }
        if (role === 'student') {
          if (!studentId) { skipped.push({ email, reason: 'missing studentId' }); continue; }
          if (!HOSTEL_TYPES.includes(hostelType || '')) { skipped.push({ email, reason: 'invalid hostelType' }); continue; }
        }

        const emailNorm    = String(email).trim().toLowerCase();
        const tempPassword = genSimplePassword(6);

        const payload = {
          name: String(name).trim(),
          email: emailNorm,
          role,
          password: tempPassword,
          verified: true,
          mustChangePassword: true,
        };

        if (role === 'student') {
          payload.studentId = String(studentId).trim();
          payload.hostelType = hostelType;
          payload.guardian_contact = normalizePKPhone(guardian_contact) ?? null;
          payload.guardians_info = (guardians_info||[])
            .map(g => ({
              name:(g.name||'').trim(),
              relation:(g.relation||'').trim(),
              contact: normalizePKPhone(g.contact) || null,
            }))
            .filter(g => g.name || g.contact)
            .slice(0,5);
        }

        const doc = await User.create(payload);
        created.push({ _id: doc._id, email: doc.email });

        try {
          await sendMail({
            to: emailNorm,
            subject: 'Your account has been created',
            html: renderWelcomeEmail({ name: doc.name, email: emailNorm, tempPassword }),
          });
        } catch (mailErr) {
          console.error('Email send failed (bulk row):', emailNorm, mailErr.message);
        }
      } catch (e) {
        if (e.code === 11000) skipped.push({ email: r.email, reason: 'duplicate' });
        else skipped.push({ email: r.email, reason: 'error' });
      }
    }
    res.status(201).json({ created, skipped });
  } catch (e) {
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ============ RESET PASSWORD (admin/superadmin) ============ */
router.post('/:id/reset-password', protect, authorised, async (req,res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const tempPassword = genSimplePassword(6);
    user.password = tempPassword;
    user.mustChangePassword = true;
    await user.save();

    try {
      await sendMail({
        to: user.email,
        subject: 'Password reset (temporary password inside)',
        html: renderResetEmail({ name: user.name, email: user.email, tempPassword }),
      });
    } catch (mailErr) {
      console.error('Email send failed (reset):', mailErr.message);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ============ DELETE (admin/superadmin) ============ */
router.delete('/:id', protect, authorised, async (req,res) => {
  try {
    if (String(getUserId(req)) === req.params.id)
      return res.status(400).json({ msg: 'You cannot delete your own account' });

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ msg: 'User not found' });

    if (target.role === 'superadmin' && req.user.role !== 'superadmin')
      return res.status(403).json({ msg: 'Only superadmin can delete superadmin' });

    if (target.role === 'superadmin') {
      const count = await User.countDocuments({ role: 'superadmin' });
      if (count <= 1) return res.status(409).json({ msg: 'Cannot delete the last superadmin' });
    }

    await target.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
