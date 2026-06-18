const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true },
  status: { 
    type: String, 
    enum: ['initializing', 'active', 'completed'], 
    default: 'initializing' 
  },
  currentSlide: { type: Number, default: 1 },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date },
  participants: [{
    userId: { type: String, required: true },
    socketId: { type: String, required: true },
    joinedAt: { type: Date, default: Date.now }
  }]
});

module.exports = mongoose.model('Session', SessionSchema);
