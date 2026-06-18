const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const Lesson = require('../models/Lesson');
const Slide = require('../models/Slide');
const Quiz = require('../models/Quiz');
const Session = require('../models/Session');
const Answer = require('../models/Answer');
const Feedback = require('../models/Feedback');

const { generateLessonContent, generateAnswerForQuestion } = require('../services/geminiService');
const { generateAudioFile } = require('../services/ttsService');

/**
 * GET all lessons
 */
router.get('/lessons', async (req, res) => {
  try {
    const lessons = await Lesson.find().sort({ createdAt: -1 });
    res.json(lessons);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/speech/token
 * Returns short-lived Azure Speech auth token and region
 */
router.get('/speech/token', async (req, res) => {
  try {
    const key = process.env.AZURE_TTS_KEY;
    const region = process.env.AZURE_TTS_REGION;

    if (!key || !region) {
      return res.status(500).json({ error: 'Azure Speech credentials not configured' });
    }

    const tokenUrl = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': '0'
      }
    });

    if (!tokenResponse.ok) {
      throw new Error(`Azure token request failed: ${tokenResponse.status}`);
    }

    const token = await tokenResponse.text();

    res.json({
      token: token,
      region: region
    });
  } catch (error) {
    console.error('Speech token error:', error);
    res.status(500).json({ error: 'Failed to get speech token' });
  }
});

/**
 * GET a lesson details and slides
 */
router.get('/lessons/:id', async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    
    const slides = await Slide.find({ lessonId: lesson._id })
      .populate('quizId')
      .sort({ slideNumber: 1 });
      
    res.json({ lesson, slides });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/lessons/import
 * Ingests maruti_victoris_full.pptx from workspace root and processes in the background.
 */
router.post('/lessons/import', async (req, res) => {
  try {
    const pptFileName = 'maruti_victoris_full.pptx';
    const workspaceRoot = path.resolve(__dirname, '../../'); // c:\Users\ksuja\Downloads\aisales phase1
    const pptPath = path.join(workspaceRoot, pptFileName);

    if (!fs.existsSync(pptPath)) {
      return res.status(400).json({ error: `Presentation file not found at: ${pptPath}` });
    }

    // Create a new lesson document in MongoDB
    const lesson = new Lesson({
      title: "Maruti Suzuki Victoris Product Training",
      pptName: pptFileName,
      status: 'processing'
    });
    await lesson.save();

    // Run import task in background
    runBackgroundImport(lesson._id, pptPath, workspaceRoot);

    res.status(202).json({ 
      message: 'PPT import started in background', 
      lessonId: lesson._id,
      status: 'processing'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/lessons/:id/regenerate
 * Force regeneration of Gemini content and audio for a lesson.
 */
router.post('/lessons/:id/regenerate', async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    lesson.status = 'processing';
    await lesson.save();

    // Trigger AI regeneration in background
    runBackgroundRegeneration(lesson._id);

    res.status(202).json({ 
      message: 'AI regeneration started in background', 
      lessonId: lesson._id,
      status: 'processing'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/sessions
 * Starts a new classroom session
 */
router.post('/sessions', async (req, res) => {
  try {
    const { lessonId } = req.body;
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const sessionId = uuidv4();
    const session = new Session({
      sessionId,
      lessonId,
      status: 'initializing',
      currentSlide: 1
    });
    await session.save();

    // Pre-cache outro TTS audio
    const outroText = "Let's continue where we left off.";
    const workspaceRoot = path.resolve(__dirname, '../../');
    const qnaDir = path.join(workspaceRoot, 'server/public/uploads/qna');
    if (!fs.existsSync(qnaDir)) {
      fs.mkdirSync(qnaDir, { recursive: true });
    }
    const outroDestPath = path.join(qnaDir, `outro-${sessionId}.mp3`);
    try {
      await generateAudioFile(outroText, outroDestPath);
      console.log(`Pre-cached Q&A outro audio at ${outroDestPath}`);
    } catch (ttsErr) {
      console.error(`Failed to pre-cache outro audio:`, ttsErr.message);
    }

    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET a session's state
 */
router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.sessionId }).populate('lessonId');
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/submit-answer
 * Trainee answer submission
 */
router.post('/submit-answer', async (req, res) => {
  try {
    const { userId, sessionId, slideId, questionId, answerIndex, responseTimeMs } = req.body;
    
    // Find the quiz to verify answer correctness
    const quiz = await Quiz.findById(questionId);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    const isCorrect = (quiz.correctAnswer === parseInt(answerIndex));

    const answer = new Answer({
      userId,
      sessionId,
      slideId,
      questionId,
      answerIndex: parseInt(answerIndex),
      isCorrect,
      responseTimeMs: responseTimeMs || 0
    });
    await answer.save();

    res.json({
      isCorrect,
      correctAnswer: quiz.correctAnswer,
      explanation: quiz.explanation
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/sessions/:sessionId/question
 * Handles trainee Q&A and generates TTS response
 */
router.post('/sessions/:sessionId/question', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { question, slideNumber } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // 1. Find the session
    const session = await Session.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // 2. Find current slide and all slides of this lesson
    const currentSlide = await Slide.findOne({ lessonId: session.lessonId, slideNumber });
    if (!currentSlide) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    const allSlides = await Slide.find({ lessonId: session.lessonId }).sort({ slideNumber: 1 });

    // 3. Call Gemini to generate the answer
    console.log(`Generating answer for question: "${question}" on slide ${slideNumber}`);
    const answerText = await generateAnswerForQuestion(question, currentSlide, allSlides);

    // 4. Generate audio file for Q&A answer via Azure Neural TTS
    const workspaceRoot = path.resolve(__dirname, '../../');
    const qnaDir = path.join(workspaceRoot, 'server/public/uploads/qna');
    if (!fs.existsSync(qnaDir)) {
      fs.mkdirSync(qnaDir, { recursive: true });
    }

    const answerFileName = `qna_answer_${uuidv4()}.mp3`;
    const answerDest = path.join(qnaDir, answerFileName);
    let audioUrl = null;

    try {
      await generateAudioFile(answerText, answerDest);
      audioUrl = `/uploads/qna/${answerFileName}`;
    } catch (ttsErr) {
      console.error("Failed to generate TTS audio for Q&A answer:", ttsErr.message);
    }

    res.json({
      answerText,
      audioUrl
    });
  } catch (error) {
    console.error('Error in trainee question endpoint:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/tts/synthesize
 * Synthesizes dynamic text to an MP3 file using Azure Neural TTS.
 */
router.post('/tts/synthesize', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const workspaceRoot = path.resolve(__dirname, '../../');
    const qnaDir = path.join(workspaceRoot, 'server/public/uploads/qna');
    if (!fs.existsSync(qnaDir)) {
      fs.mkdirSync(qnaDir, { recursive: true });
    }

    const fileName = `synth_${uuidv4()}.mp3`;
    const destPath = path.join(qnaDir, fileName);

    await generateAudioFile(text, destPath);

    res.json({
      audioUrl: `/uploads/qna/${fileName}`
    });
  } catch (error) {
    console.error('Error in tts synthesis endpoint:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Executes PPT export and text extraction, then triggers Gemini and TTS generation.
 */
async function runBackgroundImport(lessonId, pptPath, workspaceRoot) {
  try {
    const uploadsDir = path.join(workspaceRoot, 'server/public/uploads');
    const psScriptPath = path.join(workspaceRoot, 'server/scripts/convert_ppt.ps1');

    console.log(`Starting PPT conversion background task for Lesson ${lessonId}...`);
    
    // Spawn PowerShell to run convert_ppt.ps1
    const psProcess = spawn('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', psScriptPath,
      '-pptPath', pptPath,
      '-outputDir', uploadsDir,
      '-lessonId', lessonId.toString()
    ]);

    let stdoutData = "";
    let stderrData = "";

    psProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    psProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    psProcess.on('close', async (code) => {
      if (code !== 0) {
        console.error(`PowerShell PPT conversion failed with code ${code}. Error: ${stderrData}`);
        await Lesson.findByIdAndUpdate(lessonId, { status: 'failed' });
        return;
      }

      try {
        console.log(`PPT conversion complete. Parsing slides JSON output...`);
        const slidesJson = JSON.parse(stdoutData.trim());
        
        // Update lesson total slides count
        await Lesson.findByIdAndUpdate(lessonId, { totalSlides: slidesJson.length });

        // Save Slides to MongoDB
        const slideDocs = [];
        for (const item of slidesJson) {
          const slide = new Slide({
            lessonId,
            slideNumber: item.slideNumber,
            imageUrl: item.imageUrl,
            extractedText: item.extractedText,
            status: 'pending'
          });
          await slide.save();
          slideDocs.push(slide);
        }

        // Generate AI Content and Audio
        await generateAIContentAndAudio(lessonId, slideDocs, uploadsDir);

      } catch (err) {
        console.error(`Failed to process parsed slide data: ${err.message}`);
        await Lesson.findByIdAndUpdate(lessonId, { status: 'failed' });
      }
    });
  } catch (err) {
    console.error(`Failed in runBackgroundImport: ${err.message}`);
    await Lesson.findByIdAndUpdate(lessonId, { status: 'failed' });
  }
}

/**
 * Regenerates AI content (Gemini and TTS) for an existing lesson.
 */
async function runBackgroundRegeneration(lessonId) {
  try {
    const slides = await Slide.find({ lessonId }).sort({ slideNumber: 1 });
    const workspaceRoot = path.resolve(__dirname, '../../');
    const uploadsDir = path.join(workspaceRoot, 'server/public/uploads');

    // Delete existing quizzes
    await Quiz.deleteMany({ slideId: { $in: slides.map(s => s._id) } });

    // Reset slides status
    for (const slide of slides) {
      slide.narrationText = '';
      slide.quizIntroText = '';
      slide.narrationAudioUrl = '';
      slide.quizIntroAudioUrl = '';
      slide.quizId = undefined;
      slide.status = 'pending';
      await slide.save();
    }

    await generateAIContentAndAudio(lessonId, slides, uploadsDir);
  } catch (err) {
    console.error(`Regeneration failed: ${err.message}`);
    await Lesson.findByIdAndUpdate(lessonId, { status: 'failed' });
  }
}

/**
 * Orchestrates Gemini API content generation and TTS downloads.
 */
async function generateAIContentAndAudio(lessonId, slides, uploadsDir) {
  try {
    console.log(`Calling Gemini API to generate narration and quizzes...`);
    const aiContent = await generateLessonContent(slides);
    
    const lessonUploadsFolder = path.join(uploadsDir, lessonId.toString());

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const aiData = aiContent.find(c => c.slideNumber === slide.slideNumber);

      if (!aiData) {
        slide.status = 'failed';
        await slide.save();
        continue;
      }

      // Fallback-safe Quiz parsing
      const quizQuestion = (aiData.quiz && aiData.quiz.question) 
        || "Which Maruti Suzuki Victoris feature was highlighted on this slide?";
      const quizOptions = (aiData.quiz && Array.isArray(aiData.quiz.options) && aiData.quiz.options.length === 4)
        ? aiData.quiz.options
        : ["Standard safety tech", "ALLGRIP Select AWD", "TPMS & ESP package", "All of the above"];
      const quizCorrect = (aiData.quiz && typeof aiData.quiz.correctAnswer === 'number' && aiData.quiz.correctAnswer >= 0 && aiData.quiz.correctAnswer <= 3)
        ? aiData.quiz.correctAnswer
        : 3;
      const quizExpl = (aiData.quiz && aiData.quiz.explanation)
        || "This feature reflects Maruti Suzuki's product values.";

      // Create Quiz document
      const quiz = new Quiz({
        slideId: slide._id,
        question: quizQuestion,
        options: quizOptions,
        correctAnswer: quizCorrect,
        explanation: quizExpl
      });
      await quiz.save();

      // Update slide details
      slide.narrationText = aiData.narrationText;
      slide.quizIntroText = "If you have any doubts, please ask in the chatbox. " + aiData.quizIntroText;
      aiData.quizIntroText = slide.quizIntroText; // Update aiData so the TTS uses the prepended text
      slide.quizId = quiz._id;

      // Generate audio files in uploads folder
      const narrationFileName = `narration_${slide.slideNumber}.mp3`;
      const quizIntroFileName = `quiz_intro_${slide.slideNumber}.mp3`;
      
      const narrationDest = path.join(lessonUploadsFolder, narrationFileName);
      const quizIntroDest = path.join(lessonUploadsFolder, quizIntroFileName);

      console.log(`Generating TTS audio files for Slide ${slide.slideNumber}...`);
      
      // Narration audio download
      try {
        await generateAudioFile(aiData.narrationText, narrationDest);
        slide.narrationAudioUrl = `/uploads/${lessonId}/${narrationFileName}`;
      } catch (ttsErr) {
        console.error(`Narration TTS download failed for Slide ${slide.slideNumber}: ${ttsErr.message}. Web Speech API will be used.`);
      }

      // Quiz intro audio download
      try {
        await generateAudioFile(aiData.quizIntroText, quizIntroDest);
        slide.quizIntroAudioUrl = `/uploads/${lessonId}/${quizIntroFileName}`;
      } catch (ttsErr) {
        console.error(`Quiz Intro TTS download failed for Slide ${slide.slideNumber}: ${ttsErr.message}. Web Speech API will be used.`);
      }

      slide.status = 'completed';
      await slide.save();
    }

    // Mark lesson as completed
    await Lesson.findByIdAndUpdate(lessonId, { status: 'completed' });
    console.log(`Lesson ${lessonId} AI pre-generation completed successfully!`);

  } catch (err) {
    console.error(`AI content/audio generation failed: ${err.message}`);
    await Lesson.findByIdAndUpdate(lessonId, { status: 'failed' });
  }
}

/**
 * POST /api/feedback
 * Save trainee feedback
 */
router.post('/feedback', async (req, res) => {
  try {
    const { 
      sessionId, 
      lessonId, 
      rating, 
      feedbackText, 
      engagementRating, 
      understandingRating, 
      recommendation 
    } = req.body;

    if (!sessionId || !lessonId || !rating || !engagementRating || !understandingRating || !recommendation) {
      return res.status(400).json({ error: 'All fields except feedback text are required' });
    }

    const feedback = new Feedback({
      sessionId,
      lessonId,
      rating,
      feedbackText: feedbackText || '',
      engagementRating,
      understandingRating,
      recommendation
    });

    await feedback.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/trainees/register
 * Register a trainee for a session
 */
router.post('/trainees/register', async (req, res) => {
  try {
    const { traineeId, name, sessionId } = req.body;
    if (!traineeId || typeof traineeId !== 'string' || !traineeId.trim()) {
      return res.status(400).json({ error: 'traineeId is required and must be a non-empty string' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required and must be a non-empty string' });
    }
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      return res.status(400).json({ error: 'sessionId is required and must be a non-empty string' });
    }

    const Trainee = require('../models/Trainee');
    let trainee = await Trainee.findOne({ sessionId, traineeId: traineeId.trim() });
    
    if (trainee) {
      return res.json(trainee);
    }

    trainee = new Trainee({
      traineeId: traineeId.trim(),
      name: name.trim(),
      sessionId: sessionId.trim()
    });

    await trainee.save();
    res.json(trainee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/trainees/:sessionId
 * Get all registered trainees for a session
 */
router.get('/trainees/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const Trainee = require('../models/Trainee');
    const trainees = await Trainee.find({ sessionId }).sort({ joinedAt: 1 });
    res.json(trainees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sessions/:sessionId/analytics
 * Get aggregated analytics for a session (Task 3)
 */
router.get('/sessions/:sessionId/analytics', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // 1. Get all trainees for this session
    const Trainee = require('../models/Trainee');
    const trainees = await Trainee.find({ sessionId }).sort({ joinedAt: 1 });

    // 2. Get all answers for this session, populate quiz and slide info
    const answers = await Answer.find({ sessionId })
      .populate('questionId')   // Quiz model
      .populate('slideId');     // Slide model

    // 3. Build unique quizzes list from populated answers
    const quizzesMap = new Map();
    const formattedAnswers = [];

    for (const ans of answers) {
      const slideNum = ans.slideId ? ans.slideId.slideNumber : null;
      const quiz = ans.questionId;

      if (quiz && slideNum && !quizzesMap.has(quiz._id.toString())) {
        quizzesMap.set(quiz._id.toString(), {
          slideNumber: slideNum,
          question: quiz.question,
          options: quiz.options,
          correctAnswer: quiz.correctAnswer
        });
      }

      formattedAnswers.push({
        traineeId: ans.userId,    // this is the traineeId string
        slideNumber: slideNum,
        answerIndex: ans.answerIndex,
        isCorrect: ans.isCorrect,
        responseTimeMs: ans.responseTimeMs
      });
    }

    res.json({
      trainees: trainees.map(t => ({
        traineeId: t.traineeId,
        name: t.name,
        joinedAt: t.joinedAt
      })),
      quizzes: Array.from(quizzesMap.values()).sort((a, b) => a.slideNumber - b.slideNumber),
      answers: formattedAnswers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
