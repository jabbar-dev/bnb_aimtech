/* backend/models/CashChallan.js
   Last updated — 2025‑07‑29
   – CNIC regex, min:1 on amount, OverwriteModelError‑safe             */
const mongoose = require('mongoose');

/* compile GuestHouse once to avoid circular ref errors in dev */
require('./GuestHouse');

const CashChallanSchema = new mongoose.Schema({
  challanNo     : { type: Number, required: true, unique: true },

  depositorName : { type: String,  required: true },
  depositorCnic : { type: String,  required: true, match: /^\d{13}$/ },

  amount        : { type: Number, required: true, min: 1 },
  dueDate       : { type: Date,   required: true },

  status        : { type: String, enum: ['pending', 'paid'], default: 'pending' },
  uploadedAt    : { type: Date },

  method        : { type: String, enum: ['cash', 'account', null], default: null },
  receiptFile   : { type: String }
}, { timestamps: true });

module.exports =
  mongoose.models.CashChallan ||
  mongoose.model('CashChallan', CashChallanSchema);
