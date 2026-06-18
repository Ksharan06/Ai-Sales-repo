import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Play, RotateCw, Import, CheckCircle, AlertCircle, Loader2, Sparkles, BookOpen, Layers, Award } from 'lucide-react';

function AdminDashboard({ onStartSession }) {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [pollingLessonId, setPollingLessonId] = useState(null);

  // Fetch lessons from database
  const fetchLessons = async () => {
    try {
      const response = await axios.get('/api/lessons');
      setLessons(response.data);
      
      // If any lesson is in processing status, keep polling
      const processing = response.data.find(l => l.status === 'processing');
      if (processing) {
        setPollingLessonId(processing._id);
      } else {
        setPollingLessonId(null);
      }
    } catch (err) {
      console.error("Error fetching lessons:", err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLessons();
  }, []);

  // Poll lesson progress if a lesson is processing
  useEffect(() => {
    let timer;
    if (pollingLessonId) {
      timer = setInterval(async () => {
        try {
          const response = await axios.get(`/api/lessons/${pollingLessonId}`);
          const { lesson } = response.data;
          
          // Update the lessons array with new status
          setLessons(prev => prev.map(l => l._id === lesson._id ? lesson : l));
          
          if (lesson.status !== 'processing') {
            setPollingLessonId(null);
            fetchLessons(); // refresh fully
          }
        } catch (err) {
          console.error("Error polling lesson:", err.message);
        }
      }, 3000);
    }
    return () => clearInterval(timer);
  }, [pollingLessonId]);

  // Handle PPT Ingestion
  const handleImport = async () => {
    try {
      setImporting(true);
      const response = await axios.post('/api/lessons/import');
      const { lessonId } = response.data;
      setPollingLessonId(lessonId);
      fetchLessons();
    } catch (err) {
      alert("Failed to start PPT import: " + (err.response?.data?.error || err.message));
    } finally {
      setImporting(false);
    }
  };

  // Handle Content Regeneration
  const handleRegenerate = async (lessonId) => {
    try {
      setLessons(prev => prev.map(l => l._id === lessonId ? { ...l, status: 'processing' } : l));
      setPollingLessonId(lessonId);
      await axios.post(`/api/lessons/${lessonId}/regenerate`);
    } catch (err) {
      alert("Failed to start regeneration: " + (err.response?.data?.error || err.message));
      fetchLessons();
    }
  };

  // Handle Session Start
  const handleStartSession = async (lessonId) => {
    try {
      const response = await axios.post('/api/sessions', { lessonId });
      onStartSession(response.data.sessionId);
    } catch (err) {
      alert("Failed to launch classroom: " + err.message);
    }
  };

  return (
    <div className="launcher-wrap animate-fade">
      {/* Ambient hero glow */}
      <div className="launcher-glow" />

      <div style={{ position: 'relative', width: '100%', maxWidth: '820px', padding: '0 24px', zIndex: 1 }}>
        {/* Centered Hero Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div className="launcher-pill">
            <Sparkles style={{ width: '15px', height: '15px' }} />
            Maruti Suzuki Virtual Classroom
          </div>
          <h1 style={{
            fontSize: '2.6rem',
            lineHeight: '1.15',
            margin: '20px 0 0',
            background: 'linear-gradient(135deg, #ffffff 0%, #c7d2fe 60%, #94a3b8 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            Maruti Suzuki Victoris Training Program for Sales Representatives
          </h1>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <Loader2 className="animate-spin" style={{ width: '40px', height: '40px', color: 'var(--accent-primary)' }} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {lessons.length === 0 ? (
              <div className="glass-panel" style={{ padding: '56px 40px', textAlign: 'center', borderStyle: 'dashed' }}>
                <Import style={{ width: '48px', height: '48px', color: 'var(--color-text-muted)', marginBottom: '16px' }} />
                <h3 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>No training module loaded</h3>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', maxWidth: '440px', margin: '0 auto 24px' }}>
                  Ingest your "maruti_victoris_full.pptx" file. The system will convert slides to images, extract text, generate AI voice narration and quizzes.
                </p>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    background: 'linear-gradient(135deg, var(--accent-primary) 0%, hsl(217, 91%, 50%) 100%)',
                    border: 'none', color: '#fff', padding: '12px 26px', borderRadius: '10px',
                    fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer',
                    boxShadow: '0 6px 18px rgba(59, 130, 246, 0.35)', transition: 'var(--transition-smooth)'
                  }}
                >
                  {importing ? <Loader2 className="animate-spin" style={{ width: '16px', height: '16px' }} /> : <Import style={{ width: '16px', height: '16px' }} />}
                  Import PPT Now
                </button>
              </div>
            ) : (
              lessons.map((lesson) => (
                <div
                  key={lesson._id}
                  className="glass-panel launcher-card"
                  style={{ padding: '30px 34px', position: 'relative' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '24px' }}>

                    {/* Left: lesson info */}
                    <div style={{ flex: '1', minWidth: '300px' }}>
                      {/* Label row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', color: 'var(--color-text-muted)', fontSize: '0.72rem', fontWeight: '700', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                          <BookOpen style={{ width: '15px', height: '15px', color: 'var(--accent-primary)' }} />
                          Lesson Model
                        </span>

                        {lesson.status === 'completed' && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.68rem', fontWeight: '600', backgroundColor: 'rgba(34, 197, 94, 0.1)', color: 'var(--accent-success)', padding: '2px 9px', borderRadius: '12px', border: '1px solid rgba(34,197,94,0.25)' }}>
                            <CheckCircle style={{ width: '12px', height: '12px' }} /> Ready
                          </span>
                        )}
                        {lesson.status === 'failed' && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.68rem', fontWeight: '600', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-error)', padding: '2px 9px', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.25)' }}>
                            <AlertCircle style={{ width: '12px', height: '12px' }} /> Failed
                          </span>
                        )}
                      </div>

                      {/* Lesson title */}
                      <h2 style={{ fontSize: '1.7rem', lineHeight: '1.2', marginBottom: '18px', color: '#fff' }}>
                        {lesson.title}
                      </h2>

                      {/* Stats row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '26px', fontSize: '0.9rem', color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <Layers style={{ width: '16px', height: '16px', color: 'var(--color-text-muted)' }} />
                          <strong style={{ color: '#fff', fontWeight: '600' }}>{lesson.totalSlides || 6}</strong> Training Slides
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <Award style={{ width: '16px', height: '16px', color: 'var(--color-text-muted)' }} />
                          Real-Time Quizzes (10s limits)
                        </span>
                      </div>
                    </div>

                    {/* Right: actions / status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'flex-end' }}>
                      {lesson.status === 'processing' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-warning)', fontSize: '0.85rem', fontWeight: '600' }}>
                            <Loader2 className="animate-spin" style={{ width: '16px', height: '16px' }} />
                            Processing Module...
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            Slide export & AI voice creation
                          </span>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => handleRegenerate(lesson._id)}
                            title="Regenerate AI Narrations & Quizzes"
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                              color: 'var(--color-text-secondary)', padding: '12px', borderRadius: '10px',
                              cursor: 'pointer', transition: 'var(--transition-smooth)'
                            }}
                          >
                            <RotateCw style={{ width: '17px', height: '17px' }} />
                          </button>

                          <button
                            onClick={() => handleStartSession(lesson._id)}
                            disabled={lesson.status !== 'completed'}
                            className="launcher-start-btn"
                            style={{
                              display: 'flex', alignItems: 'center', gap: '9px',
                              background: 'linear-gradient(135deg, var(--accent-primary) 0%, hsl(217, 91%, 50%) 100%)',
                              color: '#fff', border: 'none', padding: '14px 28px', borderRadius: '12px',
                              fontSize: '0.95rem', fontWeight: '700', cursor: lesson.status === 'completed' ? 'pointer' : 'not-allowed',
                              opacity: lesson.status === 'completed' ? 1 : 0.5,
                              transition: 'var(--transition-smooth)'
                            }}
                          >
                            <Play style={{ width: '17px', height: '17px', fill: '#fff' }} />
                            Start Meeting
                          </button>
                        </>
                      )}
                    </div>

                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminDashboard;
