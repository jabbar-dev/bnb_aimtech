// backend/server.js
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const connectDB          = require('./config/db');
const authRoutes         = require('./routes/auth');
const requestRoutes      = require('./routes/requests');
const guestHouseRoutes   = require('./routes/guestHouse');
const analyticsRoutes    = require('./routes/analytics');
const wardensRoutes      = require('./routes/wardens');       // NEW
const hostelConfigRoutes = require('./routes/hostelConfig');  // NEW

const app = express();

/* ───────── basics ───────── */
app.set('trust proxy', 1); // cPanel/Passenger sits in front of Node
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* ───────── DB ───────── */
connectDB();

/* ───────── helpers ─────────
   On cPanel when you create the Node app with Application URI=/api,
   requests reach your app *without* the `/api` prefix.
   To make the same build work locally AND on cPanel, we mount
   every route on both paths: "/x" and "/api/x".
---------------------------------------------------------------- */
const paths = (p) => [p, `/api${p}`];

/* ───────── static uploads ───────── */
app.use(paths('/uploads'), express.static(path.join(__dirname, 'uploads')));

/* ───────── health check ───────── */
app.get(paths('/health'), (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'dev', time: new Date() });
});

/* ───────── API routes ───────── */
app.use(paths('/auth'),         authRoutes);
app.use(paths('/requests'),     requestRoutes);
app.use(paths('/guests'),       require('./routes/guests'));
app.use(paths('/cash-challans'),require('./routes/cashChallans'));
app.use(paths('/guest-house'),  guestHouseRoutes);
app.use(paths('/analytics'),    analyticsRoutes);
app.use(paths('/users'),        require('./routes/users'));

/* NEW mounts */
app.use(paths('/wardens'),       wardensRoutes);
app.use(paths('/hostel-config'), hostelConfigRoutes);

/* (optional) 404 for API */
app.use(paths('/'), (req, res, next) => {
  // only label as 404 for API-ish requests
  if (req.path.startsWith('/api') || req.originalUrl.includes('/api')) {
    return res.status(404).json({ msg: 'Not found' });
  }
  next();
});

/* ───────── start ───────── */
const PORT = process.env.PORT || process.env.APP_PORT || 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app; // harmless for tests/Passenger
