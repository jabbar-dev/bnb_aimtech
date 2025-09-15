const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

/** Singleton config:
 * hostler:     [warden ObjectId]
 * nonHostler:  [warden ObjectId]
 */
const WardenConfigSchema = new Schema({
  hostler:    [{ type: Types.ObjectId, ref: 'User' }],
  nonHostler: [{ type: Types.ObjectId, ref: 'User' }],
}, { timestamps: true, collection: 'warden_config' });

WardenConfigSchema.statics.getOrCreate = async function () {
  let doc = await this.findOne();
  if (!doc) doc = await this.create({ hostler: [], nonHostler: [] });
  return doc;
};

module.exports = mongoose.model('WardenConfig', WardenConfigSchema);
