import { useState, useRef, useCallback } from 'react';
import * as speechsdk from 'microsoft-cognitiveservices-speech-sdk';
import axios from 'axios';

export default function useSpeechToText() {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const recognizerRef = useRef(null);
  const finalTranscriptRef = useRef('');
  const tokenRef = useRef({ token: null, expiry: 0 });

  const getToken = useCallback(async () => {
    const now = Date.now();
    if (tokenRef.current.token && now < tokenRef.current.expiry) {
      return tokenRef.current;
    }
    const response = await axios.get('/api/speech/token');
    const { token, region } = response.data;
    tokenRef.current = { token, region, expiry: now + 9 * 60 * 1000 };
    return tokenRef.current;
  }, []);

  // Starts continuous listening. Does NOT auto-stop on silence.
  // Resolves immediately once recognition has started (not when speech ends).
  const startListening = useCallback(async () => {
    const { token, region } = await getToken();

    const speechConfig = speechsdk.SpeechConfig.fromAuthorizationToken(token, region);
    speechConfig.speechRecognitionLanguage = 'en-IN';
    speechConfig.outputFormat = speechsdk.OutputFormat.Detailed;

    // Segmentation tuning: the SDK defaults are tuned for short voice-assistant
    // commands, not full natural sentences. Without this, a normal pause between
    // clauses (e.g. "units were sold" <pause> "by end of november") can be
    // misread as end-of-speech, truncating the utterance into a short fragment
    // that then gets misrecognized as an unrelated short phrase.
    
    // How long a pause must be (in ms) before the recognizer considers the
    // CURRENT PHRASE finished. Default is short (~500ms); raise it so natural
    // mid-sentence pauses don't prematurely end the phrase.
    speechConfig.setProperty(
      speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
      '1200'
    );

    // How long the recognizer waits for speech to START before giving up
    // on a recognition attempt (helps if there's a brief delay after clicking
    // the mic before the trainee starts talking).
    speechConfig.setProperty(
      speechsdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
      '5000'
    );

    // How long a trailing pause must be at the very END of recognition before
    // finalizing — keep this a bit longer too, so the last word(s) of a question
    // aren't cut off.
    speechConfig.setProperty(
      speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
      '1200'
    );

    const audioConfig = speechsdk.AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new speechsdk.SpeechRecognizer(speechConfig, audioConfig);
    recognizerRef.current = recognizer;
    finalTranscriptRef.current = '';
    setInterimText('');
    setIsListening(true);

    // Boost recognition accuracy for domain-specific vocabulary.
    // This does NOT restrict recognition to only these words — it biases
    // the language model toward them when the audio is ambiguous.
    const phraseList = speechsdk.PhraseListGrammar.fromRecognizer(recognizer);
    const domainPhrases = [
      'Maruti Suzuki', 'Victoris', 'ALLGRIP', 'ALLGRIP Select', 'ADAS',
      'panoramic sunroof', 'leatherette', 'ZXi', 'variant', 'variants',
      'ex-showroom price', 'on-road price', 'starting price', 'mileage',
      'fuel efficiency', 'ground clearance', 'boot space', 'infotainment',
      'safety rating', 'NCAP', 'warranty', 'EMI', 'down payment',
      'hybrid', 'strong hybrid', 'mild hybrid', 'petrol', 'diesel',
      'automatic transmission', 'manual transmission', 'CVT',
      'cruise control', 'lane assist', 'airbags', 'colour options',
      'color options', 'price', 'features', 'engine', 'specifications'
    ];
    domainPhrases.forEach(phrase => phraseList.addPhrase(phrase));

    // Live partial results while speaking
    recognizer.recognizing = (sender, event) => {
      if (event.result.reason === speechsdk.ResultReason.RecognizingSpeech) {
        setInterimText(event.result.text);
      }
    };

    // Each completed phrase/sentence gets appended to the running transcript.
    // Continuous mode fires this multiple times during one recording session
    // (e.g. after each natural pause), but does NOT stop the session itself.
    recognizer.recognized = (sender, event) => {
      if (event.result.reason === speechsdk.ResultReason.RecognizedSpeech && event.result.text) {
        try {
          const detailedJson = event.result.properties.getProperty(
            speechsdk.PropertyId.SpeechServiceResponse_JsonResult
          );
          const parsed = detailedJson ? JSON.parse(detailedJson) : null;
          const bestResult = parsed?.NBest?.[0];
          const confidence = bestResult?.Confidence ?? 1; // default to accept if unavailable

          // Discard very low-confidence results rather than appending
          // a likely-wrong generic phrase to the transcript.
          if (confidence < 0.4) {
            console.warn('Low-confidence recognition discarded:', event.result.text, confidence);
            return;
          }
        } catch (e) {
          // If parsing fails, fall through and accept the plain result.
        }

        finalTranscriptRef.current =
          (finalTranscriptRef.current ? finalTranscriptRef.current + ' ' : '') + event.result.text;
        setInterimText(finalTranscriptRef.current);
      }
    };

    recognizer.canceled = (sender, event) => {
      console.error('Speech recognition canceled:', event.errorDetails);
    };

    return new Promise((resolve, reject) => {
      recognizer.startContinuousRecognitionAsync(
        () => resolve(true),
        (err) => {
          setIsListening(false);
          reject(err);
        }
      );
    });
  }, [getToken]);

  // Stop and KEEP the transcript — used for the checkmark (confirm) button.
  const stopListening = useCallback(() => {
    return new Promise((resolve) => {
      if (!recognizerRef.current) {
        setIsListening(false);
        resolve(finalTranscriptRef.current.trim());
        return;
      }
      recognizerRef.current.stopContinuousRecognitionAsync(
        () => {
          const finalText = finalTranscriptRef.current.trim();
          recognizerRef.current.close();
          recognizerRef.current = null;
          setIsListening(false);
          setInterimText('');
          resolve(finalText);
        },
        () => {
          recognizerRef.current && recognizerRef.current.close();
          recognizerRef.current = null;
          setIsListening(false);
          setInterimText('');
          resolve(finalTranscriptRef.current.trim());
        }
      );
    });
  }, []);

  // Stop and DISCARD the transcript — used for the X (cancel) button.
  const cancelListening = useCallback(() => {
    finalTranscriptRef.current = '';
    if (recognizerRef.current) {
      try {
        recognizerRef.current.stopContinuousRecognitionAsync(
          () => { recognizerRef.current && recognizerRef.current.close(); recognizerRef.current = null; },
          () => { recognizerRef.current && recognizerRef.current.close(); recognizerRef.current = null; }
        );
      } catch (e) { /* ignore */ }
    }
    setIsListening(false);
    setInterimText('');
  }, []);

  return { isListening, interimText, startListening, stopListening, cancelListening };
}
