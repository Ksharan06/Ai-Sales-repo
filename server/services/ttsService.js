const fs = require('fs');
const https = require('https');

/**
 * Escape text for safe inclusion inside SSML/XML.
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates an MP3 file at destPath from text using Microsoft Azure Neural TTS.
 *
 * Uses the Azure TTS REST endpoint (POST SSML over plain HTTPS) instead of the
 * Speech SDK's WebSocket transport. Some networks/antivirus/VPNs allow normal
 * HTTPS but break the persistent WebSocket the SDK uses, which surfaces as
 * "Unable to contact server. StatusCode: 1006". REST avoids that channel
 * entirely while using the same Azure resource, key, region, voice and MP3
 * output. Signature and return behavior are unchanged: resolves `false` for
 * empty text, `true` once the MP3 is written, and rejects on any failure.
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

      const voice = process.env.AZURE_TTS_VOICE || "en-US-AndrewNeural";
      const language = process.env.AZURE_TTS_LANGUAGE || "en-US";

      // Same audio profile the SDK used: Audio16Khz128KBitRateMonoMp3
      const outputFormat = "audio-16khz-128kbitrate-mono-mp3";

      const ssml =
        `<speak version='1.0' xml:lang='${language}'>` +
        `<voice xml:lang='${language}' name='${voice}'>` +
        `${escapeXml(text)}` +
        `</voice></speak>`;

      const payload = Buffer.from(ssml, 'utf8');

      const options = {
        method: 'POST',
        hostname: `${region}.tts.speech.microsoft.com`,
        path: '/cognitiveservices/v1',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': outputFormat,
          'User-Agent': 'aisales-tts',
          'Content-Length': payload.length
        }
      };

      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          if (res.statusCode === 200) {
            try {
              fs.writeFileSync(destPath, body);
              resolve(true);
            } catch (writeErr) {
              reject(writeErr);
            }
          } else {
            const details = body.toString('utf8') || `Status code: ${res.statusCode}`;
            reject(new Error(`Azure TTS synthesis failed: HTTP ${res.statusCode} ${details}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Azure TTS synthesis failed: ${err.message}`));
      });

      req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateAudioFile
};
