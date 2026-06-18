// server/services/questionQueue.js

// Map of sessionId -> Array of { questionData, processor }
const queues = new Map();
// Map of sessionId -> Boolean (true if currently processing)
const processing = new Map();

function isProcessing(sessionId) {
  return !!processing.get(sessionId);
}

function enqueueQuestion(sessionId, questionData, processor) {
  if (!queues.has(sessionId)) {
    queues.set(sessionId, []);
  }
  
  queues.get(sessionId).push({ questionData, processor });
  
  // If not processing, start processing now
  if (!isProcessing(sessionId)) {
    processNext(sessionId);
  }
}

async function processNext(sessionId) {
  const queue = queues.get(sessionId);
  if (!queue || queue.length === 0) {
    processing.set(sessionId, false);
    return;
  }
  
  processing.set(sessionId, true);
  const { questionData, processor } = queue.shift();
  
  try {
    await processor(questionData);
  } catch (err) {
    console.error(`Error processing question ${questionData.questionId}:`, err);
    // Move to next question if processor fails and doesn't handle it
    processNext(sessionId);
  }
}

module.exports = {
  enqueueQuestion,
  isProcessing,
  processNext
};
