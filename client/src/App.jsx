import React, { useState } from 'react';
import AdminDashboard from './components/AdminDashboard';
import ZoomClassroom from './components/ZoomClassroom';
import TrainingFeedback from './components/TrainingFeedback';
import TraineeRegistration from './components/TraineeRegistration';
import SessionAnalytics from './components/SessionAnalytics';

function App() {
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [currentLessonId, setCurrentLessonId] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [traineeInfo, setTraineeInfo] = useState(null);       // { traineeId, name }
  const [showAnalytics, setShowAnalytics] = useState(false);   // for Task 3

  const handleStartSession = (sessionId) => {
    setCurrentSessionId(sessionId);
    setCurrentLessonId(null);
    setTraineeInfo(null);      // force registration
    setShowFeedback(false);
    setShowAnalytics(false);
  };

  const handleRegister = (info) => {
    setTraineeInfo(info);  // { traineeId, name }
  };

  const handleRegistrationBack = () => {
    setCurrentSessionId(null);  // go back to AdminDashboard
    setTraineeInfo(null);
  };

  const handleLeaveSession = (lessonId) => {
    setCurrentLessonId(lessonId);
    setShowAnalytics(true);   // go to analytics BEFORE feedback
  };

  const handleFeedbackComplete = () => {
    setCurrentSessionId(null);
    setCurrentLessonId(null);
    setShowFeedback(false);
    setTraineeInfo(null);
    setShowAnalytics(false);
  };

  return (
    <div className="app-root">
      {showFeedback ? (
        <TrainingFeedback
          sessionId={currentSessionId}
          lessonId={currentLessonId}
          onComplete={handleFeedbackComplete}
        />
      ) : showAnalytics ? (
        <SessionAnalytics
          sessionId={currentSessionId}
          onContinue={() => {
            setShowAnalytics(false);
            setShowFeedback(true);
          }}
        />
      ) : currentSessionId && traineeInfo ? (
        <ZoomClassroom 
          sessionId={currentSessionId} 
          traineeId={traineeInfo.traineeId}
          traineeName={traineeInfo.name}
          onLeave={handleLeaveSession} 
        />
      ) : currentSessionId ? (
        <TraineeRegistration
          sessionId={currentSessionId}
          onRegister={handleRegister}
          onBack={handleRegistrationBack}
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
