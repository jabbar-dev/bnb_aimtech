// backend/models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const GuardianSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    relation: { type: String, trim: true },
    contact: { type: String, trim: true }, // normalized 92xxxxxxxxxx
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    email:       { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:    { type: String, required: true }, // keep selectable for login
    role:        { type: String, enum: ['student','warden','gatekeeper','vc-office','guest-house','admin','superadmin'], default: 'student' },
    verified:    { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: false },

    // student fields
    studentId:   { type: String, index: true, sparse: true, trim: true },
    hostelType:  { type: String, enum: ['hostler','non-hostler'] },
    guardian_contact: { type: String, trim: true },
    guardians_info:   { type: [GuardianSchema], default: [] },

    // OTP / verification (optional compatibility)
    otpHash:     { type: String },
    otpExpires:  { type: Date },
  },
  { timestamps: true }
);

/* Hide sensitive fields on JSON responses */
UserSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.password;
    delete ret.otpHash;
    delete ret.otpExpires;
    return ret;
  }
});

/* Hash password if modified */
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(String(this.password), salt);
    next();
  } catch (err) {
    next(err);
  }
});

/* Methods: keep both names for compatibility */
UserSchema.methods.comparePassword = function(plain) {
  return bcrypt.compare(String(plain), this.password);
};
UserSchema.methods.matchPassword = function(entered) {
  return bcrypt.compare(String(entered), this.password);
};

module.exports = mongoose.model('User', UserSchema);
