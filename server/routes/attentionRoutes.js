const express = require('express');
const router = express.Router();
const AttentionLog = require('../models/AttentionLog');

/**
 * GET /api/attention/:sessionId/:userId
 * Returns all attention logs for that user in that session, sorted by timestamp ascending.
 */
router.get('/:sessionId/:userId', async (req, res) => {
  try {
    const { sessionId, userId } = req.params;
    const logs = await AttentionLog.find({ sessionId, userId }).sort({ timestamp: 1 });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/attention/:sessionId/summary
 * Returns per-user aggregated attention summary for the session:
 * - average attentionScore
 * - count of readings where facePresent was false
 * - count of readings where attentionScore < 40 (distracted)
 * - per-slide average attentionScore
 */
router.get('/:sessionId/summary', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const logs = await AttentionLog.find({ sessionId });
    
    if (!logs || logs.length === 0) {
      return res.json([]);
    }

    const userSummary = {};

    for (const log of logs) {
      const u = log.userId;
      if (!userSummary[u]) {
        userSummary[u] = {
          userId: u,
          totalReadings: 0,
          sumAttention: 0,
          faceNotPresentCount: 0,
          distractedCount: 0,
          slidesMap: {} // slideNumber -> { sumAttention, count }
        };
      }
      
      const summary = userSummary[u];
      summary.totalReadings++;
      summary.sumAttention += log.attentionScore;
      
      if (log.facePresent === false) {
        summary.faceNotPresentCount++;
      }
      if (log.attentionScore < 40) {
        summary.distractedCount++;
      }

      const sNum = log.slideNumber;
      if (sNum !== undefined && sNum !== null) {
        if (!summary.slidesMap[sNum]) {
          summary.slidesMap[sNum] = { sumAttention: 0, count: 0 };
        }
        summary.slidesMap[sNum].sumAttention += log.attentionScore;
        summary.slidesMap[sNum].count++;
      }
    }

    const results = Object.values(userSummary).map(user => {
      const averageAttentionScore = user.totalReadings > 0 ? (user.sumAttention / user.totalReadings) : 0;
      const perSlideAverage = {};
      
      for (const [slideNum, data] of Object.entries(user.slidesMap)) {
        perSlideAverage[slideNum] = data.count > 0 ? (data.sumAttention / data.count) : 0;
      }

      return {
        userId: user.userId,
        averageAttentionScore: Math.round(averageAttentionScore * 100) / 100,
        faceNotPresentCount: user.faceNotPresentCount,
        distractedCount: user.distractedCount,
        perSlideAverage
      };
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
