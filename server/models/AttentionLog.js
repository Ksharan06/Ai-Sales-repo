const mongoose = require('mongoose');

const attentionLogSchema = new mongoose.Schema({
  userId:         { type: String, required: true },
  sessionId:      { type: String, required: true },
  slideNumber:    { type: Number, required: true },
  attentionScore: { type: Number, required: true },
  facePresent:    { type: Boolean, required: true },
  headYaw:        { type: Number },
  headPitch:      { type: Number },
  earLeft:        { type: Number },
  earRight:       { type: Number },
  timestamp:      { type: Date, default: Date.now }
});

attentionLogSchema.index({ sessionId: 1, userId: 1 });
attentionLogSchema.index({ sessionId: 1, slideNumber: 1 });

module.exports = mongoose.model('AttentionLog', attentionLogSchema);
