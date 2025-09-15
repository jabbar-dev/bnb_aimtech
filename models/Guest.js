/*  backend/models/Guest.js  */
const mongoose = require('mongoose');

const GuestSchema = new mongoose.Schema({
  /* core info */
  name           : { type: String, required: true },
  cnic           : { type: String, match: /^\d{13}$/, required: true },
  visitingOffice : { type: String, required: true },
  vehicleNo      : { type: String, default: '-' },

  /* who registered (VC-office OR gate-keeper user) */
  gatekeeper     : { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  /* state */
  status         : { type: String, enum: ['pending', 'in', 'out'], default: 'pending' },
  inAt           : { type: Date, default: null },   // recorded when marked “in”
  outAt          : { type: Date, default: null },   // recorded when marked “out”

  createdAt      : { type: Date, default: Date.now },
});

module.exports = mongoose.model('Guest', GuestSchema);
