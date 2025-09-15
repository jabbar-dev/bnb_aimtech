// backend/middleware/auth.js
const jwt  = require('jsonwebtoken');
const User = require('../models/User');

// Routes allowed while mustChangePassword = true
const EXEMPT = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/send-otp',
  '/api/auth/verify-otp',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/change-password-first',
];

exports.protect = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ msg: 'User no longer exists' });
    }

    // Optional: still block unverified accounts on protected routes
    if (!user.verified) {
      return res.status(403).json({ msg: 'Account not verified' });
    }

    // Enforce first-login password change (but allow exempt auth routes)
    const url = req.originalUrl || req.url || '';
    const isExempt = EXEMPT.some(p => url.startsWith(p));
    if (user.mustChangePassword && !isExempt) {
      return res.status(428).json({
        msg: 'Password change required',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('JWT error:', err.message);
    res.status(401).json({ msg: 'Token is not valid' });
  }
};
