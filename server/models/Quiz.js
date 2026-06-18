const mongoose = require('mongoose');

const QuizSchema = new mongoose.Schema({
  slideId: { type: mongoose.Schema.Types.ObjectId, ref: 'Slide', required: true },
  question: { type: String, required: true },
  options: [{ type: String, required: true }],
  correctAnswer: { type: Number, required: true }, // 0, 1, 2, or 3
  explanation: { type: String, default: '' }
});

module.exports = mongoose.model('Quiz', QuizSchema);
