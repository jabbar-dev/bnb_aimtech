/**  OTP-enabled authentication routes  */
const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');
const User     = require('../models/User');
const { protect } = require('../middleware/auth');

/* ───────────── Gmail SMTP transporter ───────────── */
const mailer = nodemailer.createTransport({
  host:   'smtp.gmail.com',
  port:   587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,   // e.g. app account
    pass: process.env.SMTP_PASS    // Gmail app-password
  }
});

/* helpers */
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const normalizeHostelType = (v) => (String(v || '').trim().toLowerCase());

function sign(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

/* generate + e-mail 6-digit OTP */
async function sendOtp(user) {
  const otp = crypto.randomInt(100000, 999999).toString();
  user.otpHash    = await bcrypt.hash(otp, 10);
  user.otpExpires = Date.now() + 10 * 60 * 1000;   // 10 minutes
  await user.save();

  await mailer.sendMail({
    from:    '"BNBWU Hostel App" <' + (process.env.SMTP_USER || '') + '>',
    to:      user.email,
    replyTo: process.env.SMTP_REPLYTO || undefined,
    subject: 'Your BNBW University verification code',
    text: `
Dear ${user.name},

Your BNBW University verification code is: ${otp}

This code expires in 10 minutes.
If you did not request it, please ignore this e-mail.

Thank you.
`.trim()
  });
}

/* ─────────────────────────────────────────────── */
/* 1 · REGISTER  – create user, send OTP           */
/* ─────────────────────────────────────────────── */
router.post(
  '/register',
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid e-mail required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be ≥6 characters'),
    // Self-serve signup is for students only in most cases; keeping original roles:
    body('role').isIn(['student', 'warden', 'gatekeeper']).withMessage('Invalid role'),

    // hostelType only required/validated for students
    body('hostelType')
      .if(body('role').equals('student'))
      .custom(v => ['hostler','non-hostler'].includes(normalizeHostelType(v)))
      .withMessage('hostelType must be hostler or non-hostler'),

    body('studentId')
      .if(body('role').equals('student'))
      .notEmpty().withMessage('Student ID required')
      .bail()
      .matches(/^[A-Za-z0-9]+$/).withMessage('Student ID must be alphanumeric')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ msg: errors.array()[0].msg });

    const name        = req.body.name;
    const email       = normalizeEmail(req.body.email);
    const password    = req.body.password;
    const role        = req.body.role;
    const studentId   = req.body.studentId;
    const hostelType  = normalizeHostelType(req.body.hostelType); // ← NEW

    try {
      if (await User.findOne({ email }))
        return res.status(400).json({ msg: 'E-mail already registered' });

      if (role === 'student' && await User.findOne({ studentId }))
        return res.status(400).json({ msg: 'Student ID already in use' });

      const user = await User.create({
        name,
        email,
        password,
        role,
        ...(role === 'student' && { studentId, hostelType })   // ← persist hostel type for students
      });

      await sendOtp(user);
      res.json({ ok: true, email: user.email, msg: 'OTP sent to e-mail' });
    } catch (err) {
      console.error('Register error:', err.message);
      res.status(500).json({ msg: 'Server error' });
    }
  }
);

/* ─────────────────────────────────────────────── */
/* 2 · RESEND OTP                                  */
/* ─────────────────────────────────────────────── */
router.post('/send-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const user  = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: 'User not found' });
    await sendOtp(user);
    res.json({ ok: true, msg: 'OTP resent' });
  } catch (err) {
    console.error('send-otp error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ─────────────────────────────────────────────── */
/* 3 · VERIFY OTP                                  */
/* ─────────────────────────────────────────────── */
router.post('/verify-otp', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp   = String(req.body.otp || '');

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    if (!user.otpExpires || user.otpExpires < Date.now())
      return res.status(400).json({ msg: 'OTP expired' });

    const ok = await bcrypt.compare(otp, user.otpHash || '');
    if (!ok) return res.status(400).json({ msg: 'Invalid OTP' });

    user.verified   = true;
    user.otpHash    = undefined;
    user.otpExpires = undefined;
    await user.save();

    const token = sign(user);
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        ...(user.role === 'student' && { studentId: user.studentId, hostelType: user.hostelType })
      }
    });
  } catch (err) {
    console.error('verify-otp error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ─────────────────────────────────────────────── */
/* 4 · LOGIN  (rejects unverified accounts)        */
/* ─────────────────────────────────────────────── */
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid e-mail required'),
    body('password').notEmpty().withMessage('Password required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ msg: errors.array()[0].msg });

    const email    = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    try {
      const user = await User.findOne({ email });
      if (!user || !(await user.matchPassword(password)))
        return res.status(400).json({ msg: 'Invalid credentials' });

      if (!user.verified)
        return res.status(403).json({ msg: 'Account not verified. Check your e-mail.' });

      const token = sign(user);
      res.json({
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          ...(user.role === 'student' && { studentId: user.studentId, hostelType: user.hostelType })
        },
        requiresPasswordChange: !!user.mustChangePassword,  // FE should redirect if true
      });
    } catch (err) {
      console.error('Login error:', err.message);
      res.status(500).json({ msg: 'Server error' });
    }
  }
);

/* ─────────────────────────────────────────────── */
/* 5 · FIRST-LOGIN: set new password               */
/* ─────────────────────────────────────────────── */
router.patch('/change-password-first', protect, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 6)
      return res.status(400).json({ msg: 'Password must be at least 6 characters' });

    req.user.password = newPassword;      // will hash via pre-save
    req.user.mustChangePassword = false;
    await req.user.save();

    const token = sign(req.user);         // optional: issue fresh token
    res.json({ ok: true, token });
  } catch (e) {
    console.error('change-password-first:', e);
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ─────────────────────────────────────────────── */
/* 6 · FORGOT-PASSWORD – send OTP                  */
/* ─────────────────────────────────────────────── */
router.post('/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) return res.status(400).json({ msg: 'E-mail required' });

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: 'No account with that e-mail' });

    await sendOtp(user);
    res.json({ ok: true, msg: 'OTP sent' });
  } catch (e) {
    console.error('forgot-password:', e);
    res.status(500).json({ msg: 'Server error' });
  }
});

/* ─────────────────────────────────────────────── */
/* 7 · RESET-PASSWORD – verify OTP + set new pwd   */
/* ─────────────────────────────────────────────── */
router.post(
  '/reset-password',
  [
    body('email').isEmail(),
    body('otp').isLength({ min: 6, max: 6 }),
    body('password').isLength({ min: 6 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ msg: 'All fields are required' });

    const email    = normalizeEmail(req.body.email);
    const otp      = String(req.body.otp || '');
    const password = String(req.body.password || '');

    try {
      const user = await User.findOne({ email });
      if (!user) return res.status(404).json({ msg: 'User not found' });

      if (!user.otpExpires || user.otpExpires < Date.now())
        return res.status(400).json({ msg: 'OTP expired – request a new one' });

      const ok = await bcrypt.compare(otp, user.otpHash || '');
      if (!ok) return res.status(400).json({ msg: 'Invalid OTP' });

      user.password   = password;          // hashed by pre-save
      user.otpHash    = undefined;
      user.otpExpires = undefined;
      await user.save();

      res.json({ ok: true, msg: 'Password reset – you may now log in.' });
    } catch (e) {
      console.error('reset-password:', e);
      res.status(500).json({ msg: 'Server error' });
    }
  }
);

module.exports = router;
