const mongoose = require('mongoose');

const TraineeSchema = new mongoose.Schema({
  traineeId: { type: String, required: true },       // e.g. "MS-10042"
  name:      { type: String, required: true },       // e.g. "Rahul Sharma"
  sessionId: { type: String, required: true },       // which session they joined
  joinedAt:  { type: Date, default: Date.now }
});

// Compound unique: one traineeId per session
TraineeSchema.index({ sessionId: 1, traineeId: 1 }, { unique: true });

module.exports = mongoose.model('Trainee', TraineeSchema);
