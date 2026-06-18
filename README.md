# AI Sales Training Classroom

A Zoom-style AI sales-training web app. A trainee joins a simulated classroom where an AI
instructor presents slides with synthesized narration, runs quizzes, and answers live
voice/chat questions (Gemini + Azure Neural TTS) with attention monitoring.

## Structure

- `client/` — React + Vite front-end (the Zoom-style classroom UI).
- `server/` — Node/Express + Socket.IO back-end (sessions, slides, quizzes, Q&A, TTS).

## Setup

```bash
# Server
cd server
npm install
# create server/.env (see below), then:
npm run dev

# Client (separate terminal)
cd client
npm install
npm run dev
```

### Environment

The server requires a `server/.env` file (not committed). Required keys:

```
MONGODB_URI=...
GEMINI_API_KEY=...
AZURE_TTS_KEY=...
AZURE_TTS_REGION=...
AZURE_TTS_VOICE=en-IN-PrabhatNeural
AZURE_TTS_LANGUAGE=en-IN
PORT=5000
```
