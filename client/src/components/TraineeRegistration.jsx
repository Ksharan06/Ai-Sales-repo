import React, { useState } from 'react';
import axios from 'axios';
import { Loader2, User, Hash, AlertCircle, BookOpen } from 'lucide-react';

function TraineeRegistration({ sessionId, onRegister, onBack }) {
  const [name, setName] = useState('');
  const [traineeId, setTraineeId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const truncatedSessionId = sessionId ? sessionId.substring(0, 8) : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Full name is required');
      return;
    }
    if (!traineeId.trim()) {
      setError('Trainee ID is required');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post('/api/trainees/register', {
        traineeId: traineeId.trim(),
        name: name.trim(),
        sessionId: sessionId
      });
      
      onRegister({
        traineeId: response.data.traineeId,
        name: response.data.name
      });
    } catch (err) {
      console.error('Registration failed:', err);
      setError(err.response?.data?.error || 'Failed to join session. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="launcher-wrap animate-fade">
      {/* Ambient background glow */}
      <div className="launcher-glow" />

      <div style={{ position: 'relative', width: '100%', maxWidth: '440px', padding: '0 20px', zIndex: 1 }}>
        {/* Registration Card */}
        <div className="glass-panel" style={{ padding: '40px 36px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Header */}
          <div style={{ textAlign: 'center' }}>
            <div className="launcher-pill" style={{ marginBottom: '16px' }}>
              <BookOpen style={{ width: '14px', height: '14px' }} />
              Session ID: {truncatedSessionId}
            </div>
            <h2 style={{ fontSize: '1.8rem', color: '#fff', marginBottom: '8px' }}>
              Join Training Session
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
              Enter your identity to register and enter the virtual classroom.
            </p>
          </div>

          {error && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '8px',
              padding: '12px 16px',
              color: 'var(--accent-error)',
              fontSize: '0.85rem'
            }}>
              <AlertCircle style={{ width: '16px', height: '16px', flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Name Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: '700', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Your Full Name
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <User style={{ position: 'absolute', left: '14px', width: '16px', height: '16px', color: 'var(--color-text-muted)' }} />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Rahul Sharma"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '12px 16px 12px 42px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    fontSize: '0.9rem',
                    outline: 'none',
                    transition: 'var(--transition-smooth)'
                  }}
                />
              </div>
            </div>

            {/* Trainee ID Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: '700', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                Trainee ID
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Hash style={{ position: 'absolute', left: '14px', width: '16px', height: '16px', color: 'var(--color-text-muted)' }} />
                <input
                  type="text"
                  value={traineeId}
                  onChange={(e) => setTraineeId(e.target.value)}
                  placeholder="MS-10042"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '12px 16px 12px 42px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    fontSize: '0.9rem',
                    outline: 'none',
                    transition: 'var(--transition-smooth)'
                  }}
                />
              </div>
            </div>

            {/* Buttons */}
            <button
              type="submit"
              disabled={loading}
              className="launcher-start-btn"
              style={{
                background: 'linear-gradient(135deg, var(--accent-primary) 0%, hsl(217, 91%, 50%) 100%)',
                border: 'none',
                color: '#fff',
                padding: '14px',
                borderRadius: '8px',
                fontSize: '0.95rem',
                fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'var(--transition-smooth)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)'
              }}
            >
              {loading && <Loader2 className="animate-spin" style={{ width: '16px', height: '16px' }} />}
              {loading ? 'Joining Session...' : 'Join Session'}
            </button>

            <button
              type="button"
              onClick={onBack}
              disabled={loading}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-secondary)',
                fontSize: '0.85rem',
                cursor: 'pointer',
                textDecoration: 'underline',
                textAlign: 'center',
                marginTop: '4px',
                outline: 'none'
              }}
            >
              Back to Dashboard
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}

export default TraineeRegistration;
