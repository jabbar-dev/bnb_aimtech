const mongoose = require('mongoose');

const RequestSchema = new mongoose.Schema(
  {
    /* identity / relations */
    student:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    studentId:  { type: String, default: 'N/A' }, // fixed typo
    name:       { type: String, required: true },
    email:      { type: String, required: true },

    /* core request info */
    leaveFor:   { type: String, required: true },
    pickUpWith: { type: String, required: true },
    transport:  {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
      required: true
    },

    /* vehicle details (private transport only) */
    vehicleNo:  { type: String, required() { return this.transport === 'private'; } },
    driverName: { type: String, required() { return this.transport === 'private'; } },

    /* scheduling */
    dateTime:   { type: Date, required: true },

    /* workflow */
    status: {
      type: String,
      enum: ['pending', 'approved', 'out', 'in', 'rejected'],
      default: 'pending'
    },
    wardenComment: { type: String },

    /* routing */
    hostelType: {
      type: String,
      enum: ['hostler', 'non-hostler'],
      required: true,
      index: true
    },
    wardenIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: []
    }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Request', RequestSchema);
