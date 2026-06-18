const mongoose = require('mongoose');

const AnswerSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  sessionId: { type: String, required: true },
  slideId: { type: mongoose.Schema.Types.ObjectId, ref: 'Slide', required: true },
  questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  answerIndex: { type: Number, required: true }, // 0, 1, 2, or 3
  isCorrect: { type: Boolean, required: true },
  responseTimeMs: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Answer', AnswerSchema);
