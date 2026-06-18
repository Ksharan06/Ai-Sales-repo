require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-classroom';
  
  try {
    await mongoose.connect(mongoUri);
    
    // Define schemas dynamically to avoid model compilation issues
    const Session = mongoose.models.Session || mongoose.model('Session', new mongoose.Schema({}, { strict: false }));
    const AttentionLog = mongoose.models.AttentionLog || mongoose.model('AttentionLog', new mongoose.Schema({}, { strict: false }));
    const Lesson = mongoose.models.Lesson || mongoose.model('Lesson', new mongoose.Schema({}, { strict: false }));

    const latestSession = await Session.findOne().sort({ startedAt: -1 });
    if (!latestSession) {
      console.log("\x1b[31m%s\x1b[0m", "❌ No training sessions found in the database.");
      process.exit(0);
    }

    const lesson = await Lesson.findById(latestSession.lessonId);
    const logs = await AttentionLog.find({ sessionId: latestSession.sessionId }).sort({ timestamp: 1 });
    
    if (logs.length === 0) {
      console.log("\x1b[33m%s\x1b[0m", "⚠️  Latest session found, but no attention logs have been recorded yet.");
      console.log(`Session ID: ${latestSession.sessionId}`);
      console.log(`Lesson: ${lesson ? lesson.title : "Unknown"}`);
      process.exit(0);
    }

    // Process statistics
    const totalReadings = logs.length;
    let sumAttention = 0;
    let faceNotPresentCount = 0;
    let distractedCount = 0;
    const slideMap = {};

    // "Distracted" must mean: face IS detected but the trainee is looking away
    // and/or eyes closed. A present face always scores >= 40 (40 base points),
    // so the threshold has to sit above 40 to capture anything, and we exclude
    // face-not-present samples so this metric stays distinct from "Face Not
    // Detected" rather than being an exact duplicate of it.
    const DISTRACTED_THRESHOLD = 70;

    logs.forEach(log => {
      sumAttention += log.attentionScore;
      if (!log.facePresent) faceNotPresentCount++;
      if (log.facePresent && log.attentionScore < DISTRACTED_THRESHOLD) distractedCount++;

      const sNum = log.slideNumber || 1;
      if (!slideMap[sNum]) {
        slideMap[sNum] = { sumAttention: 0, count: 0, faceNotPresent: 0, distracted: 0 };
      }
      slideMap[sNum].sumAttention += log.attentionScore;
      slideMap[sNum].count++;
      if (!log.facePresent) slideMap[sNum].faceNotPresent++;
      if (log.facePresent && log.attentionScore < DISTRACTED_THRESHOLD) slideMap[sNum].distracted++;
    });

    const overallAvg = Math.round((sumAttention / totalReadings) * 10) / 10;
    const faceNotPresentPct = Math.round((faceNotPresentCount / totalReadings) * 1000) / 10;
    const distractedPct = Math.round((distractedCount / totalReadings) * 1000) / 10;

    // Output formatted report
    console.log("\n==================================================");
    console.log("       TRAINNE ATTENTION ANALYSIS REPORT          ");
    console.log("==================================================");
    console.log(`Lesson:      \x1b[36m${lesson ? lesson.title : "Unknown Lesson"}\x1b[0m`);
    console.log(`Session ID:  ${latestSession.sessionId}`);
    console.log(`Trainee ID:  \x1b[35m${logs[0].userId}\x1b[0m`);
    console.log(`Start Time:  ${new Date(latestSession.startedAt).toLocaleString()}`);
    console.log(`Duration:    ${Math.round(totalReadings * 3 / 60 * 10) / 10} minutes (${totalReadings * 3}s tracked)`);
    console.log("--------------------------------------------------");

    console.log("\n--- OVERALL FOCUS PERFORMANCE ---");
    console.log(`Overall Attention Score:   \x1b[1m\x1b[32m${overallAvg}%\x1b[0m`);
    console.log(`Distracted Duration:       ${distractedPct}% (${distractedCount * 3} seconds)`);
    console.log(`Face Not Detected:         ${faceNotPresentPct}% (${faceNotPresentCount * 3} seconds)`);
    
    // Status text
    let statusColor = "\x1b[31m"; // Red
    let statusText = "Needs Improvement";
    if (overallAvg >= 80) {
      statusColor = "\x1b[32m"; // Green
      statusText = "Excellent Focus";
    } else if (overallAvg >= 70) {
      statusColor = "\x1b[33m"; // Yellow
      statusText = "Satisfactory Focus";
    }
    console.log(`Engagement Rating:         ${statusColor}${statusText}\x1b[0m`);

    console.log("\n--- SLIDE-BY-SLIDE FOCUS BREAKDOWN ---");
    const tableData = Object.entries(slideMap).map(([slideNum, data]) => {
      const avg = Math.round((data.sumAttention / data.count) * 10) / 10;
      let rating = "Distracted";
      if (avg >= 80) rating = "Highly Focused";
      else if (avg >= 70) rating = "Focused";

      return {
        "Slide": `Slide ${slideNum}`,
        "Time (sec)": data.count * 3,
        "Avg Attention": `${avg}%`,
        "Distracted Time": `${data.distracted * 3}s`,
        "Face Not Detected": `${data.faceNotPresent * 3}s`,
        "Status": rating
      };
    });

    console.table(tableData);
    console.log("==================================================\n");

  } catch (err) {
    console.error("❌ Error aggregating report:", err.message);
  } finally {
    await mongoose.disconnect();
  }
}

run();
