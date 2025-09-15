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
app.set('trust proxy', 1); // Nginx sits in front of Node
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* ───────── DB ───────── */
connectDB();

/* ───────── helpers ─────────
   We mount every route on both paths so the same build works locally
   and behind cPanel/Passenger-style prefixes:
      "/x"  and  "/api/x"
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
   Anything under /api/* that wasn’t handled above returns JSON 404.
---------------------------------------------------------------- */
app.use('/api', (req, res) => {
  return res.status(404).json({ msg: 'Not found' });
});

/* ───────── Frontend (SPA) from /public ─────────
   Serve the compiled React app (CRA build/ copied into backend/public).
   IMPORTANT: this must be AFTER the API routes and BEFORE any catch-all.
---------------------------------------------------------------- */
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

app.get('*', (req, res, next) => {
  // Don’t hijack API or uploads paths; let them 404 normally if unmatched.
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ───────── start ───────── */
const PORT = process.env.PORT || process.env.APP_PORT || 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app; // harmless for tests/Passenger
