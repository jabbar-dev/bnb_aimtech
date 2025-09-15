const mongoose = require('mongoose');

const HostelConfigSchema = new mongoose.Schema({
  hostler:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  nonHostler:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // legacy/back-compat
  hostlerWardenIds:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  nonHostlerWardenIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

// Primary model -> default collection "hostelconfigs"
const HostelConfig =
  mongoose.models.HostelConfig ||
  mongoose.model('HostelConfig', HostelConfigSchema);

// Fallback model -> explicit collection "waden_config"
const WadenConfig =
  mongoose.models.WadenConfig ||
  mongoose.model('WadenConfig', HostelConfigSchema, 'waden_config');

// Expose fallback from the main export so existing `require` keeps working
HostelConfig.Alt = WadenConfig;

module.exports = HostelConfig;
