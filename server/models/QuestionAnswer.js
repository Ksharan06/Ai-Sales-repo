const mongoose = require('mongoose');

const questionAnswerSchema = new mongoose.Schema({
  questionId:   { type: String, required: true, unique: true },
  sessionId:    { type: String, required: true },
  userId:       { type: String, required: true },
  userName:     { type: String, required: true },
  slideNumber:  { type: Number, required: true },
  questionText: { type: String, required: true },
  answerText:   { type: String, default: null },
  status:       { type: String, enum: ['pending', 'processing', 'answered', 'failed'], default: 'pending' },
  durationMs:   { type: Number, default: null },
  createdAt:    { type: Date, default: Date.now },
  answeredAt:   { type: Date, default: null }
});

questionAnswerSchema.index({ sessionId: 1, slideNumber: 1 });

module.exports = mongoose.model('QuestionAnswer', questionAnswerSchema);
