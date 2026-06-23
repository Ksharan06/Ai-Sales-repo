/**
 * In-memory singleton tracking the ONE live classroom session across the system.
 * The admin's client is the source of truth; this store mirrors what the admin
 * is currently doing so late-joining trainees can sync immediately.
 *
 * This is intentionally NOT a server-driven slide clock — it only records state
 * the admin's client reports (slide/phase/audio timestamps), so trainees can
 * compute playback offsets and render the correct screen on join.
 */

let liveSession = createEmpty();

function createEmpty() {
  return {
    sessionId: null,
    lessonId: null,
    adminSocketId: null,           // the authoritative admin's socket
    isLive: false,
    startedAt: null,
    currentSlide: 1,
    currentPhase: 'idle',          // 'idle' | 'intro' | 'narration' | 'quiz'
    currentAudioUrl: null,
    currentAudioStartedAt: null,   // server epoch ms when the current audio began
    quizStartedAt: null,           // server epoch ms when quiz countdown began
    qaInterrupt: null              // null | { askedByTraineeId, questionId, audioUrl, audioStartedAt }
  };
}

function get() {
  return liveSession;
}

function snapshot() {
  // Plain object plus a server clock so trainees can compute offsets reliably.
  return { ...liveSession, serverNow: Date.now() };
}

function start({ sessionId, lessonId }) {
  liveSession = createEmpty();
  liveSession.sessionId = sessionId;
  liveSession.lessonId = lessonId || null;
  liveSession.isLive = true;
  liveSession.startedAt = Date.now();
  liveSession.currentPhase = 'idle';
  return liveSession;
}

function setAdminSocket(socketId) {
  liveSession.adminSocketId = socketId;
}

/**
 * Generic "the admin just began playing this audio segment" update. Covers the
 * welcome intro, slide narration, and the per-slide quiz-intro alike — they are
 * all just "the current audio" at the live position.
 */
function setAudio({ phase, slideNumber, audioUrl }) {
  if (phase) liveSession.currentPhase = phase;
  if (slideNumber !== undefined && slideNumber !== null) liveSession.currentSlide = slideNumber;
  liveSession.currentAudioUrl = audioUrl || null;
  liveSession.currentAudioStartedAt = Date.now();
  liveSession.quizStartedAt = null;
  // A fresh audio segment clears any stale Q&A interrupt.
  liveSession.qaInterrupt = null;
}

function setNarration({ currentSlide, audioUrl }) {
  liveSession.currentSlide = currentSlide;
  liveSession.currentPhase = 'narration';
  liveSession.currentAudioUrl = audioUrl || null;
  liveSession.currentAudioStartedAt = Date.now();
  liveSession.quizStartedAt = null;
  // A new slide clears any stale Q&A interrupt.
  liveSession.qaInterrupt = null;
}

function setQuiz({ currentSlide }) {
  if (currentSlide !== undefined) liveSession.currentSlide = currentSlide;
  liveSession.currentPhase = 'quiz';
  liveSession.quizStartedAt = Date.now();
}

function setQaInterrupt(qa) {
  liveSession.qaInterrupt = qa; // { askedByTraineeId, questionId, audioUrl, audioStartedAt }
}

function clearQaInterrupt() {
  liveSession.qaInterrupt = null;
}

function end() {
  liveSession = createEmpty();
  liveSession.isLive = false;
  return liveSession;
}

module.exports = {
  get,
  snapshot,
  start,
  setAdminSocket,
  setAudio,
  setNarration,
  setQuiz,
  setQaInterrupt,
  clearQaInterrupt,
  end
};
