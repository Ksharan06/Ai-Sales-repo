import { useState, useEffect, useRef } from 'react';
import { initAttentionDetector, analyzeFrame, destroyDetector } from '../services/attentionService';

/**
 * Custom hook to monitor trainee attention client-side using MediaPipe.
 * Emits batched attention data every 30 seconds via Socket.IO.
 */
export default function useAttentionMonitor(
  videoRef,
  isSessionActive,
  socket,
  userId,
  sessionId,
  currentSlide
) {
  const [currentAttentionScore, setCurrentAttentionScore] = useState(100);
  const bufferRef = useRef([]);
  
  const socketRef = useRef(socket);
  const currentSlideRef = useRef(currentSlide);

  // Keep references up to date to prevent stale closures in the interval loops
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    currentSlideRef.current = currentSlide;
  }, [currentSlide]);

  useEffect(() => {
    let faceLandmarkerInstance = null;
    let analyzeIntervalId = null;
    let flushIntervalId = null;

    const flushBuffer = () => {
      if (bufferRef.current.length > 0 && socketRef.current) {
        socketRef.current.emit('attention-batch', {
          userId,
          sessionId,
          readings: [...bufferRef.current]
        });
        bufferRef.current = [];
      }
    };

    async function setupDetector() {
      if (!isSessionActive) return;

      try {
        faceLandmarkerInstance = await initAttentionDetector();
        
        // Polling interval for analyzing frame (every 3000ms)
        analyzeIntervalId = setInterval(() => {
          const videoElement = videoRef.current;
          
          if (faceLandmarkerInstance) {
            let result;
            
            if (videoElement && videoElement.readyState >= 2) {
              const timestamp = performance.now();
              result = analyzeFrame(faceLandmarkerInstance, videoElement, timestamp);
            } else {
              // Webcam is unmounted (camera off), disabled, or loading
              result = {
                facePresent: false,
                attentionScore: 0,
                headYaw: 0,
                headPitch: 0,
                earLeft: 0,
                earRight: 0
              };
            }

            const reading = {
              slideNumber: currentSlideRef.current || 1,
              attentionScore: result.attentionScore,
              facePresent: result.facePresent,
              headYaw: result.headYaw,
              headPitch: result.headPitch,
              earLeft: result.earLeft,
              earRight: result.earRight,
              timestamp: new Date().toISOString()
            };

            bufferRef.current.push(reading);
            setCurrentAttentionScore(result.attentionScore);
          }
        }, 3000);

        // Flushing interval (every 30000ms)
        flushIntervalId = setInterval(() => {
          flushBuffer();
        }, 30000);

      } catch (err) {
        console.warn("Attention monitoring initialization failed (running session without attention logs):", err.message);
      }
    }

    setupDetector();

    return () => {
      // Clear intervals
      if (analyzeIntervalId) clearInterval(analyzeIntervalId);
      if (flushIntervalId) clearInterval(flushIntervalId);
      
      // Flush remaining data
      flushBuffer();
      
      // Destroy MediaPipe FaceLandmarker instance
      if (faceLandmarkerInstance) {
        destroyDetector(faceLandmarkerInstance);
        faceLandmarkerInstance = null;
      }
    };
  }, [isSessionActive, videoRef, userId, sessionId]);

  return { currentAttentionScore };
}
