# Product Requirements Document: AI Sales Training Classroom

## 1. Product Summary

AI Sales Training Classroom is a web-based virtual classroom for Maruti Suzuki Victoris sales training. It converts a fixed PowerPoint module into a reusable AI-assisted lesson, then runs a Zoom-style live training experience with pre-generated slide images, AI narration, quizzes, trainee Q&A, webcam-based attention monitoring, and post-session feedback.

The key product principle is that the PPT is the source of truth and should be processed once. Gemini is used during import/regeneration to generate narration and quizzes, while live sessions reuse stored MongoDB content and stored audio assets wherever possible.

## 2. Product Goals

- Deliver a guided virtual classroom for sales representatives learning Maruti Suzuki Victoris product details.
- Convert `maruti_victoris_full.pptx` into slide images, extracted text, AI narration, quiz intro audio, and quizzes.
- Avoid Gemini calls during normal session startup and slide playback.
- Provide a live meeting-like interface with camera/mic controls, presenter state, chat/Q&A, polls, and session progression.
- Capture trainee quiz answers, feedback, and attention/focus telemetry for later analysis.
- Allow admins to import the PPT and explicitly regenerate AI content when needed.

## 3. Target Users

- Sales trainees: attend the training session, watch slide narration, answer quizzes, ask slide-specific questions, and submit feedback.
- Trainer/admin: imports or regenerates lesson content and starts classroom sessions.
- Training manager: reviews engagement through attention logs, quiz answers, and feedback data.

## 4. Core User Journeys

### 4.1 Admin Imports Training Module

1. Admin opens the launcher.
2. If no lesson exists, admin clicks "Import PPT Now".
3. Backend loads `maruti_victoris_full.pptx` from the workspace root.
4. PowerShell and PowerPoint COM export each slide as PNG and extract slide/table text.
5. Backend stores `Lesson` and `Slide` documents.
6. Gemini generates narration, quiz intro text, and one MCQ per slide.
7. Azure Neural TTS generates MP3 narration and quiz intro audio.
8. Lesson status becomes `completed`.

### 4.2 Admin Starts Session

1. Admin clicks "Start Meeting" for a completed lesson.
2. Backend creates a UUID `Session` with `currentSlide = 1`.
3. Backend pre-caches a Q&A outro MP3 for the session.
4. Client enters the classroom view.

### 4.3 Trainee Attends Classroom

1. Client joins the Socket.IO room using `join-session`.
2. Classroom shows a welcome phase and generates a short welcome TTS via `/api/tts/synthesize`.
3. Classroom transitions through a screen-share phase.
4. Client requests the first stored slide with `sync-slide`.
5. Slide image displays, narration MP3 plays, quiz intro MP3 plays, then quiz appears.
6. Trainee answers within a 10-second countdown.
7. Result is shown, answer is saved, and session auto-advances.
8. Final slide completion sends trainee to feedback.

### 4.4 Trainee Asks AI Trainer a Question

1. Trainee opens "Ask a Question" and submits a slide-specific question.
2. Backend enforces a max of 4 questions per slide per session.
3. Backend stores a `QuestionAnswer` record with `pending` status.
4. Backend broadcasts `qa-started`, pauses classroom playback, and queues the question.
5. Azure TTS generates an intro MP3: who asked and what was asked.
6. Gemini answers using only the current lesson/slide context.
7. Azure TTS generates the answer MP3.
8. Client plays intro, answer, and outro audio.
9. Client emits `qa-playback-complete`; backend marks Q&A answered and processes the next queued question.

### 4.5 Attention Monitoring

1. When training begins, the client starts webcam capture if camera is enabled.
2. MediaPipe FaceLandmarker analyzes one video frame every 3 seconds.
3. Client computes face presence, head yaw, head pitch, eye aspect ratio, and attention score.
4. Readings are buffered and emitted every 30 seconds through Socket.IO.
5. Backend stores readings in `AttentionLog`.
6. REST summary and CLI report aggregate attention by user and slide.

### 4.6 Feedback

1. After leaving/completing a session, trainee sees feedback form.
2. Trainee submits star rating, optional text, engagement rating, understanding rating, and recommendation.
3. Backend stores a `Feedback` document.

## 5. Functional Requirements

### Lesson Import and Regeneration

- The system must import only the configured PPT file `maruti_victoris_full.pptx`.
- The system must export slides as PNG assets under `server/public/uploads/<lessonId>/`.
- The system must extract text from PowerPoint text frames and tables.
- The system must generate and persist narration text, quiz intro text, quizzes, and audio URLs.
- The system must expose an explicit regeneration action that clears old quiz/audio fields and re-generates AI content.
- Normal session startup must not regenerate lesson narration or quizzes.

### Classroom Runtime

- The client must join a session room over Socket.IO.
- The server must track session participants by `userId` and `socketId`.
- The server must maintain authoritative slide position in MongoDB.
- The client must support welcome, sharing, and training phases.
- Slide change must reset quiz, Q&A pause, audio, and timer state.
- Last slide completion must mark session completed and route trainee to feedback.

### Quiz

- Each slide should have one stored MCQ with exactly 4 options.
- Quiz countdown is 10 seconds.
- Manual submissions must be saved through `/api/submit-answer`.
- Timer expiry reveals the correct answer and explanation locally.
- Score is tracked client-side for the current classroom session.

### Q&A

- Each slide allows up to 4 questions.
- Q&A processing must be sequential per session through an in-memory queue.
- Q&A must pause active narration or quiz timer.
- Q&A must resume playback/timer after completion.
- Q&A answer generation must stay within the lesson and current slide context.
- Out-of-scope questions must receive the configured one-sentence refusal.

### Attention

- Attention monitoring must be client-side and should not block the session if MediaPipe/webcam fails.
- The system must store raw attention readings and support per-user/per-slide summaries.
- Camera-off or unavailable webcam must produce no-face/zero-score readings when monitoring is active.

### Feedback

- Required fields: `sessionId`, `lessonId`, `rating`, `engagementRating`, `understandingRating`, `recommendation`.
- Feedback text is optional and capped at 500 characters in the UI.

## 6. Non-Functional Requirements

- Live sessions should load from stored MongoDB content and audio assets to minimize latency.
- AI generation failures during import/regeneration should mark lesson or slide state without crashing the server.
- Socket event handling should keep the classroom synchronized across reconnects.
- Attention monitoring should be best-effort and privacy-sensitive; raw webcam frames are not uploaded, only derived metrics.
- The app currently assumes a Windows environment with Microsoft PowerPoint installed for PPT import.
- Generated MP3/PNG assets must be served through `/uploads`.

## 7. Tech Stack and Usage Details

### Frontend

- React `19.2.6`: primary UI framework for admin dashboard, classroom, and feedback views.
- React DOM `19.2.6`: browser rendering entrypoint in `src/main.jsx`.
- Vite `5.4.0`: frontend dev server, build pipeline, and proxy layer.
- `@vitejs/plugin-react`: React transform integration for Vite.
- Axios `1.17.0`: REST calls for lessons, sessions, answers, feedback, and dynamic TTS synthesis.
- Socket.IO Client `4.8.3`: real-time classroom synchronization, slide changes, Q&A events, and attention batch emission.
- MediaPipe Tasks Vision `0.10.35`: browser-side FaceLandmarker for attention/focus detection.
- Lucide React `1.17.0`: icon set for meeting controls, dashboard actions, quiz/status UI, and feedback controls.
- CSS: custom dark Zoom-style design system in `src/index.css`, with variables for colors, typography, animations, panels, launcher, classroom, and feedback UI.
- ESLint `10.3.0`, `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`: frontend linting and React hook/refresh rules.

### Backend

- Node.js: JavaScript runtime for the Express and Socket.IO server. Installed dependency metadata includes packages requiring Node 18+; some transitive packages require Node 20+.
- Express `4.19.2`: REST API server for lessons, sessions, answers, feedback, attention summaries, and TTS synthesis.
- HTTP module: wraps Express for Socket.IO.
- Socket.IO `4.7.5`: server-side real-time room/event system for session state, slide sync, Q&A, and attention batch ingestion.
- Mongoose `8.4.1`: MongoDB ODM for lessons, slides, quizzes, sessions, answers, feedback, Q&A, and attention logs.
- MongoDB: persistent data store configured by `MONGODB_URI`, defaulting to `mongodb://localhost:27017/ai-classroom`.
- CORS `2.8.5`: enables browser API and socket access during development.
- Dotenv `16.4.5`: loads backend environment variables.
- UUID `9.0.1`: creates session IDs, Q&A IDs, and generated audio filenames.
- `@google/generative-ai` `0.11.0`: Gemini API client used for slide narration/quiz generation and live Q&A answers.
- Microsoft Cognitive Services Speech SDK `1.50.0`: Azure Neural TTS MP3 generation for narration, quiz intro, welcome, Q&A intro, answer, and outro files.
- `google-tts-api` `2.0.2`: installed but not currently used by the source code.
- Node `fs`, `path`, `child_process`: asset folder creation, static file paths, and PowerShell PPT conversion orchestration.

### External Services

- Google Gemini: configured through `GEMINI_API_KEY` and `GEMINI_API_KEY_BACKUP`; code attempts model failover.
- Azure Cognitive Services Speech: configured through `AZURE_TTS_KEY`, `AZURE_TTS_REGION`, `AZURE_TTS_VOICE`, `AZURE_TTS_LANGUAGE`, and an unused/available `AZURE_TTS_RATE` env key.
- MediaPipe hosted assets: client downloads WASM and FaceLandmarker model from CDN/Google storage.

### Platform and Tooling

- PowerShell script `server/scripts/convert_ppt.ps1`: runs PowerPoint COM automation to export slide PNGs and extract text.
- Microsoft PowerPoint desktop app: required on the server machine for PPT conversion.
- Static assets: generated slide/audio assets live under `server/public/uploads`; client public icons live under `client/public`; `client/dist` contains a built frontend artifact.

## 8. Architecture Overview

### Import-Time Flow

`PPT -> PowerShell/PowerPoint COM -> slide PNGs + extracted text -> MongoDB Slide docs -> Gemini narration/quizzes -> Azure TTS MP3s -> MongoDB completed lesson`

### Runtime Flow

`Admin starts session -> Session created -> Client joins Socket.IO room -> Stored slide emitted -> Client plays stored audio -> Quiz submitted -> Server advances slide -> Feedback`

### Q&A Flow

`Client ask-question -> server validates question limit -> QuestionAnswer pending -> session queue -> Azure intro TTS + Gemini answer -> Azure answer TTS -> room playback -> qa-playback-complete -> QuestionAnswer answered -> queue next`

### Attention Flow

`Webcam frame -> MediaPipe landmarks -> derived metrics -> client buffer -> attention-batch socket event -> AttentionLog insertMany -> REST/CLI summaries`

## 9. Data Model

### Lesson

- `title`: lesson title.
- `pptName`: source PowerPoint filename.
- `totalSlides`: slide count.
- `status`: `pending`, `processing`, `completed`, or `failed`.
- `createdAt`: creation timestamp.

### Slide

- `lessonId`: parent lesson.
- `slideNumber`: 1-based slide number.
- `imageUrl`: exported PNG URL.
- `extractedText`: PowerPoint text/table extraction output.
- `narrationText`: Gemini-generated trainer script.
- `quizIntroText`: used in code but missing from the current Mongoose schema; this should be added.
- `narrationAudioUrl`: stored narration MP3 URL.
- `quizIntroAudioUrl`: stored quiz intro MP3 URL.
- `quizId`: related quiz.
- `status`: `pending`, `completed`, or `failed`.

### Quiz

- `slideId`: parent slide.
- `question`: MCQ text.
- `options`: exactly 4 option strings.
- `correctAnswer`: 0-based option index.
- `explanation`: customer-friendly answer explanation.

### Session

- `sessionId`: UUID room/session ID.
- `lessonId`: associated lesson.
- `status`: `initializing`, `active`, or `completed`.
- `currentSlide`: current slide number.
- `startedAt`, `endedAt`: timestamps.
- `participants`: user/socket join records.

### Answer

- `userId`, `sessionId`, `slideId`, `questionId`.
- `answerIndex`, `isCorrect`, `responseTimeMs`, `timestamp`.

### QuestionAnswer

- `questionId`: UUID.
- `sessionId`, `userId`, `userName`, `slideNumber`.
- `questionText`, `answerText`.
- `status`: `pending`, `processing`, `answered`, or `failed`.
- `durationMs`, `createdAt`, `answeredAt`.

### AttentionLog

- `userId`, `sessionId`, `slideNumber`.
- `attentionScore`, `facePresent`, `headYaw`, `headPitch`, `earLeft`, `earRight`.
- `timestamp`.
- Indexed by session/user and session/slide.

### Feedback

- `sessionId`, `lessonId`, `rating`, `feedbackText`.
- `engagementRating`, `understandingRating`, `recommendation`.
- `submittedAt`.

## 10. REST API Requirements

- `GET /api/lessons`: list lessons newest first.
- `GET /api/lessons/:id`: get lesson and populated slides/quizzes.
- `POST /api/lessons/import`: start background PPT import.
- `POST /api/lessons/:id/regenerate`: start background AI regeneration.
- `POST /api/sessions`: create a classroom session for a lesson.
- `GET /api/sessions/:sessionId`: get session state with lesson populated.
- `POST /api/submit-answer`: save quiz answer and return correctness/explanation.
- `POST /api/sessions/:sessionId/question`: older REST Q&A endpoint that generates an answer/audio; Socket.IO Q&A is the richer current flow.
- `POST /api/tts/synthesize`: synthesize arbitrary text to a Q&A MP3.
- `POST /api/feedback`: save trainee feedback.
- `GET /api/attention/:sessionId/:userId`: list raw attention logs.
- `GET /api/attention/:sessionId/summary`: aggregate attention by user and slide.

## 11. Socket.IO Contract

### Client to Server

- `join-session`: join room and register participant.
- `request-next-slide`: request slide advance using optional current slide guard.
- `sync-slide`: request current or specific slide state.
- `attention-batch`: upload buffered attention readings.
- `ask-question`: ask a slide-specific trainee question.
- `qa-playback-complete`: confirm Q&A audio flow completed and classroom can resume.

### Server to Client

- `session-state`: send current slide/status and question count to joining client.
- `user-joined`, `user-left`: participant count updates.
- `next-slide`: send slide image, narration, quiz intro audio, quiz data, and question count.
- `session-ended`: signal completion.
- `qa-started`: pause classroom and show active question.
- `qa-intro-ready`: play generated intro audio.
- `qa-answer-ready`: play generated answer/outro audio and show answer text.
- `qa-resume`: resume narration/timer/auto-advance.
- `question-rejected`: show question rejection/error reason.

## 12. File Inventory

### Root

- `maruti_victoris_full.pptx`: fixed training module source.
- `Brief intro.txt`: domain notes and factual constraints for Victoris training.
- `notes.txt`: architecture rule that PPT/Gemini content should be processed once and reused.
- `# Phase 2 Architecture Update - Pre.txt`: detailed pre-generation architecture requirements.
- `PRD.md`: this product requirements document.

### Client Source

- `client/src/App.jsx`: app-level view switcher between admin, classroom, and feedback.
- `client/src/main.jsx`: React root bootstrap.
- `client/src/components/AdminDashboard.jsx`: lesson import, regeneration, polling, and session launch UI.
- `client/src/components/ZoomClassroom.jsx`: main classroom experience, Socket.IO events, slide playback, quiz, Q&A, webcam, and controls.
- `client/src/components/TrainingFeedback.jsx`: post-session feedback form.
- `client/src/hooks/useAttentionMonitor.js`: MediaPipe lifecycle, sampling interval, buffering, and socket emission.
- `client/src/services/attentionService.js`: FaceLandmarker initialization and attention score algorithm.
- `client/src/index.css`: primary app styling and animations.
- `client/src/App.css`: leftover/template CSS not imported by `App.jsx` in the current code path.
- `client/src/assets/*`: Vite/React sample SVGs and `hero.png`.

### Client Config and Build

- `client/package.json`, `client/package-lock.json`: frontend dependencies and scripts.
- `client/vite.config.js`: React plugin and proxy for `/api`, `/socket.io`, and `/uploads` to port 5000.
- `client/eslint.config.js`: lint rules.
- `client/index.html`: Vite HTML entry.
- `client/public/*`: favicon and icon sprites.
- `client/dist/*`: generated production build output.
- `client/node_modules/*`: installed dependency tree, not product source.

### Server Source

- `server/server.js`: Express/Socket.IO bootstrap, MongoDB connection, startup lesson self-heal, session room handling, Q&A queue integration, attention logging.
- `server/routes/sessionRoutes.js`: lesson/session/import/regenerate/answer/Q&A/TTS/feedback REST routes.
- `server/routes/attentionRoutes.js`: raw and summary attention REST routes.
- `server/services/geminiService.js`: Gemini prompts, model/key failover, lesson generation, question answering.
- `server/services/ttsService.js`: Azure Speech SDK MP3 generation.
- `server/services/questionQueue.js`: in-memory per-session sequential Q&A queue.
- `server/scripts/convert_ppt.ps1`: PowerPoint COM slide export and text extraction.
- `server/scripts/attention-report.js`: CLI report for latest session attention logs.
- `server/models/*.js`: Mongoose schemas.

### Server Config and Runtime Artifacts

- `server/package.json`, `server/package-lock.json`: backend dependencies and scripts.
- `server/.env`: local environment variable names and secrets; values should not be committed or exposed.
- `server/public/uploads/*`: generated slide/audio runtime assets.
- `server/node_modules/*`: installed dependency tree, not product source.

## 13. Environment Variables

- `PORT`: backend port, default `5000`.
- `MONGODB_URI`: MongoDB connection string.
- `GEMINI_API_KEY`: primary Gemini key.
- `GEMINI_API_KEY_BACKUP`: fallback Gemini key.
- `AZURE_TTS_KEY`: Azure Speech key.
- `AZURE_TTS_REGION`: Azure Speech region.
- `AZURE_TTS_VOICE`: optional voice, default `en-US-AndrewNeural`.
- `AZURE_TTS_LANGUAGE`: optional language, default `en-US`.
- `AZURE_TTS_RATE`: present in env but not currently used by `ttsService.js`.

## 14. Current Constraints and Risks

- PPT import is Windows-only and depends on installed Microsoft PowerPoint COM automation.
- `Slide` schema does not define `quizIntroText`, but backend writes it and client reads it. Mongoose strict mode means it may not persist unless schema is updated.
- `google-tts-api` is installed but unused.
- `App.css` appears to be leftover CSS and is not imported by the current app.
- Socket question counts are in-memory and reset if the server restarts.
- Q&A queue is in-memory and not durable.
- Startup self-heal logic deletes duplicate lessons and force-completes incomplete lessons, which may be risky for production data.
- Gemini model list includes names that may fail depending on API availability; failover handles errors but should be validated against supported model IDs.
- Live Q&A still calls Gemini during the session by design; the "no Gemini during normal sessions" rule applies to lesson narration/quizzes, not trainee questions.
- Client-generated `userId` is random per browser session and is not authenticated.
- No formal automated tests are present.

## 15. Success Metrics

- Lesson import completes successfully and produces one slide image, narration, quiz intro audio, and quiz per slide.
- Starting a completed lesson performs zero Gemini calls for stored slide narration/quizzes.
- Trainees can complete the full slide sequence without manual intervention.
- Quiz submissions are saved with correctness and response time.
- Q&A answer latency remains acceptable and does not break session playback.
- Attention logs are recorded every 3 seconds and can be summarized per user/per slide.
- Feedback submission succeeds after session completion.

## 16. Future Improvements

- Add `quizIntroText` to `SlideSchema` and backfill existing documents.
- Add authentication and stable trainee/admin identities.
- Move Q&A counters and queue state to persistent storage or Redis for restart safety.
- Add admin analytics dashboard for quiz performance, attention trends, Q&A history, and feedback.
- Replace fixed PPT path with upload/select workflow if multiple modules are needed.
- Add automated tests for REST routes, Socket.IO events, Gemini parsing fallback, and attention summary aggregation.
- Add production deployment configuration and secret management.
- Add explicit privacy notice and consent UX for webcam-based attention tracking.
