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
app.set('trust proxy', 1); // behind Nginx/Passenger
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* ───────── DB ───────── */
connectDB();

/* ───────── helpers ─────────
   Mount every route on both paths so the same build works
   locally and behind /api prefixes: "/x" and "/api/x".
---------------------------------------------------------------- */
const paths = (p) => [p, `/api${p}`];

/* ───────── static uploads ───────── */
app.use(paths('/uploads'), express.static(path.join(__dirname, 'uploads')));

/* ───────── health check ───────── */
app.get(paths('/health'), (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'dev', time: new Date() });
});

/* ───────── API routes ───────── */
app.use(paths('/auth'),          authRoutes);
app.use(paths('/requests'),      requestRoutes);
app.use(paths('/guests'),        require('./routes/guests'));
app.use(paths('/cash-challans'), require('./routes/cashChallans'));
app.use(paths('/guest-house'),   guestHouseRoutes);
app.use(paths('/analytics'),     analyticsRoutes);
app.use(paths('/users'),         require('./routes/users'));

/* NEW mounts */
app.use(paths('/wardens'),        wardensRoutes);
app.use(paths('/hostel-config'),  hostelConfigRoutes);

/* ───────── API 404 (JSON) ─────────
   Anything under /api/* that wasn’t handled above → JSON 404.
---------------------------------------------------------------- */
app.use('/api', (req, res) => {
  return res.status(404).json({ msg: 'Not found' });
});

/* ───────── Frontend (SPA) from /public ─────────
   Serve compiled React app from backend/public.
   IMPORTANT: Express 5 cannot use "*" as a path; use a RegExp.
---------------------------------------------------------------- */
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// Matches any GET path NOT starting with /api or /uploads → send index.html
app.get(/^\/(?!api|uploads).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ───────── start ───────── */
const PORT = process.env.PORT || process.env.APP_PORT || 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app; // harmless for tests/Passenger
