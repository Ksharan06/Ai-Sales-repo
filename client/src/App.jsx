import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminDashboard from './components/AdminDashboard';
import RoleSelect from './components/RoleSelect';
import AdminLogin from './components/AdminLogin';
import TraineeRegistration from './components/TraineeRegistration';
import TraineeWaiting from './components/TraineeWaiting';
import ZoomClassroom from './components/ZoomClassroom';
import TrainingFeedback from './components/TrainingFeedback';
import SessionAnalytics from './components/SessionAnalytics';

const ADMIN_KEY = 'aisales:admin';
const TRAINEE_KEY = 'aisales:trainee';

const readStore = (key) => {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
};
const writeStore = (key, val) => sessionStorage.setItem(key, JSON.stringify(val));
const clearStore = (key) => sessionStorage.removeItem(key);

function App() {
  // View machine: home -> role -> (adminLogin | traineeRegister) -> (classroom | waiting) -> analytics -> feedback
  const [view, setView] = useState('booting');

  const [pendingLessonId, setPendingLessonId] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [role, setRole] = useState(null);              // 'admin' | 'trainee'
  const [traineeInfo, setTraineeInfo] = useState(null); // { traineeId, name }
  const [adminResume, setAdminResume] = useState(false); // admin re-entering a live session (refresh)

  // ---- Boot: restore identity from sessionStorage (survives refresh, not tab close) ----
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      const admin = readStore(ADMIN_KEY);
      const trainee = readStore(TRAINEE_KEY);

      // No stored identity -> home
      if (!admin && !trainee) {
        if (!cancelled) setView('home');
        return;
      }

      let live = null;
      try {
        const res = await axios.get('/api/session/state');
        live = res.data;
      } catch { /* server unreachable -> fall through to home */ }

      if (cancelled) return;

      // Admin resume
      if (admin) {
        if (live && live.isLive && live.sessionId === admin.sessionId) {
          setRole('admin');
          setSessionId(admin.sessionId);
          setLessonId(admin.lessonId || null);
          setAdminResume(true); // resume at the live slide; do not replay the intro
          setView('classroom');
          return;
        }
        // Session no longer live -> drop admin identity
        clearStore(ADMIN_KEY);
        setView('home');
        return;
      }

      // Trainee resume
      if (trainee) {
        setTraineeInfo(trainee);
        if (live && live.isLive && live.sessionId) {
          try {
            await axios.post('/api/trainee/register', {
              traineeId: trainee.traineeId,
              name: trainee.name,
              sessionId: live.sessionId
            });
            setRole('trainee');
            setSessionId(live.sessionId);
            setView('classroom');
            return;
          } catch {
            // Couldn't rejoin -> back to waiting
          }
        }
        setView('waiting');
        return;
      }
    };

    boot();
    return () => { cancelled = true; };
  }, []);

  // ---- Home: "Start Meeting" now opens the role gateway (carries the lessonId) ----
  const handleStartSession = (chosenLessonId) => {
    setPendingLessonId(chosenLessonId);
    setView('role');
  };

  // ---- Role gateway ----
  const handleSelectRole = (chosenRole) => {
    setView(chosenRole === 'admin' ? 'adminLogin' : 'traineeRegister');
  };

  // ---- Admin login success: session already created by AdminLogin ----
  const handleAdminSuccess = ({ name, sessionId: newSessionId }) => {
    writeStore(ADMIN_KEY, { name, sessionId: newSessionId, lessonId: pendingLessonId });
    setRole('admin');
    setSessionId(newSessionId);
    setLessonId(pendingLessonId);
    setAdminResume(false); // fresh start: play the intro from the top
    setView('classroom');
  };

  // ---- Trainee registration submit ----
  const handleTraineeRegister = async ({ traineeId, name }) => {
    let live = null;
    try {
      const res = await axios.get('/api/session/state');
      live = res.data;
    } catch { /* treat as not live */ }

    if (live && live.isLive && live.sessionId) {
      // Live session: register immediately and join the classroom.
      try {
        await axios.post('/api/trainee/register', { traineeId, name, sessionId: live.sessionId });
      } catch (err) {
        throw new Error(err.response?.data?.error || 'Failed to join the session.', { cause: err });
      }
      writeStore(TRAINEE_KEY, { traineeId, name });
      setTraineeInfo({ traineeId, name });
      setRole('trainee');
      setSessionId(live.sessionId);
      setView('classroom');
    } else {
      // No live session yet: remember identity and wait.
      writeStore(TRAINEE_KEY, { traineeId, name });
      setTraineeInfo({ traineeId, name });
      setView('waiting');
    }
  };

  // ---- Waiting room: admin started -> register against the now-live session ----
  const handleSessionLive = async (liveSessionId) => {
    try {
      await axios.post('/api/trainee/register', {
        traineeId: traineeInfo.traineeId,
        name: traineeInfo.name,
        sessionId: liveSessionId
      });
      setRole('trainee');
      setSessionId(liveSessionId);
      setView('classroom');
    } catch (err) {
      alert(err.response?.data?.error || 'Could not join the session. Please re-register.');
      clearStore(TRAINEE_KEY);
      setTraineeInfo(null);
      setView('traineeRegister');
    }
  };

  const handleLeaveWaiting = () => {
    clearStore(TRAINEE_KEY);
    setTraineeInfo(null);
    setView('home');
  };

  // ---- Session end: both admin and trainees see the analytics dashboard first,
  // then advance to the feedback flow from there ----
  const handleLeaveSession = (endedLessonId) => {
    if (endedLessonId) setLessonId(endedLessonId);
    setView('analytics');
  };

  const handleFeedbackComplete = () => {
    clearStore(ADMIN_KEY);
    clearStore(TRAINEE_KEY);
    setSessionId(null);
    setLessonId(null);
    setRole(null);
    setTraineeInfo(null);
    setPendingLessonId(null);
    setView('home');
  };

  // ---- Render ----
  if (view === 'booting') {
    return <div className="app-root" />;
  }

  return (
    <div className="app-root">
      {view === 'feedback' ? (
        <TrainingFeedback
          sessionId={sessionId}
          lessonId={lessonId}
          onComplete={handleFeedbackComplete}
        />
      ) : view === 'analytics' ? (
        <SessionAnalytics
          sessionId={sessionId}
          traineeId={role === 'trainee' ? traineeInfo?.traineeId : null}
          onContinue={() => setView('feedback')}
        />
      ) : view === 'classroom' ? (
        <ZoomClassroom
          sessionId={sessionId}
          role={role}
          resume={adminResume}
          traineeId={role === 'trainee' ? traineeInfo?.traineeId : 'admin'}
          traineeName={role === 'trainee' ? traineeInfo?.name : 'Admin'}
          onLeave={handleLeaveSession}
        />
      ) : view === 'waiting' ? (
        <TraineeWaiting
          traineeInfo={traineeInfo}
          onSessionLive={handleSessionLive}
          onLeave={handleLeaveWaiting}
        />
      ) : view === 'traineeRegister' ? (
        <TraineeRegistration
          onRegister={handleTraineeRegister}
          onBack={() => setView('role')}
        />
      ) : view === 'adminLogin' ? (
        <AdminLogin
          lessonId={pendingLessonId}
          onSuccess={handleAdminSuccess}
          onBack={() => setView('role')}
        />
      ) : view === 'role' ? (
        <RoleSelect
          onSelectRole={handleSelectRole}
          onBack={() => setView('home')}
        />
      ) : (
        <AdminDashboard
          onStartSession={handleStartSession}
        />
      )}
    </div>
  );
}

export default App;
