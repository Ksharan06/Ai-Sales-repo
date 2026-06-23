import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import useAttentionMonitor from '../hooks/useAttentionMonitor';
import useSpeechToText from '../hooks/useSpeechToText';
import { 
  Mic, MicOff, Video, VideoOff, MessageSquare, LogOut, 
  ChevronRight, Award, Clock, CheckCircle2, XCircle,
  Users, Share2, BarChart2, Shield, Loader2, AlertCircle, Info, HelpCircle,
  X, Check
} from 'lucide-react';

function ZoomClassroom({ sessionId, role = 'admin', resume = false, traineeId, traineeName, onLeave }) {
  // Admin is the authoritative driver of the session; trainees are passive mirrors.
  const isAdmin = role === 'admin';
  const adminResumedRef = useRef(false);
  const [session, setSession] = useState(null);
  const [slide, setSlide] = useState(null);

  
  // Audio & Speech States
  const [isPlayingNarration, setIsPlayingNarration] = useState(false);
  const [isTeacherSpeaking, setIsTeacherSpeaking] = useState(false);
  
  // UI Panels
  const [showQuiz, setShowQuiz] = useState(false);
  const [timer, setTimer] = useState(10);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [quizResult, setQuizResult] = useState(null);
  const [score, setScore] = useState(0);
  const [totalQuizzes, setTotalQuizzes] = useState(0);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [traineesList, setTraineesList] = useState([]);

  // Zoom hardware controls
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);

  // Meeting atmosphere (display-only) — elapsed session duration
  const [elapsedTime, setElapsedTime] = useState(0);

  // Meeting introduction flow:
  // 'welcome' -> 'sharing' -> 'training'
  // Admin sees the full intro on a fresh start. On admin refresh (resume) it skips
  // the intro and rejoins at the live slide. Trainees mirror via live-sync.
  const [meetingPhase, setMeetingPhase] = useState(() => (role === 'admin' && !resume ? 'welcome' : 'training'));

  // Trainee Question Interruption States
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const changeIsPaused = (val) => {
    setIsPaused(val);
    isPausedRef.current = val;
  };
  const [handRaised, setHandRaised] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isAskingQuestion, setIsAskingQuestion] = useState(false);

  // Q&A System States
  const [slideQuestionCount, setSlideQuestionCount] = useState(0);
  const [activeQA, setActiveQA] = useState(null);
  const userId = traineeId;
  const userName = traineeName;

  // Refs
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const localVideoRef = useRef(null);
  const attentionVideoRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const narrationTimeoutRef = useRef(null);
  const narrationTokenRef = useRef(0);
  const introTimeoutRef = useRef(null);
  const initialSlideRef = useRef(1);
  const slideRef = useRef(null); // always points at the current slide (avoids stale closures in timer callbacks)
  const lessonIdRef = useRef(null);
  const selectedOptionRef = useRef(null);
  const isSubmittedRef = useRef(false);
  const pendingAutoAdvanceRef = useRef(false);

  // Q&A System Refs
  const qaAudioRef = useRef(null);

  const showQuizRef = useRef(false);
  useEffect(() => {
    showQuizRef.current = showQuiz;
  }, [showQuiz]);

  const timerRef = useRef(10);
  useEffect(() => {
    timerRef.current = timer;
  }, [timer]);

  const activeQARef = useRef(null);
  useEffect(() => {
    activeQARef.current = activeQA;
  }, [activeQA]);

  // Interruption logic refs
  const narrationStartTimeRef = useRef(0);
  const narrationEstimatedMsRef = useRef(0);
  const elapsedBeforePauseRef = useRef(0);
  const narrationIsRunningRef = useRef(false);
  const speechPartRef = useRef('narration');
  const isAudioFilePlayingRef = useRef(false);
  const savedAudioSrcRef = useRef('');
  const savedAudioTimeRef = useRef(0);
  const savedAudioPartRef = useRef('');
  const isQaAudioPlayingRef = useRef(false);
  const resumeDeferredRef = useRef(false);

  // Monitor trainee attention silently in the background
  const { currentAttentionScore } = useAttentionMonitor(
    attentionVideoRef,
    meetingPhase === 'training',
    socketRef.current,
    userId,
    sessionId,
    slide ? slide.slideNumber : 1
  );

  const { isListening, interimText, startListening, stopListening, cancelListening } = useSpeechToText();
  const [micTarget, setMicTarget] = useState(null); // 'sidebar' | 'modal' | null

  // Initialize Socket.IO connection
  useEffect(() => {
    socketRef.current = io();

    // (Re)join on every connect so a network drop + reconnect re-syncs cleanly.
    socketRef.current.on('connect', () => {
      if (isAdmin) {
        socketRef.current.emit('join-session', { userId, sessionId });
        // Admin starts (or resumes — idempotent on the server) the live session.
        socketRef.current.emit('session-start', { sessionId });
      } else {
        // Trainees join via trainee-join only; the server replies with a full
        // live snapshot so they can mirror the admin immediately.
        socketRef.current.emit('trainee-join', { traineeId: userId, name: userName, sessionId });
      }
    });

    socketRef.current.on('session-state', async (state) => {
      const cs = (state && state.currentSlide) || 1;
      initialSlideRef.current = cs;
      if (state && state.slideQuestionCount !== undefined) {
        setSlideQuestionCount(state.slideQuestionCount);
      }
      // Admin RESUME (refresh): jump straight to the live slide — skip the intro so
      // we don't reset the shared live position back to the beginning.
      if (isAdmin && resume && !adminResumedRef.current && socketRef.current) {
        adminResumedRef.current = true;
        setMeetingPhase('training');
        socketRef.current.emit('sync-slide', { sessionId, slideNumber: cs });
      }
      // Fresh admin: the intro flow requests the slide itself (unchanged).
      // Trainees do not use session-state — they sync via the live-sync event.
    });

    // Trainee-only: admin's phase transition (narration -> quiz). Drives the
    // trainee UI instead of the trainee's own local audio-ended event.
    socketRef.current.on('phase-update', ({ phase, quizStartedAt, serverNow }) => {
      if (isAdmin) return;
      if (phase === 'quiz') {
        forceStopNarration();
        const elapsed = (quizStartedAt && serverNow) ? (serverNow - quizStartedAt) / 1000 : 0;
        const remaining = Math.max(1, Math.ceil(10 - elapsed));
        startQuizCountdown(remaining);
      }
    });

    // Trainee-only: the single live-position sync. Fired by the server on join /
    // refresh / reconnect (trainee-join reply) AND every time the admin begins a
    // new audio segment (intro, slide narration, quiz-intro). Always mirrors the
    // admin's exact current position from the correct offset.
    socketRef.current.on('live-sync', (payload) => {
      if (isAdmin) return;
      syncToLiveSession(payload);
    });

    // Trainee-only: mirror each Q&A audio segment (announcement -> answer ->
    // resume-cue) the admin is playing, in sync from the correct offset.
    socketRef.current.on('qa-audio-segment', (data) => {
      if (isAdmin) return;
      playQaSegment(data.segment, data.audioUrl, data.audioStartedAt, data.serverNow);
    });

    socketRef.current.on('next-slide', (slideData) => {
      // Reset quiz states for the new slide
      setShowQuiz(false);
      setSelectedOption(null);
      selectedOptionRef.current = null;
      setQuizResult(null);
      setTimer(10);
      setIsSubmitted(false);
      isSubmittedRef.current = false;
      pendingAutoAdvanceRef.current = false;
      setSlideQuestionCount(0);
      setActiveQA(null);
      clearInterval(timerIntervalRef.current);
      clearTimeout(narrationTimeoutRef.current);

      // Reset and stop HTML audio player narration if active
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      isAudioFilePlayingRef.current = false;
      savedAudioSrcRef.current = '';
      savedAudioTimeRef.current = 0;

      // Reset trainee Q&A interruption states for the new slide
      changeIsPaused(false);
      setHandRaised(false);
      setQuestionText('');
      setIsAskingQuestion(false);
      speechPartRef.current = 'narration';
      narrationIsRunningRef.current = false;

      setSlide(slideData);

      if (isAdmin) {
        // Admin: unchanged Phase 1 behaviour — play narration from the start.
        triggerAudioSequence(slideData);
        return;
      }

      // ---- Trainee mirror ----
      // Mid-join during a quiz: skip narration, open the quiz with remaining time.
      if (slideData.currentPhase === 'quiz') {
        const elapsed = (slideData.quizStartedAt && slideData.serverNow)
          ? (slideData.serverNow - slideData.quizStartedAt) / 1000 : 0;
        const remaining = Math.max(1, Math.ceil(10 - elapsed));
        setIsTeacherSpeaking(false);
        startQuizCountdown(remaining);
        return;
      }

      // Mid-join during a Q&A interrupt: show paused state, play answer audio from
      // offset if it's already available (best effort); qa-resume will sync everyone.
      if (slideData.qaInterrupt) {
        changeIsPaused(true);
        setShowSidebar(true);
        const qa = slideData.qaInterrupt;
        if (qa.audioUrl && qaAudioRef.current) {
          const offset = (qa.audioStartedAt && slideData.serverNow)
            ? Math.max(0, (slideData.serverNow - qa.audioStartedAt) / 1000) : 0;
          isQaAudioPlayingRef.current = true;
          qaAudioRef.current.src = qa.audioUrl;
          qaAudioRef.current.onloadedmetadata = () => {
            try { qaAudioRef.current.currentTime = offset; } catch { /* best-effort seek */ }
          };
          qaAudioRef.current.play().catch(() => {});
        }
        return;
      }

      // Normal mirror: play narration locally from the admin's current offset.
      const narrationOffset = (slideData.narrationAudioStartedAt && slideData.serverNow)
        ? Math.max(0, (slideData.serverNow - slideData.narrationAudioStartedAt) / 1000) : 0;
      triggerAudioSequence(slideData, narrationOffset);
    });

    // Q&A Sync Listeners
    socketRef.current.on('qa-started', (data) => {
      setSlideQuestionCount(data.slideQuestionCount);

      if (audioRef.current && !audioRef.current.paused && isAudioFilePlayingRef.current) {
        savedAudioSrcRef.current = audioRef.current.src;
        savedAudioTimeRef.current = audioRef.current.currentTime;
        savedAudioPartRef.current = speechPartRef.current;
        audioRef.current.pause();
      }
      isAudioFilePlayingRef.current = false;
      setIsTeacherSpeaking(false);

      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
      clearTimeout(narrationTimeoutRef.current);
      clearTimeout(introTimeoutRef.current);

      isQaAudioPlayingRef.current = false;
      resumeDeferredRef.current = false;

      changeIsPaused(true);

      setActiveQA({
        questionId: data.questionId,
        userName: data.userName,
        questionText: data.questionText,
        status: 'AI is thinking...',
        introAudioUrl: null,
        answerAudioUrl: null,
        outroAudioUrl: null,
        introFinished: false
      });

      setShowSidebar(true);
      setChatHistory(prev => {
        if (prev.some(m => m.questionId === data.questionId)) return prev;
        const sender = data.userName === userName ? 'You' : data.userName;
        return [
          ...prev,
          {
            sender,
            text: data.questionText,
            questionId: data.questionId,
            isQuestion: true
          }
        ];
      });
    });

    socketRef.current.on('qa-intro-ready', (data) => {
      setActiveQA(prev => {
        if (!prev || prev.questionId !== data.questionId) return prev;
        return { ...prev, introAudioUrl: data.introAudioUrl };
      });

      // Only the authoritative admin plays/sequences the Q&A chain; trainees mirror
      // each segment via the qa-audio-segment broadcast (see playQaSegment).
      if (isAdmin && qaAudioRef.current) {
        isQaAudioPlayingRef.current = true;
        qaAudioRef.current.src = data.introAudioUrl;
        // Announce this segment so every trainee plays it in sync from offset.
        if (socketRef.current) {
          socketRef.current.emit('qa-audio-segment', {
            segment: 'announcement',
            audioUrl: data.introAudioUrl,
            questionId: data.questionId,
            slideNumber: slideRef.current ? slideRef.current.slideNumber : null
          });
        }

        qaAudioRef.current.onended = () => {
          const current = activeQARef.current;
          if (current && current.questionId === data.questionId) {
            current.introFinished = true;
            setActiveQA(prev => ({ ...prev, introFinished: true }));
            if (current.answerAudioUrl) {
              playAnswerAudio(current.answerAudioUrl, current.outroAudioUrl);
            } else {
              isQaAudioPlayingRef.current = false;
              if (resumeDeferredRef.current) {
                resumeDeferredRef.current = false;
                executeQaResume();
              }
            }
          }
        };

        qaAudioRef.current.onerror = () => {
          const current = activeQARef.current;
          if (current && current.questionId === data.questionId) {
            current.introFinished = true;
            setActiveQA(prev => ({ ...prev, introFinished: true }));
            if (current.answerAudioUrl) {
              playAnswerAudio(current.answerAudioUrl, current.outroAudioUrl);
            } else {
              isQaAudioPlayingRef.current = false;
              if (resumeDeferredRef.current) {
                resumeDeferredRef.current = false;
                executeQaResume();
              }
            }
          }
        };

        qaAudioRef.current.play().catch(() => {
          const current = activeQARef.current;
          if (current && current.questionId === data.questionId) {
            current.introFinished = true;
            setActiveQA(prev => ({ ...prev, introFinished: true }));
            if (current.answerAudioUrl) {
              playAnswerAudio(current.answerAudioUrl, current.outroAudioUrl);
            } else {
              isQaAudioPlayingRef.current = false;
              if (resumeDeferredRef.current) {
                resumeDeferredRef.current = false;
                executeQaResume();
              }
            }
          }
        });
      }
    });

    socketRef.current.on('qa-answer-ready', (data) => {
      setActiveQA(prev => {
        if (!prev || prev.questionId !== data.questionId) return prev;
        
        if (prev.introFinished) {
          setTimeout(() => {
            playAnswerAudio(data.answerAudioUrl, data.outroAudioUrl);
          }, 0);
        }
        
        return {
          ...prev,
          answerAudioUrl: data.answerAudioUrl,
          outroAudioUrl: data.outroAudioUrl,
          answerText: data.answerText
        };
      });

      setChatHistory(prev => {
        if (prev.some(m => m.text === data.answerText)) return prev;
        return [
          ...prev,
          { sender: 'AI Instructor', text: data.answerText, questionId: data.questionId }
        ];
      });
    });

    socketRef.current.on('qa-resume', () => {
      if (isQaAudioPlayingRef.current) {
        resumeDeferredRef.current = true;
      } else {
        executeQaResume();
      }
    });

    socketRef.current.on('question-rejected', ({ reason }) => {
      alert(reason);
    });

    socketRef.current.on('session-ended', () => {
      alert("Training session completed!");
      onLeave(lessonIdRef.current);
    });

    socketRef.current.on('user-joined', () => {
      axios.get(`/api/trainees/${sessionId}`)
        .then(res => setTraineesList(res.data || []))
        .catch(err => console.error("Error fetching trainees on user-joined:", err.message));
    });

    socketRef.current.on('user-left', () => {
      axios.get(`/api/trainees/${sessionId}`)
        .then(res => setTraineesList(res.data || []))
        .catch(err => console.error("Error fetching trainees on user-left:", err.message));
    });

    // Fetch session details on mount
    axios.get(`/api/sessions/${sessionId}`)
      .then(res => {
        setSession(res.data);
        lessonIdRef.current = res.data?.lessonId?._id || res.data?.lessonId;
      })
      .catch(err => console.error("Error fetching session:", err.message));

    // Fetch initial trainees list on mount
    axios.get(`/api/trainees/${sessionId}`)
      .then(res => {
        setTraineesList(res.data || []);
      })
      .catch(err => console.error("Error fetching trainees on mount:", err.message));

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      clearInterval(timerIntervalRef.current);
      clearTimeout(narrationTimeoutRef.current);
      clearTimeout(introTimeoutRef.current);
    };
  }, [sessionId]);

  // Fetch trainees whenever the participants modal opens to ensure up-to-date data
  useEffect(() => {
    if (showParticipants && sessionId) {
      axios.get(`/api/trainees/${sessionId}`)
        .then(res => setTraineesList(res.data || []))
        .catch(err => console.error("Error fetching trainees on modal open:", err.message));
    }
  }, [showParticipants, sessionId]);

  const executeQaResume = () => {
    setActiveQA(null);
    changeIsPaused(false);
    setHandRaised(false);
    setIsAskingQuestion(false);

    if (pendingAutoAdvanceRef.current) {
      pendingAutoAdvanceRef.current = false;
      autoAdvanceNextSlide();
      return;
    }

    // Resume timer if quiz is active and not submitted
    if (showQuizRef.current && !isSubmittedRef.current && timerRef.current > 0) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        setTimer(prev => {
          if (prev <= 1) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
            finalizePoll();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    // Resume narration audio if there was saved audio
    if (savedAudioSrcRef.current && audioRef.current) {
      const savedSrc = savedAudioSrcRef.current;
      const savedTime = savedAudioTimeRef.current;
      const savedPart = savedAudioPartRef.current;

      audioRef.current.src = savedSrc;
      audioRef.current.currentTime = savedTime;
      speechPartRef.current = savedPart;
      isAudioFilePlayingRef.current = true;
      setIsTeacherSpeaking(true);

      if (savedPart === 'narration') {
        audioRef.current.onended = () => {
          const currentSlideRef = slideRef.current || slide;
          if (currentSlideRef?.quizIntroAudioUrl) {
            speechPartRef.current = 'intro';
            audioRef.current.src = currentSlideRef.quizIntroAudioUrl;
            audioRef.current.onended = () => {
              isAudioFilePlayingRef.current = false;
              setIsTeacherSpeaking(false);
              if (isAdmin) startQuizCountdown();
            };
            audioRef.current.onerror = () => {
              isAudioFilePlayingRef.current = false;
              setIsTeacherSpeaking(false);
              if (isAdmin) startQuizCountdown();
            };
            audioRef.current.play().catch(() => {
              isAudioFilePlayingRef.current = false;
              setIsTeacherSpeaking(false);
              if (isAdmin) startQuizCountdown();
            });
          } else {
            isAudioFilePlayingRef.current = false;
            setIsTeacherSpeaking(false);
            if (isAdmin) startQuizCountdown();
          }
        };
      } else if (savedPart === 'intro') {
        audioRef.current.onended = () => {
          isAudioFilePlayingRef.current = false;
          setIsTeacherSpeaking(false);
          if (isAdmin) startQuizCountdown();
        };
      } else if (savedPart === 'welcome') {
        audioRef.current.onended = () => {
          setIsTeacherSpeaking(false);
          setMeetingPhase('sharing');
        };
      }

      audioRef.current.onerror = () => {
        isAudioFilePlayingRef.current = false;
        setIsTeacherSpeaking(false);
        if (savedPart === 'welcome') {
          setMeetingPhase('sharing');
        } else if (isAdmin) {
          startQuizCountdown();
        }
      };

      audioRef.current.play().catch(err => {
        console.warn("Failed to resume narration:", err);
        isAudioFilePlayingRef.current = false;
        setIsTeacherSpeaking(false);
        if (savedPart === 'welcome') {
          setMeetingPhase('sharing');
        } else if (isAdmin) {
          startQuizCountdown();
        }
      });

      savedAudioSrcRef.current = '';
      savedAudioTimeRef.current = 0;
      savedAudioPartRef.current = '';
    }
  };

  // Trainee-only single shared routine: play one Q&A audio segment in sync with
  // the admin. Used for fresh segment events AND mid-Q&A join / reconnect (via
  // syncToLiveSession). Mirrors the live-narration offset math.
  const playQaSegment = (segment, audioUrl, audioStartedAt, serverNow) => {
    const offset = (audioStartedAt && serverNow)
      ? Math.max(0, (serverNow - audioStartedAt) / 1000) : 0;

    // Force-stop whatever is playing (narration / a previous Q&A segment) — clean.
    forceStopNarration();
    changeIsPaused(true);
    setShowSidebar(true);

    if (!audioUrl || !qaAudioRef.current) return;

    if (!qaAudioRef.current.paused) {
      qaAudioRef.current.pause();
    }
    qaAudioRef.current.onended = null;
    isQaAudioPlayingRef.current = true;
    qaAudioRef.current.src = audioUrl;
    qaAudioRef.current.onloadedmetadata = () => {
      if (offset > 0) {
        try {
          const dur = qaAudioRef.current.duration;
          if (isFinite(dur) && dur > 0) {
            qaAudioRef.current.currentTime = Math.min(offset, Math.max(0, dur - 0.1));
          }
        } catch { /* best-effort seek */ }
      }
    };
    const handleSegmentEnd = () => {
      isQaAudioPlayingRef.current = false;
      // When the resume cue finishes, resume the paused phase. The server's
      // qa-resume (driven by the admin) may have already arrived and deferred.
      if (segment === 'resume-cue' && resumeDeferredRef.current) {
        resumeDeferredRef.current = false;
        executeQaResume();
      }
    };
    qaAudioRef.current.onended = handleSegmentEnd;
    qaAudioRef.current.onerror = handleSegmentEnd;
    qaAudioRef.current.play().catch(() => { handleSegmentEnd(); });
  };

  const playAnswerAudio = (answerUrl, outroUrl) => {
    setActiveQA(prev => {
      if (!prev) return null;
      return { ...prev, status: 'Answering...' };
    });

    // Admin authoritative — trainees mirror via qa-audio-segment.
    if (!isAdmin) return;

    if (qaAudioRef.current) {
      isQaAudioPlayingRef.current = true;
      qaAudioRef.current.src = answerUrl;
      // Announce the answer segment so trainees play it in sync from offset.
      if (socketRef.current) {
        socketRef.current.emit('qa-audio-segment', {
          segment: 'answer',
          audioUrl: answerUrl,
          questionId: activeQARef.current ? activeQARef.current.questionId : null,
          slideNumber: slideRef.current ? slideRef.current.slideNumber : null
        });
      }
      qaAudioRef.current.onended = () => {
        playOutroAudio(outroUrl);
      };
      qaAudioRef.current.onerror = () => {
        playOutroAudio(outroUrl);
      };
      qaAudioRef.current.play().catch(() => {
        playOutroAudio(outroUrl);
      });
    }
  };

  const playOutroAudio = (outroUrl) => {
    // Admin authoritative — trainees mirror via qa-audio-segment.
    if (!isAdmin) return;

    if (qaAudioRef.current) {
      isQaAudioPlayingRef.current = true;
      qaAudioRef.current.src = outroUrl;
      // Announce the resume-cue segment so trainees play it in sync from offset.
      if (socketRef.current) {
        socketRef.current.emit('qa-audio-segment', {
          segment: 'resume-cue',
          audioUrl: outroUrl,
          questionId: activeQARef.current ? activeQARef.current.questionId : null,
          slideNumber: slideRef.current ? slideRef.current.slideNumber : null
        });
      }
      qaAudioRef.current.onended = () => {
        isQaAudioPlayingRef.current = false;
        // Only the authoritative admin signals completion, so the server resumes
        // and advances the Q&A queue exactly once for the whole room.
        if (isAdmin) {
          socketRef.current.emit('qa-playback-complete', {
            sessionId,
            questionId: activeQARef.current ? activeQARef.current.questionId : ''
          });
        }
        if (resumeDeferredRef.current) {
          resumeDeferredRef.current = false;
          executeQaResume();
        }
      };
      qaAudioRef.current.onerror = () => {
        isQaAudioPlayingRef.current = false;
        // Only the authoritative admin signals completion, so the server resumes
        // and advances the Q&A queue exactly once for the whole room.
        if (isAdmin) {
          socketRef.current.emit('qa-playback-complete', {
            sessionId,
            questionId: activeQARef.current ? activeQARef.current.questionId : ''
          });
        }
        if (resumeDeferredRef.current) {
          resumeDeferredRef.current = false;
          executeQaResume();
        }
      };
      qaAudioRef.current.play().catch(() => {
        isQaAudioPlayingRef.current = false;
        // Only the authoritative admin signals completion, so the server resumes
        // and advances the Q&A queue exactly once for the whole room.
        if (isAdmin) {
          socketRef.current.emit('qa-playback-complete', {
            sessionId,
            questionId: activeQARef.current ? activeQARef.current.questionId : ''
          });
        }
        if (resumeDeferredRef.current) {
          resumeDeferredRef.current = false;
          executeQaResume();
        }
      });
    }
  };

  // Keep slideRef in sync so timer callbacks always read the live slide (not a stale closure)
  useEffect(() => {
    slideRef.current = slide;
  }, [slide]);

  // Tick the meeting duration clock (purely visual)
  useEffect(() => {
    const id = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Format seconds as HH:MM:SS / MM:SS for the meeting clock
  const formatElapsed = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  // ---- Meeting introduction flow ------------------------------------------

  // Build a professional welcome message from the lesson (not hardcoded text).
  // Kept concise (~19s spoken) so screen sharing begins around the 22–23s mark.
  const buildWelcomeMessage = (lessonData) => {
    const title = (lessonData && lessonData.title) || "today's product training session";
    return (
      `Good morning everyone, and welcome to ${title}. ` +
      `Today we'll cover the key features, safety technologies, and variant differences, ` +
      `plus the best ways to present these benefits to customers. ` +
      `You'll also see short quizzes to reinforce your learning. ` +
      `Let's get started.`
    );
  };

  // Speak the welcome narration, then move to the screen-share transition.
  // Mirrors the robust slide-narration handling: tied to real audio end, with an
  // estimated-duration fallback if the browser blocks/instantly-ends speech.
  const playWelcomeNarration = async (lessonData) => {
    setIsTeacherSpeaking(true);

    const text = buildWelcomeMessage(lessonData);
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    // Welcome should run ~15–20s; estimate ~140 wpm with a sensible floor.
    const estimatedMs = Math.max(14000, Math.round((wordCount / 2.3) * 1000));

    const startTime = Date.now();
    narrationStartTimeRef.current = startTime;
    narrationEstimatedMsRef.current = estimatedMs;
    narrationIsRunningRef.current = true;
    speechPartRef.current = 'welcome';

    let done = false;
    const finishWelcome = () => {
      if (done) return;
      done = true;
      clearTimeout(introTimeoutRef.current);
      setIsTeacherSpeaking(false);
      narrationIsRunningRef.current = false;
      isAudioFilePlayingRef.current = false;
      setMeetingPhase('sharing');
    };
    const scheduleFinish = (ms) => {
      clearTimeout(introTimeoutRef.current);
      introTimeoutRef.current = setTimeout(finishWelcome, Math.max(0, ms));
    };

    // Long safety net so the intro can never hang
    scheduleFinish(estimatedMs * 3);

    try {
      // Synthesize welcome message on-the-fly via Azure Neural TTS
      const res = await axios.post('/api/tts/synthesize', { text });
      const { audioUrl } = res.data;

      if (audioUrl && audioRef.current) {
        isAudioFilePlayingRef.current = true;
        audioRef.current.src = audioUrl;
        // Report the intro as the live position so trainees mirror it at offset.
        if (isAdmin && socketRef.current) {
          socketRef.current.emit('admin-audio-start', { phase: 'intro', slideNumber: 1, audioUrl });
        }
        audioRef.current.onended = () => {
          isAudioFilePlayingRef.current = false;
          finishWelcome();
        };
        audioRef.current.onerror = () => {
          isAudioFilePlayingRef.current = false;
          console.warn("Welcome TTS audio failed to play, using timer fallback.");
          scheduleFinish(estimatedMs);
        };
        await audioRef.current.play();
      } else {
        scheduleFinish(estimatedMs);
      }
    } catch (err) {
      console.warn("Welcome narration TTS generation failed, using timer fallback:", err.message);
      scheduleFinish(estimatedMs);
    }
  };

  // Stage 1/2 : welcome screen shows immediately; audio starts exactly 2s after join
  // (Admin only — trainees skip the intro and mirror the admin's current state.)
  useEffect(() => {
    if (!isAdmin) return;
    if (meetingPhase !== 'welcome') return;
    const startAudio = setTimeout(() => playWelcomeNarration(session), 1500);
    return () => {
      clearTimeout(startAudio);
      clearTimeout(introTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingPhase]);

  // Stage 3 : brief screen-share transition (~1.5s), then training begins (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    if (meetingPhase !== 'sharing') return;
    const toTraining = setTimeout(() => setMeetingPhase('training'), 1500);
    return () => clearTimeout(toTraining);
  }, [meetingPhase]);

  // Stage 4 : training begins — request the first slide; existing flow takes over.
  // Admin only. On resume, the session-state handler already issued sync-slide for
  // the live slide, so we skip here to avoid snapping back to slide 1.
  useEffect(() => {
    if (!isAdmin) return;
    if (resume) return;
    if (meetingPhase !== 'training') return;
    if (socketRef.current) {
      socketRef.current.emit('sync-slide', { sessionId, slideNumber: initialSlideRef.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingPhase]);

  // Start Trainee webcam capture
  const startWebcam = async () => {
    try {
      // Reuse existing active stream if present to avoid hardware restart toggling
      if (webcamStreamRef.current && webcamStreamRef.current.active) {
        if (localVideoRef.current && localVideoRef.current.srcObject !== webcamStreamRef.current) {
          localVideoRef.current.srcObject = webcamStreamRef.current;
          localVideoRef.current.play().catch(err => console.warn("Failed to play local video:", err));
        }
        if (attentionVideoRef.current && attentionVideoRef.current.srcObject !== webcamStreamRef.current) {
          attentionVideoRef.current.srcObject = webcamStreamRef.current;
          attentionVideoRef.current.play().catch(err => console.warn("Failed to play attention video:", err));
        }
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 320, height: 240 }, 
        audio: false 
      });
      webcamStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(err => console.warn("Failed to play local video:", err));
      }
      if (attentionVideoRef.current) {
        attentionVideoRef.current.srcObject = stream;
        attentionVideoRef.current.play().catch(err => console.warn("Failed to play attention video:", err));
      }
    } catch (err) {
      console.warn("Webcam access denied or unavailable:", err.message);
      setCameraOn(false);
    }
  };

  // Stop Trainee webcam tracks
  const stopWebcam = () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (attentionVideoRef.current) {
      attentionVideoRef.current.srcObject = null;
    }
  };

  // Synchronize camera hardware with React state lifecycle (including layout unmount/remount)
  useEffect(() => {
    if (cameraOn) {
      startWebcam();
    } else {
      stopWebcam();
    }
    return () => {
      // Only stop webcam on unmount if camera is turned off globally,
      // or keep it running to prevent hardware resets on layout shifts
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, showSidebar]);

  // Safety net to re-bind the stream if refs mount or change state
  useEffect(() => {
    if (cameraOn && webcamStreamRef.current && webcamStreamRef.current.active) {
      if (localVideoRef.current && localVideoRef.current.srcObject !== webcamStreamRef.current) {
        localVideoRef.current.srcObject = webcamStreamRef.current;
        localVideoRef.current.play().catch(err => console.warn("Failed to play local video in safety net:", err));
      }
      if (attentionVideoRef.current && attentionVideoRef.current.srcObject !== webcamStreamRef.current) {
        attentionVideoRef.current.srcObject = webcamStreamRef.current;
        attentionVideoRef.current.play().catch(err => console.warn("Failed to play attention video in safety net:", err));
      }
    }
  }, [cameraOn, meetingPhase, showSidebar, localVideoRef.current, attentionVideoRef.current]);

  // Toggle Camera Hardware Button
  const toggleCamera = () => {
    setCameraOn(prev => !prev);
  };

  // Make text pronounceable for the voice-over WITHOUT changing any stored text
  // or the slide image. Spells out Maruti variant codes (e.g. "ZXi", "ZXi(O)",
  // "VXi") so the TTS engine doesn't read "Xi" as the Roman numeral 11.
  const toSpeakable = (text) => {
    if (!text || typeof text !== 'string') return text || '';
    return text
      // ZXi(O) / VXi(O) / ZXI(O) -> "Z X I option"
      .replace(/\b([A-Za-z])X[iI]\(O\)/g, (m, p1) => `${p1.toUpperCase()} X I option`)
      // ZXi / VXi / LXi / ZXI -> "Z X I"
      .replace(/\b([A-Za-z])X[iI]\b/g, (m, p1) => `${p1.toUpperCase()} X I`);
  };

  // Audio Playback or Speech Synthesis Fallback.
  // startOffsetSec > 0 is used by trainees joining mid-narration so they hear the
  // same point as the admin.
  const triggerAudioSequence = async (slideData, startOffsetSec = 0) => {
    setIsTeacherSpeaking(true);
    narrationTokenRef.current += 1;
    const myToken = narrationTokenRef.current;
    const isStale = () => myToken !== narrationTokenRef.current;

    const narrationText = slideData.narrationText || "";
    const rawQuizIntro = slideData.quizIntroText || "Let's check your knowledge on this slide.";
    const quizIntroText = `If you have any questions regarding this, you can ask questions by using the chat box. ${rawQuizIntro}`;

    // Estimated spoken duration (~140 wpm) — used only as a fallback when audio fails
    const wordCount = `${narrationText} ${quizIntroText}`.trim().split(/\s+/).filter(Boolean).length;
    const estimatedMs = Math.max(6000, Math.round((wordCount / 2.3) * 1000));

    // Narration (and quiz-intro) finished. Admin begins the quiz now (and tells
    // trainees via phase-change inside startQuizCountdown). Trainees do NOT start
    // the quiz from their own audio-end — they wait for the admin's phase-update.
    const completeNarration = () => {
      if (isStale()) return;
      isAudioFilePlayingRef.current = false;
      setIsTeacherSpeaking(false);
      narrationIsRunningRef.current = false;
      if (isAdmin) startQuizCountdown();
    };

    const revealQuiz = () => {
      if (isStale()) return;
      completeNarration();
    };

    const scheduleFallback = () => {
      clearTimeout(narrationTimeoutRef.current);
      narrationTimeoutRef.current = setTimeout(revealQuiz, estimatedMs);
    };

    if (slideData.narrationAudioUrl && audioRef.current) {
      try {
        isAudioFilePlayingRef.current = true;
        narrationIsRunningRef.current = true;
        speechPartRef.current = 'narration';

        audioRef.current.src = slideData.narrationAudioUrl;
        // Report slide narration as the live position (trainees mirror via live-sync).
        if (isAdmin && socketRef.current) {
          socketRef.current.emit('admin-audio-start', {
            phase: 'narration',
            slideNumber: slideData.slideNumber,
            audioUrl: slideData.narrationAudioUrl
          });
        }

        audioRef.current.onended = () => {
          if (isStale()) return;

          // Once slide narration finishes, play quiz intro MP3 if available
          if (slideData.quizIntroAudioUrl) {
            speechPartRef.current = 'intro';
            audioRef.current.src = slideData.quizIntroAudioUrl;
            // Report the quiz-intro as the live position too (trainees mirror it).
            if (isAdmin && socketRef.current) {
              socketRef.current.emit('admin-audio-start', {
                phase: 'narration',
                slideNumber: slideData.slideNumber,
                audioUrl: slideData.quizIntroAudioUrl
              });
            }

            audioRef.current.onended = () => {
              if (isStale()) return;
              completeNarration();
            };

            audioRef.current.onerror = () => {
              if (isStale()) return;
              console.error("Quiz intro MP3 failed to play, using fallback.");
              isAudioFilePlayingRef.current = false;
              revealQuiz();
            };

            audioRef.current.play().catch(err => {
              console.warn("Blocked playing quiz intro MP3, using fallback.", err);
              isAudioFilePlayingRef.current = false;
              revealQuiz();
            });
          } else {
            completeNarration();
          }
        };

        audioRef.current.onerror = () => {
          if (isStale()) return;
          console.error("Slide narration MP3 failed to load, using timer fallback.");
          isAudioFilePlayingRef.current = false;
          scheduleFallback();
        };

        // Trainee mid-join: seek narration to the admin's current offset.
        if (startOffsetSec > 0) {
          audioRef.current.onloadedmetadata = () => {
            try {
              const dur = audioRef.current.duration;
              if (isFinite(dur) && dur > 0) {
                audioRef.current.currentTime = Math.min(startOffsetSec, Math.max(0, dur - 0.3));
              }
            } catch { /* best-effort seek */ }
          };
        }

        await audioRef.current.play();
      } catch (err) {
        if (isStale()) return;
        console.warn("Failed playing slide narration MP3, using timer fallback:", err.message);
        isAudioFilePlayingRef.current = false;
        scheduleFallback();
      }
    } else {
      isAudioFilePlayingRef.current = false;
      scheduleFallback();
    }
  };

  // Trainee raises hand: Immediately Pause Session
  const handleRaiseHand = () => {
    if (isPausedRef.current) return;

    changeIsPaused(true);
    setHandRaised(true);

    // Save playing state of the HTML audio player
    if (audioRef.current && !audioRef.current.paused && isAudioFilePlayingRef.current) {
      savedAudioSrcRef.current = audioRef.current.src;
      savedAudioTimeRef.current = audioRef.current.currentTime;
      savedAudioPartRef.current = speechPartRef.current;
      audioRef.current.pause();
    } else {
      savedAudioSrcRef.current = '';
      savedAudioTimeRef.current = 0;
      savedAudioPartRef.current = '';
    }

    clearTimeout(narrationTimeoutRef.current);
    clearTimeout(introTimeoutRef.current);
  };

  // Resume the session from the exact point where it was paused
  const handleResume = () => {
    changeIsPaused(false);
    setHandRaised(false);

    if (pendingAutoAdvanceRef.current) {
      pendingAutoAdvanceRef.current = false;
      autoAdvanceNextSlide();
      return;
    }

    // If there was audio playing when we paused, resume it
    if (savedAudioSrcRef.current && audioRef.current) {
      const savedSrc = savedAudioSrcRef.current;
      const savedTime = savedAudioTimeRef.current;
      const savedPart = savedAudioPartRef.current;

      audioRef.current.src = savedSrc;
      audioRef.current.currentTime = savedTime;
      speechPartRef.current = savedPart;
      isAudioFilePlayingRef.current = true;
      setIsTeacherSpeaking(true);

      // Re-configure the correct onended handler based on which part was playing
      if (savedPart === 'narration') {
        audioRef.current.onended = () => {
          if (slide?.quizIntroAudioUrl) {
            speechPartRef.current = 'intro';
            audioRef.current.src = slide.quizIntroAudioUrl;
            audioRef.current.onended = () => {
              isAudioFilePlayingRef.current = false;
              setIsTeacherSpeaking(false);
              startQuizCountdown();
            };
            audioRef.current.onerror = () => {
              isAudioFilePlayingRef.current = false;
              setIsTeacherSpeaking(false);
              startQuizCountdown();
            };
            audioRef.current.play().catch(err => {
              isAudioFilePlayingRef.current = false;
              setIsTeacherSpeaking(false);
              startQuizCountdown();
            });
          } else {
            isAudioFilePlayingRef.current = false;
            setIsTeacherSpeaking(false);
            startQuizCountdown();
          }
        };
      } else if (savedPart === 'intro') {
        audioRef.current.onended = () => {
          isAudioFilePlayingRef.current = false;
          setIsTeacherSpeaking(false);
          startQuizCountdown();
        };
      } else if (savedPart === 'welcome') {
        audioRef.current.onended = () => {
          setIsTeacherSpeaking(false);
          setMeetingPhase('sharing');
        };
      }

      audioRef.current.onerror = () => {
        isAudioFilePlayingRef.current = false;
        setIsTeacherSpeaking(false);
        if (savedPart === 'welcome') {
          setMeetingPhase('sharing');
        } else {
          startQuizCountdown();
        }
      };

      audioRef.current.play().catch(err => {
        console.warn("Failed to resume audio playback:", err);
        isAudioFilePlayingRef.current = false;
        setIsTeacherSpeaking(false);
        if (savedPart === 'welcome') {
          setMeetingPhase('sharing');
        } else {
          startQuizCountdown();
        }
      });
      
      // Clear saved audio state
      savedAudioSrcRef.current = '';
      savedAudioTimeRef.current = 0;
      savedAudioPartRef.current = '';
    }
  };

  // Submit trainee question via Socket.IO
  const submitQuestion = async () => {
    if (!questionText.trim() || isAskingQuestion || slideQuestionCount >= 4 || activeQA !== null || isPaused) return;

    const currentQuestion = questionText;
    setQuestionText('');

    socketRef.current.emit('ask-question', {
      sessionId,
      userId,
      userName,
      slideNumber: slide ? slide.slideNumber : 1,
      questionText: currentQuestion
    });
  };

  // Voice input for Q&A — manual start/stop, no auto-stop on silence
  const handleMicStart = async (target) => {
    setMicTarget(target); // 'sidebar' or 'modal' — track which input is recording
    try {
      // Quick mic availability check before starting recognition —
      // helps catch silent failures that would otherwise just produce
      // garbage transcriptions instead of an obvious error.
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasMic = devices.some(d => d.kind === 'audioinput');
      if (!hasMic) {
        console.error('No microphone detected');
        setMicTarget(null);
        return;
      }
      await startListening();
    } catch (err) {
      console.error('Speech recognition error:', err);
      setMicTarget(null);
    }
  };

  const handleMicConfirm = async () => {
    const finalText = await stopListening();
    if (micTarget === 'sidebar') {
      setQuestionText(finalText);
    } else if (micTarget === 'modal') {
      if (typeof setAskQuestionText === 'function') {
        setAskQuestionText(finalText);
      }
    }
    setMicTarget(null);
  };

  const handleMicCancel = () => {
    cancelListening();
    setMicTarget(null);
  };

  // Force-stop the local narration audio immediately (no fade) — used by trainees
  // when the admin's phase-update arrives while their narration is still playing.
  const forceStopNarration = () => {
    narrationTokenRef.current += 1; // invalidate in-flight narration callbacks
    clearTimeout(narrationTimeoutRef.current);
    clearTimeout(introTimeoutRef.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.src = '';
    }
    isAudioFilePlayingRef.current = false;
    narrationIsRunningRef.current = false;
    setIsTeacherSpeaking(false);
  };

  // Start Quiz Countdown Timer. startSeconds < 10 is used by trainees joining a
  // quiz already in progress so they only get the remaining time.
  const startQuizCountdown = (startSeconds = 10) => {
    // Admin announces the quiz phase so every trainee mirrors it at the same time.
    if (isAdmin && socketRef.current) {
      socketRef.current.emit('phase-change', {
        sessionId,
        slideNumber: slideRef.current ? slideRef.current.slideNumber : (slide ? slide.slideNumber : 1),
        phase: 'quiz'
      });
    }

    clearInterval(timerIntervalRef.current);
    setShowQuiz(true);
    setTimer(startSeconds);
    setIsSubmitted(false);
    isSubmittedRef.current = false;
    setSelectedOption(null);
    selectedOptionRef.current = null;
    setTotalQuizzes(prev => prev + 1);

    timerIntervalRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerIntervalRef.current);
          finalizePoll();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // ---- Trainee mirror routines (admin position is the source of truth) -------

  // Apply a slide for a trainee without triggering the admin's local audio chain.
  // Quiz state is only reset when the slide actually changes, so re-syncs on the
  // same slide (narration -> quiz-intro) don't wipe an open quiz.
  const applyTraineeSlide = (slideData) => {
    const changed = !slideRef.current || slideRef.current.slideNumber !== slideData.slideNumber;
    setSlide(slideData);
    setMeetingPhase('training');
    if (changed) {
      setShowQuiz(false);
      setSelectedOption(null);
      selectedOptionRef.current = null;
      setQuizResult(null);
      setTimer(10);
      setIsSubmitted(false);
      isSubmittedRef.current = false;
      setSlideQuestionCount(0);
      setActiveQA(null);
    }
  };

  // Play the exact audio the admin is currently playing, from the given offset.
  // On end, the trainee simply waits for the admin's next live-sync / phase-update.
  const playMirrorAudio = (url, offsetSec, part) => {
    narrationTokenRef.current += 1;
    const myToken = narrationTokenRef.current;
    clearTimeout(narrationTimeoutRef.current);
    clearTimeout(introTimeoutRef.current);
    if (!url || !audioRef.current) {
      setIsTeacherSpeaking(false);
      return;
    }
    speechPartRef.current = part || 'narration';
    isAudioFilePlayingRef.current = true;
    setIsTeacherSpeaking(true);

    audioRef.current.src = url;
    audioRef.current.onloadedmetadata = () => {
      if (offsetSec > 0) {
        try {
          const dur = audioRef.current.duration;
          if (isFinite(dur) && dur > 0) {
            audioRef.current.currentTime = Math.min(offsetSec, Math.max(0, dur - 0.3));
          }
        } catch { /* best-effort seek */ }
      }
    };
    audioRef.current.onended = () => {
      if (myToken !== narrationTokenRef.current) return;
      isAudioFilePlayingRef.current = false;
      setIsTeacherSpeaking(false);
    };
    audioRef.current.onerror = () => {
      if (myToken !== narrationTokenRef.current) return;
      isAudioFilePlayingRef.current = false;
      setIsTeacherSpeaking(false);
    };
    audioRef.current.play().catch(() => {
      isAudioFilePlayingRef.current = false;
      setIsTeacherSpeaking(false);
    });
  };

  // THE single shared sync routine. Mirrors the admin's exact live position
  // (slide + phase + audio offset). Used identically for fresh join, refresh,
  // reconnect, and every ongoing admin audio segment.
  const syncToLiveSession = (payload) => {
    if (!payload || isAdmin) return;
    if (!payload.isLive) return;

    const offset = (payload.audioStartedAt && payload.serverNow)
      ? Math.max(0, (payload.serverNow - payload.audioStartedAt) / 1000) : 0;

    // Quiz in progress: open the quiz with the remaining time.
    if (payload.phase === 'quiz') {
      forceStopNarration();
      if (payload.slide) applyTraineeSlide(payload.slide);
      const elapsed = (payload.quizStartedAt && payload.serverNow)
        ? (payload.serverNow - payload.quizStartedAt) / 1000 : 0;
      startQuizCountdown(Math.max(1, Math.ceil(10 - elapsed)));
      return;
    }

    // Q&A interrupt active (mid-Q&A join / reconnect): land on the current segment
    // at the right offset via the same routine fresh segment events use.
    if (payload.phase === 'qa' && payload.qaInterrupt) {
      if (payload.slide) applyTraineeSlide(payload.slide);
      const qa = payload.qaInterrupt;
      playQaSegment(qa.segment, qa.audioUrl, qa.audioStartedAt, payload.serverNow);
      return;
    }

    // Welcome intro as a live position: show the intro screen, audio from offset.
    if (payload.phase === 'intro') {
      changeIsPaused(false);
      setShowQuiz(false);
      setSlide(null);
      setMeetingPhase('welcome');
      playMirrorAudio(payload.audioUrl, offset, 'welcome');
      return;
    }

    // Slide narration (or quiz-intro): render the slide, play current audio @ offset.
    if (payload.phase === 'narration') {
      changeIsPaused(false);
      if (payload.slide) applyTraineeSlide(payload.slide);
      const part = (payload.slide && payload.audioUrl === payload.slide.narrationAudioUrl) ? 'narration' : 'intro';
      playMirrorAudio(payload.audioUrl, offset, part);
      return;
    }

    // idle: admin hasn't begun audio yet — show the starting screen and wait.
    setShowQuiz(false);
    setSlide(null);
    setMeetingPhase('welcome');
    setIsTeacherSpeaking(false);
  };

  // Handle Option Selection (without submitting yet)
  const handleSelectOption = (idx) => {
    if (isSubmittedRef.current || quizResult) return;
    setSelectedOption(idx);
    selectedOptionRef.current = idx;
  };

  // Submit Answer Action
  const handleSubmitAnswer = async () => {
    if (isSubmittedRef.current || selectedOptionRef.current === null) return;
    setIsSubmitted(true);
    isSubmittedRef.current = true;
    await submitSelectedAnswer(selectedOptionRef.current);
  };

  // Asynchronously save answer to DB via API
  const submitSelectedAnswer = async (optionIndex) => {
    if (!slide || !slide.quiz || !slide.quiz._id) {
      setQuizResult({ isCorrect: false, correctAnswer: -1, explanation: 'No quiz data available for this slide.' });
      return;
    }

    try {
      const response = await axios.post('/api/submit-answer', {
        userId,
        sessionId,
        slideId: slide.slideId,
        questionId: slide.quiz._id,
        answerIndex: optionIndex,
        responseTimeMs: (10 - timer) * 1000
      });

      setQuizResult({
        ...response.data,
        wasManuallySubmitted: true
      });
      if (response.data.isCorrect) {
        setScore(prev => prev + 1);
      }
    } catch (err) {
      console.error("Error submitting answer:", err.message);
      setQuizResult({
        isCorrect: false,
        correctAnswer: slide.quiz.correctAnswer || 0,
        explanation: 'Your answer could not be verified due to a connection issue.',
        wasManuallySubmitted: true
      });
    }
  };

  // Finalize poll at countdown zero (shows correctness details and schedules auto-advance)
  const finalizePoll = async () => {
    if (!isSubmittedRef.current) {
      setIsSubmitted(true);
      isSubmittedRef.current = true;

      // Reveal the correct answer when the timer expires, whether or not the
      // trainee selected/submitted anything. Read the slide from the ref so the
      // timer callback never sees a stale closure (which would leave correctAnswer
      // undefined and prevent the green highlight). If they picked an option
      // without submitting, score it so the chosen-vs-correct highlight is accurate.
      const activeSlide = slideRef.current || slide;
      const correctAnswer = activeSlide?.quiz?.correctAnswer !== undefined ? activeSlide.quiz.correctAnswer : -1;
      const picked = selectedOptionRef.current;
      setQuizResult({
        isCorrect: picked !== null && picked === correctAnswer,
        correctAnswer,
        explanation: activeSlide?.quiz?.explanation || '',
        wasManuallySubmitted: false
      });
    }

    // Always wait 2.5 seconds before hiding the poll and advancing/deferring
    setTimeout(() => {
      if (isPausedRef.current) {
        setShowQuiz(false);
        pendingAutoAdvanceRef.current = true;
      } else if (isAdmin) {
        autoAdvanceNextSlide();
      } else {
        // Trainee: never drives progression — just hide the poll and wait for the
        // admin's next-slide broadcast.
        setShowQuiz(false);
      }
    }, 2500);
  };

  // Auto-advance progression to next slide (or feedback if final slide).
  // ADMIN ONLY — trainees mirror the resulting next-slide broadcast.
  const autoAdvanceNextSlide = () => {
    if (!isAdmin) {
      setShowQuiz(false);
      return;
    }
    clearInterval(timerIntervalRef.current);
    clearTimeout(narrationTimeoutRef.current);
    narrationTokenRef.current += 1;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    isAudioFilePlayingRef.current = false;
    savedAudioSrcRef.current = '';
    savedAudioTimeRef.current = 0;

    setShowQuiz(false);
    setSelectedOption(null);
    selectedOptionRef.current = null;
    setQuizResult(null);
    setTimer(10);
    setIsSubmitted(false);
    isSubmittedRef.current = false;

    const isLastSlide = slide && session && session.lessonId && (slide.slideNumber === session.lessonId.totalSlides);
    if (isLastSlide) {
      socketRef.current.emit('request-next-slide', { sessionId, currentSlide: slide?.slideNumber });
      onLeave(lessonIdRef.current);
      return;
    }

    socketRef.current.emit('request-next-slide', { sessionId, currentSlide: slide?.slideNumber });
  };

  // Request Next Slide from Socket Server
  const handleNextSlide = () => {
    // Immediately dismiss the current poll so it never lingers onto the next slide.
    // It will reappear only when narration for the new slide completes (auto),
    // or when the Polls toolbar button is clicked.
    clearInterval(timerIntervalRef.current);
    clearTimeout(narrationTimeoutRef.current);
    narrationTokenRef.current += 1; // invalidate any in-flight narration callbacks

    // Reset and stop HTML audio player narration if active
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    isAudioFilePlayingRef.current = false;
    savedAudioSrcRef.current = '';
    savedAudioTimeRef.current = 0;

    setShowQuiz(false);
    setSelectedOption(null);
    setQuizResult(null);
    setTimer(10);

    const isLastSlide = slide && session && session.lessonId && (slide.slideNumber === session.lessonId.totalSlides);
    if (isLastSlide) {
      socketRef.current.emit('request-next-slide', { sessionId });
      onLeave(lessonIdRef.current);
      return;
    }

    socketRef.current.emit('request-next-slide', { sessionId });
  };

  return (
    <div className="zoom-container animate-fade">
      {/* Hidden audio elements */}
      <audio ref={audioRef} style={{ display: 'none' }} />
      <audio ref={qaAudioRef} style={{ display: 'none' }} />



      {/* Hidden video element for attention tracking */}
      <video
        ref={attentionVideoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          top: '-9999px',
          left: '-9999px',
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none'
        }}
      />

      {/* Top Zoom Meeting Header */}
      <div style={{
        height: '44px',
        backgroundColor: '#0a0d14',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        fontSize: '0.75rem',
        color: '#fff',
        fontFamily: 'var(--font-body)',
        zIndex: 25
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#ef4444', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="rec-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
            REC
          </span>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
          {/* Meeting duration clock */}
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-secondary)' }}>
            <Clock style={{ width: '13px', height: '13px' }} />
            <span style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>{formatElapsed(elapsedTime)}</span>
          </span>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
          <span style={{ color: 'var(--color-text-secondary)' }}>Zoom Meeting: Sales Training Session</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Network signal indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-secondary)', fontWeight: '500' }}>
            <span className="net-bars"><span /><span /><span /><span /></span>
            <span style={{ fontSize: '0.7rem' }}>Stable</span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontWeight: '500' }}>
            <Shield style={{ width: '14px', height: '14px' }} />
            <span>End-to-End Encrypted</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="zoom-content" style={{ display: 'flex', height: 'calc(100vh - 124px)' }}>
        
        {/* Left Side: Shared Screen (PPT Slide) */}
        <div className="zoom-main-area" style={{ flex: '1', display: 'flex', position: 'relative', padding: '20px', backgroundColor: '#0f172a' }}>
          
          {/* Shared Screen Wrapper */}
          {slide ? (
            <div
              className="glass-panel screen-share-frame"
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                position: 'relative',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px'
              }}
            >
              {/* Screen Share Tag */}
              <div style={{
                height: '40px', 
                backgroundColor: '#1e293b', 
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                padding: '0 16px', 
                fontSize: '0.8rem', 
                zIndex: '5'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    backgroundColor: '#16a34a', 
                    color: '#fff', 
                    padding: '4px 10px',
                    borderRadius: '4px', 
                    fontSize: '0.7rem', 
                    fontWeight: '600',
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '4px'
                  }}>
                    <span className="live-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fff' }} />
                    Viewing AI Instructor's screen
                  </span>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.75rem', fontWeight: '500' }}>Zoom Screen Share</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-secondary)', fontSize: '0.75rem' }}>
                  <span>Slide {slide.slideNumber} of {session?.lessonId?.totalSlides || 6}</span>
                  <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
                  <span style={{ color: slideQuestionCount >= 4 ? 'var(--accent-error)' : 'var(--color-text-secondary)', fontWeight: slideQuestionCount >= 4 ? '700' : 'normal' }}>
                    Questions: {slideQuestionCount} / 4
                  </span>
                </div>
              </div>

              {/* PPT Slide Render - ONLY slide image centered */}
              <div style={{ display: 'flex', flex: '1', backgroundColor: '#020617', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                <img
                  key={slide.slideNumber}
                  className="slide-swap"
                  src={slide.imageUrl && typeof slide.imageUrl === 'string' ? slide.imageUrl : ''}
                  alt={`Slide ${slide.slideNumber}`}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />

                {/* Realistic presentation viewport vignette */}
                <div className="presentation-vignette" />

                {/* Interactive Quiz / Poll Overlay centered on the slide image area (below the banner) */}
                {showQuiz && slide && slide.quiz && (
                  <div 
                    className="glass-panel"
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: '460px',
                      maxHeight: '90%',
                      zIndex: 100,
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '24px',
                      boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      borderRadius: '16px',
                      animation: 'zoomPollFadeIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
                    }}
                  >
                    {/* Poll Header */}
                    <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <BarChart2 style={{ width: '18px', height: '18px', color: 'var(--accent-primary)' }} />
                        <span style={{ fontSize: '0.9rem', fontWeight: '700', color: '#fff' }}>Classroom Poll (Quiz)</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--accent-warning)', fontWeight: '600' }}>
                          <Clock style={{ width: '14px', height: '14px' }} />
                          <span>{timer}s</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: '#fff', fontWeight: '600' }}>
                          <Award style={{ width: '14px', height: '14px', color: 'gold' }} />
                          <span>{score}/{totalQuizzes}</span>
                        </div>
                      </div>
                    </div>

                    {/* Scrollable body: question + options + explanation scroll together */}
                    <div style={{ display: 'flex', flexDirection: 'column', flex: '1', minHeight: 0, overflowY: 'auto', marginBottom: '16px', paddingRight: '6px' }}>
                    {/* Question */}
                    <h4 style={{ fontSize: '0.95rem', marginBottom: '16px', color: '#fff', lineHeight: '1.5', fontWeight: '600' }}>
                      {slide.quiz.question}
                    </h4>

                    {/* Options List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {slide.quiz.options.map((option, idx) => {
                        let btnStyle = {
                          width: '100%', 
                          padding: '12px 16px', 
                          borderRadius: '10px',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          backgroundColor: 'rgba(255, 255, 255, 0.03)',
                          color: 'var(--color-text-secondary)', 
                          textAlign: 'left',
                          fontSize: '0.8rem', 
                          cursor: 'pointer', 
                          transition: 'var(--transition-smooth)',
                          fontWeight: '500'
                        };

                        if (selectedOption === idx) {
                          btnStyle.backgroundColor = 'rgba(59, 130, 246, 0.18)';
                          btnStyle.borderColor = 'var(--accent-primary)';
                          btnStyle.color = '#fff';
                        }

                        // After quiz evaluated (manual submit OR timer expiry),
                        // glow the correct option green and any selected-wrong option red.
                        if (quizResult) {
                          if (quizResult.correctAnswer === idx) {
                            // Correct answer always glows green
                            btnStyle.backgroundColor = 'rgba(34, 197, 94, 0.28)';
                            btnStyle.borderColor = 'var(--accent-success)';
                            btnStyle.color = '#fff';
                            btnStyle.fontWeight = '700';
                            btnStyle.boxShadow = '0 0 18px rgba(34, 197, 94, 0.65)';
                          } else if (selectedOption === idx) {
                            // The option the trainee picked (wrong) glows red
                            btnStyle.backgroundColor = 'rgba(239, 68, 68, 0.28)';
                            btnStyle.borderColor = 'var(--accent-error)';
                            btnStyle.color = '#fff';
                            btnStyle.fontWeight = '700';
                            btnStyle.boxShadow = '0 0 18px rgba(239, 68, 68, 0.6)';
                          }
                        }

                        return (
                          <button 
                            key={idx} 
                            onClick={() => handleSelectOption(idx)}
                            disabled={isSubmitted || !!quizResult || isPaused}
                            style={btnStyle}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>

                    {/* Quiz result evaluation (scrolls with the body) */}
                    {quizResult && quizResult.wasManuallySubmitted && (
                      <div className="animate-fade" style={{ display: 'flex', flexDirection: 'column', marginTop: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: '700', marginBottom: '10px', color: quizResult.isCorrect ? 'var(--accent-success)' : 'var(--accent-error)' }}>
                          {quizResult.isCorrect ? (
                            <><CheckCircle2 style={{ width: '16px', height: '16px' }} /> Correct Answer</>
                          ) : (
                            <><XCircle style={{ width: '16px', height: '16px' }} /> Incorrect Answer</>
                          )}
                        </div>

                        <p style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)', lineHeight: '1.5' }}>
                          <strong>Explanation:</strong> {quizResult.explanation}
                        </p>
                      </div>
                    )}
                    </div>
                    {/* End scrollable body */}

                    {/* Footer: Submit Answer button is visible below the scroll area */}
                    <button
                      onClick={handleSubmitAnswer}
                      disabled={isSubmitted || selectedOption === null || isPaused}
                      style={{
                        flexShrink: 0,
                        width: '100%',
                        padding: '12px',
                        background: isSubmitted 
                          ? 'rgba(255, 255, 255, 0.1)' 
                          : 'linear-gradient(135deg, var(--accent-primary) 0%, hsl(217, 91%, 50%) 100%)',
                        color: isSubmitted ? 'var(--color-text-muted)' : '#fff',
                        border: 'none',
                        borderRadius: '10px',
                        fontWeight: '700',
                        fontSize: '0.85rem',
                        cursor: isSubmitted ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'var(--transition-smooth)',
                        boxShadow: isSubmitted ? 'none' : '0 4px 15px rgba(59, 130, 246, 0.3)'
                      }}
                    >
                      {isSubmitted 
                        ? 'Answer Submitted' 
                        : timer === 0 
                          ? 'Timer Expired' 
                          : 'Submit Answer'}
                    </button>
                  </div>
                )}

                {/* Participants Panel/Modal */}
                {showParticipants && (
                  <div 
                    className="glass-panel"
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: '400px',
                      maxHeight: '80%',
                      zIndex: 100,
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '24px',
                      boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      borderRadius: '16px',
                      color: '#fff',
                      fontFamily: 'var(--font-body)'
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Users style={{ width: '18px', height: '18px', color: 'var(--accent-primary)' }} />
                        <span style={{ fontSize: '1.1rem', fontWeight: '700' }}>Participants</span>
                      </div>
                      <button 
                        onClick={() => setShowParticipants(false)}
                        style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', borderRadius: '50%', transition: 'background-color 0.2s' }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.08)'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                      >
                        <X style={{ width: '18px', height: '18px' }} />
                      </button>
                    </div>

                    {/* Content */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--color-text-secondary)', marginBottom: '4px', textAlign: 'left' }}>
                        Trainees Present:
                      </div>
                      
                      {/* Trainees List */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '250px', paddingRight: '4px' }}>
                        {traineesList.length === 0 ? (
                          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '12px 0', textAlign: 'left' }}>
                            No trainees present.
                          </div>
                        ) : (
                          traineesList.map((trainee) => (
                            <div 
                              key={trainee._id || trainee.traineeId}
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '10px', 
                                padding: '8px 12px', 
                                backgroundColor: 'rgba(255,255,255,0.02)', 
                                border: '1px solid rgba(255,255,255,0.04)',
                                borderRadius: '8px' 
                              }}
                            >
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#22c55e' }} />
                              <span style={{ fontSize: '0.85rem', fontWeight: '500', color: '#fff', textAlign: 'left' }}>
                                {trainee.name}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Pre-presentation meeting room (join state, welcome, screen-share start) */
            <div
              className="glass-panel"
              style={{
                width: '100%', height: '100%',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: '20px', textAlign: 'center',
                border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px',
                backgroundColor: '#0b1220'
              }}
            >
              {meetingPhase === 'welcome' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
                  {/* Speaking avatar */}
                  <div style={{ position: 'relative', width: '88px', height: '88px' }}>
                    <span className="avatar-ring" />
                    <span className="avatar-ring delay" />
                    <div style={{ width: '88px', height: '88px', borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', fontWeight: '700', color: '#fff', position: 'relative', zIndex: 1 }}>
                      AI
                    </div>
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '6px' }}>AI Instructor is welcoming the team…</h3>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Waiting for the presentation to start…</p>
                  </div>
                  {/* Speaking wave */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '20px' }}>
                    <div style={{ width: '3px', backgroundColor: '#3b82f6', borderRadius: '2px', height: '8px', animation: 'bounceSpeakerWave 0.5s infinite alternate' }} />
                    <div style={{ width: '3px', backgroundColor: '#3b82f6', borderRadius: '2px', height: '16px', animation: 'bounceSpeakerWave 0.5s infinite alternate 0.15s' }} />
                    <div style={{ width: '3px', backgroundColor: '#3b82f6', borderRadius: '2px', height: '11px', animation: 'bounceSpeakerWave 0.5s infinite alternate 0.3s' }} />
                    <div style={{ width: '3px', backgroundColor: '#3b82f6', borderRadius: '2px', height: '18px', animation: 'bounceSpeakerWave 0.5s infinite alternate 0.45s' }} />
                  </div>
                </div>
              ) : (
                /* Screen-share start + brief slide-load gap */
                <div className="animate-fade" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Share2 style={{ width: '28px', height: '28px', color: '#22c55e' }} />
                  </div>
                  <h3 style={{ fontSize: '1.15rem', color: '#fff' }}>AI Instructor has started screen sharing</h3>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Preparing slide 1…</p>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Right Side: Zoom Video Feeds Sidebar */}
        {/* Right Side: Zoom Sidebar (Always visible to keep PPT size constant) */}
        <div className="zoom-sidebar" style={{ width: '320px', padding: '16px', gap: '16px', display: 'flex', flexDirection: 'column', backgroundColor: '#0f121a', borderLeft: '1px solid rgba(255, 255, 255, 0.05)', height: '100%', overflowY: 'auto' }}>

          <div style={{
            display: showSidebar ? 'flex' : 'none',
              flexDirection: 'column',
              height: '100%',
              fontFamily: 'var(--font-body)',
              color: 'var(--color-text-primary)'
            }}>
              {/* Panel Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: '12px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                marginBottom: '16px'
              }}>
                <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#fff' }}>Ask Your Question</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Slide {slide ? slide.slideNumber : 1} of {session?.lessonId?.totalSlides || 6}
                </span>
              </div>

              {/* Conversation Area */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                marginBottom: '16px',
                paddingRight: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                {chatHistory.length === 0 ? (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    textAlign: 'center',
                    color: 'var(--color-text-muted)',
                    padding: '20px'
                  }}>
                    <HelpCircle style={{ width: '36px', height: '36px', color: 'var(--accent-primary)', opacity: 0.6, marginBottom: '10px' }} />
                    <p style={{ fontSize: '0.8rem' }}>Have a question about this slide?</p>
                    <p style={{ fontSize: '0.75rem', marginTop: '4px' }}>Raise your hand to pause the session and ask the instructor.</p>
                  </div>
                ) : (
                  chatHistory.map((msg, index) => {
                    const isMe = msg.sender === 'You';
                    const isAI = msg.sender === 'AI Instructor';
                    return (
                      <div 
                        key={index}
                        className="animate-slide"
                        style={{
                          alignSelf: isMe ? 'flex-end' : 'flex-start',
                          maxWidth: '90%',
                          backgroundColor: isMe ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                          border: isMe ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '12px',
                          padding: '10px 12px',
                          lineHeight: '1.4'
                        }}
                      >
                        <div style={{ 
                          fontSize: '0.7rem', 
                          fontWeight: '700', 
                          color: isAI ? 'var(--accent-success)' : 'var(--accent-primary)',
                          marginBottom: '4px'
                        }}>
                          {msg.sender}
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-primary)', whiteSpace: 'pre-line' }}>{msg.text}</p>
                      </div>
                    );
                  })
                )}
                
                {activeQA && !activeQA.answerText && (
                  <div style={{
                    alignSelf: 'flex-start',
                    maxWidth: '90%',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: 'var(--color-text-muted)'
                  }}>
                    <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} />
                    <span style={{ fontSize: '0.75rem' }}>AI Instructor is answering...</span>
                  </div>
                )}
              </div>

              {/* Question Input Box & Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

                {/* Input container */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                  {isListening && micTarget === 'sidebar' ? (
                    /* Recording state: waveform + cancel + confirm */
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '4px' }}>
                      <div style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 14px',
                        borderRadius: '24px',
                        backgroundColor: 'rgba(0,0,0,0.25)',
                        border: '1px solid rgba(255,255,255,0.1)'
                      }}>
                        {/* Waveform bars */}
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '3px', height: '20px', overflow: 'hidden' }}>
                          {Array.from({ length: 28 }).map((_, i) => (
                            <span
                              key={i}
                              style={{
                                width: '2.5px',
                                borderRadius: '2px',
                                backgroundColor: 'var(--color-text-muted)',
                                height: `${30 + Math.abs(Math.sin(i * 0.7 + Date.now() / 200)) * 0}%`, // base height; animation handled by CSS class below
                                animation: `waveformBar 0.8s ease-in-out ${i * 0.04}s infinite`
                              }}
                            />
                          ))}
                        </div>

                        {/* Cancel (X) */}
                        <button
                          onClick={handleMicCancel}
                          title="Cancel recording"
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: '2px'
                          }}
                        >
                          <X style={{ width: '18px', height: '18px' }} />
                        </button>

                        {/* Confirm (check) */}
                        <button
                          onClick={handleMicConfirm}
                          title="Stop and use this question"
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', padding: '2px'
                          }}
                        >
                          <Check style={{ width: '18px', height: '18px' }} />
                        </button>
                      </div>
                      <p style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: '4px', textAlign: 'center' }}>
                        Speak clearly into your microphone
                      </p>
                    </div>
                  ) : (
                    /* Normal state: text input + mic icon + send */
                    <>
                      <input
                        type="text"
                        value={questionText}
                        onChange={(e) => setQuestionText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') submitQuestion(); }}
                        disabled={isAskingQuestion || slideQuestionCount >= 4 || activeQA !== null || isPaused}
                        placeholder={slideQuestionCount >= 4 ? "Question limit reached for this slide" : "Ask a question"}
                        style={{
                          flex: 1,
                          padding: '10px 40px 10px 12px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(0,0,0,0.2)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: '#fff',
                          fontSize: '0.8rem',
                          outline: 'none',
                          transition: 'var(--transition-smooth)'
                        }}
                      />
                      <button
                        onClick={() => handleMicStart('sidebar')}
                        disabled={isAskingQuestion || slideQuestionCount >= 4 || activeQA !== null || isPaused}
                        title="Ask with voice"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: '4px'
                        }}
                      >
                        <Mic style={{ width: '18px', height: '18px' }} />
                      </button>
                      <button
                        onClick={submitQuestion}
                        disabled={isAskingQuestion || !questionText.trim() || slideQuestionCount >= 4 || activeQA !== null || isPaused}
                        style={{
                          background: 'none', border: 'none', padding: '4px',
                          color: (!isAskingQuestion && questionText.trim() && slideQuestionCount < 4 && activeQA === null && !isPaused) ? 'var(--accent-primary)' : 'var(--color-text-muted)',
                          cursor: (!isAskingQuestion && questionText.trim() && slideQuestionCount < 4 && activeQA === null && !isPaused) ? 'pointer' : 'not-allowed'
                        }}
                      >
                        <ChevronRight style={{ width: '18px', height: '18px' }} />
                      </button>
                    </>
                  )}
                </div>

                {/* Action Button: Raise Hand / Hand Raised / Resume */}
                {!isPaused ? (
                  <button
                    onClick={submitQuestion}
                    disabled={!questionText.trim() || isAskingQuestion || slideQuestionCount >= 4 || activeQA !== null}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: (questionText.trim() && slideQuestionCount < 4 && activeQA === null) ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                      border: (questionText.trim() && slideQuestionCount < 4 && activeQA === null) ? '1px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '8px',
                      color: (questionText.trim() && slideQuestionCount < 4 && activeQA === null) ? 'var(--accent-primary)' : 'var(--color-text-muted)',
                      fontWeight: '600',
                      fontSize: '0.8rem',
                      cursor: (questionText.trim() && slideQuestionCount < 4 && activeQA === null) ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'var(--transition-smooth)'
                    }}
                  >
                    <span>✋</span> Raise Hand
                  </button>
                ) : (
                  <button
                    disabled
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      border: '1px solid var(--accent-warning)',
                      borderRadius: '8px',
                      color: 'var(--accent-warning)',
                      fontWeight: '600',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px'
                    }}
                  >
                    <span>✋</span> Hand Raised
                  </button>
                )}

              </div>
            </div>


            <div style={{ display: showSidebar ? 'none' : 'flex', flexDirection: 'column', gap: '16px', height: '100%', width: '100%' }}>
              {/* AI Teacher Video Card */}
              <div
                className={`participant-card ${isTeacherSpeaking ? 'card-speaking' : ''}`}
                style={{
                  flex: '1',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  backgroundColor: '#11151d',
                  border: isTeacherSpeaking ? '2.5px solid #3b82f6' : '1.5px solid rgba(255, 255, 255, 0.06)',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'var(--transition-smooth)'
                }}
              >
                {/* Mic Icon & Speaking Waves in Top-Left */}
                <div style={{ position: 'absolute', top: '12px', left: '12px', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <Mic className={isTeacherSpeaking ? 'mic-live' : ''} style={{ width: '12px', height: '12px', color: '#22c55e' }} />
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '10px' }}>
                    <div style={{ width: '2px', height: isTeacherSpeaking ? '8px' : '2px', backgroundColor: '#22c55e', animation: isTeacherSpeaking ? 'bounceSpeakerWave 0.5s infinite alternate' : 'none' }}></div>
                    <div style={{ width: '2px', height: isTeacherSpeaking ? '10px' : '2px', backgroundColor: '#22c55e', animation: isTeacherSpeaking ? 'bounceSpeakerWave 0.5s infinite alternate 0.15s' : 'none' }}></div>
                    <div style={{ width: '2px', height: isTeacherSpeaking ? '6px' : '2px', backgroundColor: '#22c55e', animation: isTeacherSpeaking ? 'bounceSpeakerWave 0.5s infinite alternate 0.3s' : 'none' }}></div>
                  </div>
                </div>

                {/* Speaking badge overlay */}
                {isTeacherSpeaking && (
                  <span style={{ position: 'absolute', top: '12px', right: '12px', backgroundColor: '#2563eb', color: '#fff', fontSize: '0.6rem', padding: '2px 8px', borderRadius: '4px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Speaking
                  </span>
                )}

                {/* Circular Avatar (with audio-reactive rings while speaking) */}
                <div style={{ position: 'relative', width: '90px', height: '90px' }}>
                  {isTeacherSpeaking && (
                    <>
                      <span className="avatar-ring" />
                      <span className="avatar-ring delay" />
                    </>
                  )}
                  <div
                    style={{
                      width: '90px',
                      height: '90px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '2.2rem',
                      fontWeight: '700',
                      color: '#fff',
                      boxShadow: '0 10px 25px rgba(29, 78, 216, 0.35)',
                      position: 'relative',
                      zIndex: 1
                    }}
                  >
                    AI
                  </div>
                </div>

                {/* Name Label with live status dot */}
                <div style={{ position: 'absolute', bottom: '12px', left: '12px', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(0, 0, 0, 0.65)', padding: '4px 10px', borderRadius: '4px', fontSize: '0.65rem', border: '1px solid rgba(255,255,255,0.06)', fontWeight: '600' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: isTeacherSpeaking ? '#22c55e' : '#10b981' }} />
                  AI Instructor [HOST]
                </div>
              </div>

              {/* Trainee Video Card */}
              <div
                className="participant-card"
                style={{
                  flex: '1',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  backgroundColor: '#11151d',
                  border: '1.5px solid rgba(255, 255, 255, 0.06)',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'var(--transition-smooth)'
                }}
              >
                {/* Top Left: Mic Status */}
                <div style={{ position: 'absolute', top: '12px', left: '12px', backgroundColor: 'rgba(0,0,0,0.5)', padding: '6px', borderRadius: '4px', zIndex: 5, border: '1px solid rgba(255,255,255,0.06)' }}>
                  {micOn ? (
                    <Mic style={{ width: '12px', height: '12px', color: '#22c55e' }} />
                  ) : (
                    <MicOff style={{ width: '12px', height: '12px', color: '#ef4444' }} />
                  )}
                </div>

                {cameraOn ? (
                  <video 
                    ref={localVideoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div 
                    style={{
                      width: '90px',
                      height: '90px',
                      borderRadius: '50%',
                      backgroundColor: '#374151',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '2.2rem',
                      fontWeight: '700',
                      color: '#fff',
                      boxShadow: '0 10px 25px rgba(0, 0, 0, 0.25)'
                    }}
                  >
                    ME
                  </div>
                )}

                {/* Name Label with live status dot */}
                <div style={{ position: 'absolute', bottom: '12px', left: '12px', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(0, 0, 0, 0.65)', padding: '4px 10px', borderRadius: '4px', fontSize: '0.65rem', border: '1px solid rgba(255,255,255,0.06)', fontWeight: '600', zIndex: 5 }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: micOn ? '#10b981' : '#ef4444' }} />
                  Me (Trainee) [GUEST]
                </div>
              </div>
            </div>
        </div>

      </div>

      {/* Bottom control bar */}
      <div className="zoom-controls-bar" style={{ height: '80px', padding: '0 30px' }}>
        
        {/* Left Side: Audio & Video toggles */}
        <div className="zoom-controls-group" style={{ width: '220px' }}>
          
          {/* Mute button */}
          <button onClick={() => setMicOn(!micOn)} className="zoom-btn" style={{ padding: '8px 16px' }}>
            {micOn ? (
              <Mic className="zoom-btn-icon" style={{ color: '#22c55e' }} />
            ) : (
              <MicOff className="zoom-btn-icon" style={{ color: 'var(--accent-error)' }} />
            )}
            <span style={{ fontSize: '0.68rem', color: micOn ? 'var(--color-text-primary)' : 'var(--accent-error)' }}>
              {micOn ? 'Mute' : 'Unmute'}
            </span>
          </button>

          {/* Stop Video button */}
          <button onClick={toggleCamera} className="zoom-btn" style={{ padding: '8px 16px' }}>
            {cameraOn ? (
              <Video className="zoom-btn-icon" style={{ color: 'var(--accent-primary)' }} />
            ) : (
              <VideoOff className="zoom-btn-icon" style={{ color: 'var(--accent-error)' }} />
            )}
            <span style={{ fontSize: '0.68rem', color: cameraOn ? 'var(--color-text-primary)' : 'var(--accent-error)' }}>
              {cameraOn ? 'Stop Video' : 'Start Video'}
            </span>
          </button>

        </div>

        {/* Center: Fake/Indicator Zoom Buttons */}
        <div className="zoom-controls-group">
          
          {/* Participants */}
          <button 
            onClick={() => setShowParticipants(!showParticipants)} 
            className={`zoom-btn ${showParticipants ? 'active' : ''}`} 
            style={{ opacity: 0.85 }}
          >
            <div style={{ position: 'relative' }}>
              <Users className="zoom-btn-icon" />
              <span style={{ position: 'absolute', top: '-4px', right: '-4px', backgroundColor: '#2563eb', color: '#fff', fontSize: '0.55rem', padding: '1px 4px', borderRadius: '6px', fontWeight: 'bold' }}>2</span>
            </div>
            <span>Participants</span>
          </button>

          {/* Toggle sidebar (Chat / Quiz) */}
          <button onClick={() => setShowSidebar(!showSidebar)} className={`zoom-btn ${showSidebar ? 'active' : ''}`}>
            <MessageSquare className="zoom-btn-icon" />
            <span>Chat / Quiz</span>
          </button>

          {/* Share Screen (host is presenting — disabled for trainee) */}
          <button className="zoom-btn is-disabled" disabled>
            <Share2 className="zoom-btn-icon" />
            <span>Share Screen</span>
          </button>

          {/* Polls */}
          <button onClick={() => setShowQuiz(!showQuiz)} className={`zoom-btn ${showQuiz ? 'active' : ''}`}>
            <BarChart2 className="zoom-btn-icon" />
            <span>Polls</span>
          </button>

        </div>

        {/* Right Side: Leave button */}
        <div className="zoom-controls-group" style={{ width: '220px', justifyContent: 'flex-end' }}>
          <button onClick={() => onLeave(lessonIdRef.current)} className="zoom-leave-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <LogOut style={{ width: '14px', height: '14px' }} />
            Leave
          </button>
        </div>

      </div>

    </div>
  );
}

export default ZoomClassroom;
