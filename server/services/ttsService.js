const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fs = require('fs');

/**
 * Generates an MP3 file at destPath from text using Microsoft Azure Neural TTS.
 */
async function generateAudioFile(text, destPath) {
  return new Promise((resolve, reject) => {
    try {
      if (!text || !text.trim()) {
        return resolve(false);
      }

      const key = process.env.AZURE_TTS_KEY;
      const region = process.env.AZURE_TTS_REGION;

      if (!key || !region) {
        return reject(new Error("Azure TTS credentials (AZURE_TTS_KEY or AZURE_TTS_REGION) are missing in environment variables."));
      }

      const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);

      // Configure output format to standard MP3
      speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3;

      // Set voice and language parameters
      speechConfig.speechSynthesisVoiceName = process.env.AZURE_TTS_VOICE || "en-US-AndrewNeural";
      speechConfig.speechSynthesisLanguage = process.env.AZURE_TTS_LANGUAGE || "en-US";

      // Synthesize to memory (null audio config so it doesn't play on the server speakers)
      const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

      // Setup a 4-second timeout to prevent hanging the server on network/credentials issues
      const timer = setTimeout(() => {
        try {
          synthesizer.close();
        } catch (e) {}
        reject(new Error("Azure TTS synthesis timed out (network or invalid credentials)"));
      }, 4000);

      synthesizer.speakTextAsync(
        text,
        (result) => {
          clearTimeout(timer);
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            const buffer = Buffer.from(result.audioData);
            fs.writeFileSync(destPath, buffer);
            synthesizer.close();
            resolve(true);
          } else {
            const details = result.errorDetails || `Reason code: ${result.reason}`;
            synthesizer.close();
            reject(new Error(`Azure TTS synthesis failed: ${details}`));
          }
        },
        (err) => {
          clearTimeout(timer);
          synthesizer.close();
          reject(err);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateAudioFile
};
