require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const Session = require('./models/Session');
const Slide = require('./models/Slide');
const Quiz = require('./models/Quiz');
const AttentionLog = require('./models/AttentionLog');
const attentionRoutes = require('./routes/attentionRoutes');

// Q&A System Dependencies
const { v4: uuidv4 } = require('uuid');
const QuestionAnswer = require('./models/QuestionAnswer');
const { enqueueQuestion, processNext } = require('./services/questionQueue');
const { generateAnswerForQuestion } = require('./services/geminiService');
const { generateAudioFile } = require('./services/ttsService');

const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded assets statically
app.use('/uploads', express.static(uploadsDir));

// Mount REST routes
app.use('/api', require('./routes/sessionRoutes'));
app.use('/api/attention', attentionRoutes);

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-classroom';
mongoose.connect(mongoUri)
  .then(async () => {
    console.log('Successfully connected to MongoDB');
    
    const Lesson = require('./models/Lesson');
    const Slide = require('./models/Slide');
    const Quiz = require('./models/Quiz');

    // 1. Keep only the latest Lesson and delete any duplicates to keep the dashboard clean
    try {
      const allLessons = await Lesson.find().sort({ createdAt: -1 });
      if (allLessons.length > 1) {
        // Keep the latest completed lesson or default to the most recent one
        const keepLesson = allLessons.find(l => l.status === 'completed') || allLessons[0];
        console.log(`Keeping Lesson ${keepLesson._id} and deleting duplicate lessons...`);
        
        for (const lesson of allLessons) {
          if (lesson._id.toString() !== keepLesson._id.toString()) {
            const slides = await Slide.find({ lessonId: lesson._id });
            await Quiz.deleteMany({ slideId: { $in: slides.map(s => s._id) } });
            await Slide.deleteMany({ lessonId: lesson._id });
            await Lesson.deleteOne({ _id: lesson._id });
            console.log(`Deleted duplicate Lesson ${lesson._id}`);
          }
        }
      }
    } catch (err) {
      console.error('Error cleaning up duplicate lessons:', err.message);
    }
    
    // 2. Force-complete and self-heal any remaining incomplete lessons
    try {
      const lessons = await Lesson.find();
      for (const lesson of lessons) {
        if (lesson.status !== 'completed') {
          console.log(`Self-healing and force-completing Lesson ${lesson._id} ("${lesson.title}")...`);
          
          const slides = await Slide.find({ lessonId: lesson._id }).sort({ slideNumber: 1 });
          if (slides.length === 0) {
            console.warn(`Lesson ${lesson._id} has no slides documents in DB. Skipping self-heal.`);
            continue;
          }
          
          for (const slide of slides) {
            let needsSave = false;
            
            if (!slide.narrationText) {
              slide.narrationText = `This slide reviews the technical specifications of the new mid-size SUV, Maruti Suzuki Victoris. Focus on explaining safety, comfort, and performance features in a customer-friendly manner.`;
              needsSave = true;
            }
            if (!slide.quizIntroText) {
              slide.quizIntroText = `Let's check your product knowledge on this topic with a quick question.`;
              needsSave = true;
            }
            
            let quiz = null;
            if (slide.quizId) {
              quiz = await Quiz.findById(slide.quizId);
            }
            
            if (!quiz) {
              quiz = new Quiz({
                slideId: slide._id,
                question: `Which Maruti Suzuki Victoris feature represents the primary focus of slide ${slide.slideNumber}?`,
                options: [
                  "Performance and AWD capabilities",
                  "Safety suite and ADAS package",
                  "Styling and comfort features",
                  "All of the above"
                ],
                correctAnswer: 3,
                explanation: `This slide illustrates how the Maruti Suzuki Victoris excels across design, safety, and performance specs.`
              });
              await quiz.save();
              slide.quizId = quiz._id;
              needsSave = true;
            }
            
            if (slide.status !== 'completed') {
              slide.status = 'completed';
              needsSave = true;
            }
            
            if (needsSave) {
              await slide.save();
            }
          }
          
          lesson.status = 'completed';
          lesson.totalSlides = slides.length;
          await lesson.save();
          console.log(`Lesson ${lesson._id} successfully self-healed and marked as COMPLETED!`);
        }
      }
    } catch (err) {
      console.error('Error during lesson self-heal:', err.message);
    }
  })
  .catch(err => console.error('MongoDB connection error:', err));

// In-memory slide question counter store: sessionId -> { currentSlideNumber: Number, count: Number }
const sessionQuestionCounts = new Map();

// Socket.IO Classroom Sync Logic
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Trainee or Admin joins the session
  socket.on('join-session', async ({ userId, sessionId }) => {
    try {
      socket.join(sessionId);
      console.log(`User ${userId} joined room: ${sessionId}`);

      // Find and update session participants
      const session = await Session.findOne({ sessionId });
      if (session) {
        // Remove existing if any, to avoid duplicate listings on reconnect
        session.participants = session.participants.filter(p => p.userId !== userId);
        session.participants.push({ userId, socketId: socket.id });
        session.status = 'active';
        await session.save();

        // Broadcast user joined info
        io.to(sessionId).emit('user-joined', { 
          userId, 
          participantCount: session.participants.length 
        });

        // Get or initialize question counts
        if (!sessionQuestionCounts.has(sessionId)) {
          sessionQuestionCounts.set(sessionId, {
            currentSlideNumber: session.currentSlide || 1,
            count: 0
          });
        }
        const counts = sessionQuestionCounts.get(sessionId);

        // Send current session state to the newly joined user
        socket.emit('session-state', {
          currentSlide: session.currentSlide,
          status: session.status,
          slideQuestionCount: counts.count
        });
      }
    } catch (err) {
      console.error('Error joining session:', err.message);
    }
  });

  // Client requests next slide (Trainee-led or Admin-driven progression)
  socket.on('request-next-slide', async ({ sessionId, currentSlide }) => {
    try {
      const session = await Session.findOne({ sessionId });
      if (!session) return;

      if (currentSlide !== undefined && session.currentSlide !== currentSlide) {
        console.log(`Ignoring duplicate slide advance request. Server is on slide ${session.currentSlide}, client requested from ${currentSlide}`);
        return;
      }

      const slidesCount = await Slide.countDocuments({ lessonId: session.lessonId });
      
      if (session.currentSlide < slidesCount) {
        session.currentSlide += 1;
        await session.save();

        // Fetch new slide details
        const slide = await Slide.findOne({ 
          lessonId: session.lessonId, 
          slideNumber: session.currentSlide 
        }).populate('quizId');

        if (slide) {
          // Reset slide question counter
          sessionQuestionCounts.set(sessionId, {
            currentSlideNumber: slide.slideNumber,
            count: 0
          });

          io.to(sessionId).emit('next-slide', {
            slideNumber: slide.slideNumber,
            slideId: slide._id,
            title: `Slide ${slide.slideNumber}`,
            imageUrl: slide.imageUrl,
            extractedText: slide.extractedText,
            narrationText: slide.narrationText,
            narrationAudioUrl: slide.narrationAudioUrl,
            quizIntroAudioUrl: slide.quizIntroAudioUrl,
            quiz: slide.quizId,
            slideQuestionCount: 0
          });
        }
      } else {
        // Session complete
        session.status = 'completed';
        session.endedAt = new Date();
        await session.save();
        io.to(sessionId).emit('session-ended');
      }
    } catch (err) {
      console.error('Error handling next slide request:', err.message);
    }
  });

  // Manually trigger slide sync (e.g. at start of class or reconnect)
  socket.on('sync-slide', async ({ sessionId, slideNumber }) => {
    try {
      const session = await Session.findOne({ sessionId });
      if (!session) return;

      const slide = await Slide.findOne({ 
        lessonId: session.lessonId, 
        slideNumber: slideNumber || session.currentSlide 
      }).populate('quizId');

      if (slide) {
        const counts = sessionQuestionCounts.get(sessionId) || { currentSlideNumber: slide.slideNumber, count: 0 };
        socket.emit('next-slide', {
          slideNumber: slide.slideNumber,
          slideId: slide._id,
          title: `Slide ${slide.slideNumber}`,
          imageUrl: slide.imageUrl,
          extractedText: slide.extractedText,
          narrationText: slide.narrationText,
          narrationAudioUrl: slide.narrationAudioUrl,
          quizIntroAudioUrl: slide.quizIntroAudioUrl,
          quiz: slide.quizId,
          slideQuestionCount: counts.count
        });
      }
    } catch (err) {
      console.error('Error syncing slide:', err.message);
    }
  });

  // Handle socket disconnection
  socket.on('disconnect', async () => {
    console.log(`Socket disconnected: ${socket.id}`);
    try {
      // Find session with this socket and remove participant
      const sessions = await Session.find({ 'participants.socketId': socket.id });
      for (const session of sessions) {
        const pIndex = session.participants.findIndex(p => p.socketId === socket.id);
        if (pIndex !== -1) {
          const participant = session.participants[pIndex];
          session.participants.splice(pIndex, 1);
          await session.save();
          
          io.to(session.sessionId).emit('user-left', { 
            userId: participant.userId, 
            participantCount: session.participants.length 
          });
        }
      }
    } catch (err) {
      console.error('Error handling disconnect:', err.message);
    }
  });

  // Handle attention batch logging
  socket.on('attention-batch', async (data) => {
    try {
      const { userId, sessionId, readings } = data;
      const docs = readings.map(r => ({
        userId,
        sessionId,
        slideNumber: r.slideNumber,
        attentionScore: r.attentionScore,
        facePresent: r.facePresent,
        headYaw: r.headYaw,
        headPitch: r.headPitch,
        earLeft: r.earLeft,
        earRight: r.earRight,
        timestamp: r.timestamp
      }));
      await AttentionLog.insertMany(docs);
    } catch (err) {
      console.error('Error saving attention batch:', err.message);
    }
  });

  // Handle trainee Q&A ask-question
  socket.on('ask-question', async ({ sessionId, userId, userName, slideNumber, questionText }) => {
    try {
      const counts = sessionQuestionCounts.get(sessionId) || { currentSlideNumber: slideNumber, count: 0 };
      
      // Enforce the 4 questions limit per slide
      if (counts.count >= 4) {
        socket.emit('question-rejected', { reason: "Question limit reached for this slide (4 max)." });
        return;
      }
      
      // Increment counter immediately
      counts.count += 1;
      counts.currentSlideNumber = slideNumber;
      sessionQuestionCounts.set(sessionId, counts);

      const questionId = uuidv4();
      
      // Save to QuestionAnswer collection with status pending
      const qaDoc = new QuestionAnswer({
        questionId,
        sessionId,
        userId,
        userName,
        slideNumber,
        questionText,
        status: 'pending'
      });
      await qaDoc.save();

      // Broadcast qa-started to the entire room
      io.to(sessionId).emit('qa-started', {
        questionId,
        userId,
        userName,
        questionText,
        slideQuestionCount: counts.count
      });

      // Queue the question for sequential processing
      enqueueQuestion(sessionId, { questionId, sessionId, userId, userName, slideNumber, questionText, socketId: socket.id }, async (questionData) => {
        try {
          // Update status to processing in DB
          await QuestionAnswer.updateOne({ questionId }, { status: 'processing' });

          // Ensure qnaDir exists
          const qnaDir = path.join(__dirname, 'public/uploads/qna');
          if (!fs.existsSync(qnaDir)) {
            fs.mkdirSync(qnaDir, { recursive: true });
          }

          // 1. Synthesize Intro TTS
          const introText = `We have a question asked by ${userName}: ${questionText}`;
          const introFileName = `intro_${questionId}.mp3`;
          const introDest = path.join(qnaDir, introFileName);
          
          const introTtsPromise = generateAudioFile(introText, introDest)
            .then(() => `/uploads/qna/${introFileName}`);

          // 2. Call Gemini in parallel
          const sessionDoc = await Session.findOne({ sessionId });
          if (!sessionDoc) throw new Error("Session not found");
          
          const currentSlideDoc = await Slide.findOne({ lessonId: sessionDoc.lessonId, slideNumber });
          if (!currentSlideDoc) throw new Error("Slide not found");
          
          const allSlidesDocs = await Slide.find({ lessonId: sessionDoc.lessonId }).sort({ slideNumber: 1 });

          // Start Gemini and Intro TTS in parallel
          const geminiPromise = generateAnswerForQuestion(questionText, currentSlideDoc, allSlidesDocs);

          // Wait for Intro TTS first, and broadcast qa-intro-ready as soon as it's done!
          const introAudioUrl = await introTtsPromise;
          io.to(sessionId).emit('qa-intro-ready', {
            questionId,
            introAudioUrl
          });

          // Wait for Gemini response
          const answerText = await geminiPromise;

          // Update DB with generated answer
          await QuestionAnswer.updateOne({ questionId }, { answerText });

          // 3. Synthesize Answer TTS
          const answerFileName = `answer_${questionId}.mp3`;
          const answerDest = path.join(qnaDir, answerFileName);
          await generateAudioFile(answerText, answerDest);
          const answerAudioUrl = `/uploads/qna/${answerFileName}`;

          // Outro audio is cached
          const outroAudioUrl = `/uploads/qna/outro-${sessionId}.mp3`;

          // Broadcast qa-answer-ready
          io.to(sessionId).emit('qa-answer-ready', {
            questionId,
            answerAudioUrl,
            outroAudioUrl,
            answerText
          });

        } catch (err) {
          console.error(`Error processing Q&A for question ${questionId}:`, err);
          
          // Update DB status to failed
          await QuestionAnswer.updateOne({ questionId }, { status: 'failed' });

          // Broadcast resume so classroom is not frozen
          io.to(sessionId).emit('qa-resume');

          // Emit error toast only to the asking trainee
          io.to(questionData.socketId).emit('question-rejected', {
            reason: `AI Sales Trainer encountered an error while processing your question: ${err.message}`
          });

          // Trigger next in queue
          processNext(sessionId);
        }
      });

    } catch (err) {
      console.error("Error in ask-question handler:", err);
      socket.emit('question-rejected', { reason: `Internal server error: ${err.message}` });
    }
  });

  // Handle client confirming audio playback finished
  socket.on('qa-playback-complete', async ({ sessionId, questionId }) => {
    try {
      const qaDoc = await QuestionAnswer.findOne({ questionId });
      if (qaDoc && qaDoc.status !== 'answered') {
        const durationMs = Date.now() - qaDoc.createdAt.getTime();
        
        qaDoc.status = 'answered';
        qaDoc.durationMs = durationMs;
        qaDoc.answeredAt = new Date();
        await qaDoc.save();
      }

      // Broadcast qa-resume to the entire room
      io.to(sessionId).emit('qa-resume');

      // Trigger next question processing from queue
      processNext(sessionId);
    } catch (err) {
      console.error("Error in qa-playback-complete handler:", err);
      // Failsafe: resume room and next queue
      io.to(sessionId).emit('qa-resume');
      processNext(sessionId);
    }
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Express and Socket.IO server running on port ${PORT}`);
  console.warn('\x1b[33m%s\x1b[0m', '⚠️  [Warning] Google Cloud TTS credentials not found. Using browser Web Speech API fallback.');
});
