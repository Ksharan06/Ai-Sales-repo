const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true },
  rating: { type: Number, required: true },
  feedbackText: { type: String, default: '' },
  engagementRating: { type: String, required: true },
  understandingRating: { type: String, required: true },
  recommendation: { type: String, required: true },
  submittedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Feedback', FeedbackSchema);
