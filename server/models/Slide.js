const mongoose = require('mongoose');

const SlideSchema = new mongoose.Schema({
  lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true },
  slideNumber: { type: Number, required: true },
  imageUrl: { type: String, required: true },
  extractedText: { type: String, default: '' },
  narrationText: { type: String, default: '' },
  narrationAudioUrl: { type: String, default: '' },
  quizIntroAudioUrl: { type: String, default: '' },
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz' },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed'], 
    default: 'pending' 
  }
});

module.exports = mongoose.model('Slide', SlideSchema);
