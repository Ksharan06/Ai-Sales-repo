import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

/**
 * Initializes and returns a FaceLandmarker instance from MediaPipe.
 */
export async function initAttentionDetector() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
  );
  
  const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  });
  
  return faceLandmarker;
}

/**
 * Helper to calculate Euclidean distance between two points (using x and y only).
 */
function dist(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

/**
 * Helper to calculate Eye Aspect Ratio (EAR).
 */
function calculateEAR(landmarks, p1Idx, p2Idx, p3Idx, p4Idx, p5Idx, p6Idx) {
  const p1 = landmarks[p1Idx];
  const p2 = landmarks[p2Idx];
  const p3 = landmarks[p3Idx];
  const p4 = landmarks[p4Idx];
  const p5 = landmarks[p5Idx];
  const p6 = landmarks[p6Idx];

  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0;

  const dVert1 = dist(p2, p6);
  const dVert2 = dist(p3, p5);
  const dHoriz = dist(p1, p4);

  if (dHoriz === 0) return 0;
  return (dVert1 + dVert2) / (2.0 * dHoriz);
}

/**
 * Analyzes a single video frame.
 * Returns: { facePresent, attentionScore, headYaw, headPitch, earLeft, earRight }
 */
export function analyzeFrame(faceLandmarker, videoElement, timestamp) {
  if (!faceLandmarker || !videoElement) {
    return { facePresent: false, attentionScore: 0, headYaw: 0, headPitch: 0, earLeft: 0, earRight: 0 };
  }

  const result = faceLandmarker.detectForVideo(videoElement, timestamp);
  
  if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
    return { facePresent: false, attentionScore: 0, headYaw: 0, headPitch: 0, earLeft: 0, earRight: 0 };
  }

  const landmarks = result.faceLandmarks[0];

  // 1. Calculate Head Pose (Yaw and Pitch) using specified indices:
  // Nose tip: index 1
  // Chin: index 152
  // Left eye outer corner: index 33
  // Right eye outer corner: index 263
  const nose = landmarks[1];
  const chin = landmarks[152];
  const leftEyeOuter = landmarks[33];
  const rightEyeOuter = landmarks[263];

  if (!nose || !chin || !leftEyeOuter || !rightEyeOuter) {
    return { facePresent: false, attentionScore: 0, headYaw: 0, headPitch: 0, earLeft: 0, earRight: 0 };
  }

  // Midpoint of left and right eye corners
  const eyeMidpointX = (leftEyeOuter.x + rightEyeOuter.x) / 2;
  const eyeMidpointY = (leftEyeOuter.y + rightEyeOuter.y) / 2;

  // Midpoint of chin and the eye-level midpoint
  const chinEyeMidpointY = (eyeMidpointY + chin.y) / 2;

  // Displacements
  const dx = nose.x - eyeMidpointX;
  const dy = nose.y - chinEyeMidpointY;

  // Use distance between eyes as a horizontal reference scale (depth proxy)
  const eyeDist = dist(leftEyeOuter, rightEyeOuter);
  // Use distance from eye level to chin as a vertical reference scale
  const verticalRef = chin.y - eyeMidpointY;

  // Convert Math.atan2 to degrees
  const rawYaw = Math.atan2(dx, eyeDist) * (180 / Math.PI);
  const rawPitch = Math.atan2(dy, verticalRef) * (180 / Math.PI);

  // Calibration parameters:
  // - The nose tip is naturally situated slightly above the midpoint between eyes and chin, 
  //   giving a neutral baseline pitch of roughly -10 degrees when looking straight.
  // - Due to 2D projection compression of 3D facial depth, raw angular changes are compressed by ~3.5x.
  const neutralPitch = -10.0;
  const neutralYaw = -5.0; // slight camera angle/symmetry offset

  const headYaw = (rawYaw - neutralYaw) * 3.0;
  const headPitch = (rawPitch - neutralPitch) * 3.5;

  // 2. Eye Aspect Ratio (EAR)
  // Right eye: indices 33, 160, 158, 133, 153, 144
  // Left eye: indices 362, 385, 387, 263, 373, 380
  const earRight = calculateEAR(landmarks, 33, 160, 158, 133, 153, 144);
  const earLeft = calculateEAR(landmarks, 362, 385, 387, 263, 373, 380);
  const averageEAR = (earLeft + earRight) / 2;

  // 3. Attention Score (0-100) — continuous scoring
  const facePresent = true;

  // Base: 40 points just for being present and detectable
  let attentionScore = 40;

  // Head focus: 0-35 points, scales smoothly.
  // Full points when looking straight; decreases as head turns away.
  // Yaw fully penalized at 45 degrees, pitch fully penalized at 35 degrees.
  const yawScore = Math.max(0, 1 - Math.abs(headYaw) / 45);
  const pitchScore = Math.max(0, 1 - Math.abs(headPitch) / 35);
  // Yaw weighted slightly higher than pitch (looking sideways = more distracted than looking down)
  attentionScore += (yawScore * 0.6 + pitchScore * 0.4) * 35;

  // Eyes: 0-25 points, scales smoothly.
  // Full points at EAR >= 0.28 (wide open), zero at EAR <= 0.15 (closed).
  const earScore = Math.max(0, Math.min(1, (averageEAR - 0.15) / 0.13));
  attentionScore += earScore * 25;

  // Round to nearest integer
  attentionScore = Math.round(attentionScore);

  return {
    facePresent,
    attentionScore,
    headYaw: Math.round(headYaw * 100) / 100,
    headPitch: Math.round(headPitch * 100) / 100,
    earLeft: Math.round(earLeft * 100) / 100,
    earRight: Math.round(earRight * 100) / 100
  };
}

/**
 * Closes the FaceLandmarker instance.
 */
export function destroyDetector(faceLandmarker) {
  if (faceLandmarker && typeof faceLandmarker.close === 'function') {
    try {
      faceLandmarker.close();
    } catch (err) {
      console.warn("Error destroying attention FaceLandmarker detector:", err.message);
    }
  }
}
