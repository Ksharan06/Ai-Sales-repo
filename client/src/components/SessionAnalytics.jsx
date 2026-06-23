import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Loader2, Users, Award, BarChart2, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';

function SessionAnalytics({ sessionId, traineeId = null, onContinue }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`/api/sessions/${sessionId}/analytics`);
        setData(response.data);
      } catch (err) {
        console.error('Failed to load analytics:', err);
        setError('Failed to fetch session analytics data.');
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      fetchAnalytics();
    }
  }, [sessionId]);

  if (loading) {
    return (
      <div className="launcher-wrap animate-fade">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Loader2 className="animate-spin" style={{ width: '40px', height: '40px', color: 'var(--accent-primary)' }} />
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>Compiling session analytics...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="launcher-wrap animate-fade">
        <div className="glass-panel" style={{ padding: '40px', maxWidth: '440px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <AlertCircle style={{ width: '48px', height: '48px', color: 'var(--accent-error)', margin: '0 auto' }} />
          <h2>Error Loading Data</h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>{error || 'No analytics data available.'}</p>
          <button 
            onClick={onContinue}
            style={{
              background: 'linear-gradient(135deg, var(--accent-primary) 0%, hsl(217, 91%, 50%) 100%)',
              border: 'none', color: '#fff', padding: '12px 24px', borderRadius: '8px',
              fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer'
            }}
          >
            Continue to Feedback
          </button>
        </div>
      </div>
    );
  }

  // When opened by a trainee, scope the matrix to just their own results.
  const quizzes = data.quizzes || [];
  const trainees = traineeId
    ? (data.trainees || []).filter(t => t.traineeId === traineeId)
    : (data.trainees || []);
  const answers = traineeId
    ? (data.answers || []).filter(a => a.traineeId === traineeId)
    : (data.answers || []);

  // Calculate Metrics
  const totalTrainees = trainees.length;
  const totalQuizzes = quizzes.length;
  
  const totalAnswers = answers.length;
  const correctAnswers = answers.filter(a => a.isCorrect).length;
  const overallAccuracy = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0;

  const getOptionLetter = (index) => {
    return ['A', 'B', 'C', 'D'][index] || '—';
  };

  const getTraineeAnswerForQuiz = (traineeId, slideNumber) => {
    return answers.find(a => a.traineeId === traineeId && a.slideNumber === slideNumber);
  };

  return (
    <div className="launcher-wrap animate-fade" style={{ padding: '40px 24px', overflowY: 'auto' }}>
      <div className="launcher-glow" />

      <div style={{ position: 'relative', width: '100%', maxWidth: '1000px', display: 'flex', flexDirection: 'column', gap: '30px', zIndex: 1 }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ fontSize: '2.2rem', color: '#fff', marginBottom: '6px' }}>Session Analytics</h1>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
              Detailed performance metrics for this Session
            </p>
          </div>
          <button 
            onClick={onContinue}
            style={{
              background: 'linear-gradient(135deg, var(--accent-primary) 0%, hsl(217, 91%, 50%) 100%)',
              border: 'none',
              color: '#fff',
              padding: '12px 28px',
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(59, 130, 246, 0.3)',
              transition: 'var(--transition-smooth)'
            }}
          >
            Continue to Feedback
          </button>
        </div>

        {/* Summary Metric Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
          
          {/* Card 1: Trainees */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
              <Users style={{ width: '24px', height: '24px', color: 'var(--accent-primary)' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.05em' }}>Total Trainees</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#fff', marginTop: '2px' }}>{totalTrainees}</div>
            </div>
          </div>

          {/* Card 2: Quizzes */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'rgba(168, 85, 247, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(168, 85, 247, 0.25)' }}>
              <Award style={{ width: '24px', height: '24px', color: 'rgb(168, 85, 247)' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.05em' }}>Quizzes Administered</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#fff', marginTop: '2px' }}>{totalQuizzes}</div>
            </div>
          </div>

          {/* Card 3: Accuracy */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: overallAccuracy >= 60 ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: overallAccuracy >= 60 ? '1px solid rgba(34, 197, 94, 0.25)' : '1px solid rgba(239, 68, 68, 0.25)' }}>
              <BarChart2 style={{ width: '24px', height: '24px', color: overallAccuracy >= 60 ? 'var(--accent-success)' : 'var(--accent-error)' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.05em' }}>Overall Accuracy</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#fff', marginTop: '2px' }}>{overallAccuracy}%</div>
            </div>
          </div>

        </div>

        {/* Main Table Card */}
        <div className="glass-panel" style={{ padding: '28px', overflow: 'hidden' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '20px', color: '#fff' }}>Trainee Performance Matrix</h3>
          
          {totalTrainees === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-secondary)' }}>
              No trainee registration recorded for this session.
            </div>
          ) : totalQuizzes === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-secondary)' }}>
              No quiz data recorded for this session.
            </div>
          ) : (
            <div style={{ width: '100%', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    <th style={{ padding: '12px 16px', color: 'var(--color-text-secondary)', fontSize: '0.82rem', fontWeight: '700', textTransform: 'uppercase', width: '220px' }}>Trainee Name</th>
                    {quizzes.map((quiz, idx) => {
                      const slideDescriptions = {
                        1: "Session Intro",
                        2: "Target Audience",
                        3: "Product Value",
                        4: "Objection Handling",
                        5: "Pricing Strategy",
                        6: "Session Review"
                      };
                      const slideDesc = slideDescriptions[quiz.slideNumber] || `Slide ${quiz.slideNumber}`;

                      return (
                        <th 
                          key={idx} 
                          style={{ padding: '12px 16px', color: 'var(--color-text-secondary)', fontSize: '0.82rem', fontWeight: '700', textTransform: 'uppercase' }}
                          title={quiz.question}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span>Slide {quiz.slideNumber}</span>
                            <span style={{ fontSize: '0.68rem', fontWeight: '400', textTransform: 'none', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px', marginTop: '2px' }}>
                              {slideDesc}
                            </span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {trainees.map((trainee) => {
                    // Render Row 1: Choices
                    // Render Row 2: Response times
                    return (
                      <React.Fragment key={trainee.traineeId}>
                        {/* Choice Row */}
                        <tr style={{ borderTop: '1px solid rgba(255, 255, 255, 0.04)' }}>
                          <td style={{ padding: '16px 16px 4px 16px', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: '600', color: '#fff', fontSize: '0.9rem' }}>{trainee.name}</span>
                              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>ID: {trainee.traineeId}</span>
                            </div>
                          </td>
                          {quizzes.map((quiz, idx) => {
                            const answer = getTraineeAnswerForQuiz(trainee.traineeId, quiz.slideNumber);
                            const textVal = answer ? getOptionLetter(answer.answerIndex) : '—';
                            const correctOption = getOptionLetter(quiz.correctAnswer);
                            
                            let cellBg = 'rgba(255, 255, 255, 0.02)';
                            let cellBorder = '1px solid rgba(255, 255, 255, 0.05)';
                            let textColor = 'var(--color-text-muted)';
                            
                            if (answer) {
                              if (answer.isCorrect) {
                                cellBg = 'rgba(34, 197, 94, 0.1)';
                                cellBorder = '1px solid rgba(34, 197, 94, 0.25)';
                                textColor = 'var(--accent-success)';
                              } else {
                                cellBg = 'rgba(239, 68, 68, 0.1)';
                                cellBorder = '1px solid rgba(239, 68, 68, 0.25)';
                                textColor = 'var(--accent-error)';
                              }
                            }

                            return (
                              <td key={idx} style={{ padding: '16px 16px 4px 16px', verticalAlign: 'middle' }}>
                                <div style={{ 
                                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                                  backgroundColor: cellBg, border: cellBorder,
                                  borderRadius: '6px', padding: '6px 12px', fontSize: '0.85rem', fontWeight: '700',
                                  color: textColor, minWidth: '40px', justifyContent: 'center'
                                }}>
                                  {answer && (answer.isCorrect ? <CheckCircle2 style={{ width: '13px', height: '13px' }} /> : <XCircle style={{ width: '13px', height: '13px' }} />)}
                                  <span>{textVal}</span>
                                </div>
                                {answer && !answer.isCorrect && (
                                  <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginTop: '4px', textAlign: 'center' }}>
                                    Key: {correctOption}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        {/* Response Time Sub-Row */}
                        <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                          <td style={{ padding: '2px 16px 16px 16px', fontSize: '0.72rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock style={{ width: '11px', height: '11px' }} />
                            <span>Response Times</span>
                          </td>
                          {quizzes.map((quiz, idx) => {
                            const answer = getTraineeAnswerForQuiz(trainee.traineeId, quiz.slideNumber);
                            const timeVal = answer ? `${(answer.responseTimeMs / 1000).toFixed(1)}s` : '—';
                            return (
                              <td key={idx} style={{ padding: '2px 16px 16px 16px', fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: '500' }}>
                                {timeVal}
                              </td>
                            );
                          })}
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default SessionAnalytics;
