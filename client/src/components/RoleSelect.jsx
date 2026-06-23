import React from 'react';
import { Shield, GraduationCap, ArrowLeft, Sparkles } from 'lucide-react';

/**
 * Role selection gateway shown after the admin clicks "Start Meeting" on the home
 * screen. Two paths: Admin (runs the session) or Trainee (joins / waits).
 */
function RoleSelect({ onSelectRole, onBack }) {
  const cardBase = {
    flex: 1,
    minWidth: '240px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '14px',
    padding: '36px 28px',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'var(--transition-smooth)'
  };

  return (
    <div className="launcher-wrap animate-fade">
      <div className="launcher-glow" />

      <div style={{ position: 'relative', width: '100%', maxWidth: '720px', padding: '0 24px', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div className="launcher-pill">
            <Sparkles style={{ width: '15px', height: '15px' }} />
            Maruti Suzuki Virtual Classroom
          </div>
          <h1 style={{ fontSize: '2rem', margin: '18px 0 6px', color: '#fff' }}>How are you joining?</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.92rem' }}>
            Select your role to continue.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          {/* Admin */}
          <div
            className="glass-panel launcher-card"
            style={cardBase}
            onClick={() => onSelectRole('admin')}
          >
            <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield style={{ width: '30px', height: '30px', color: 'var(--accent-primary)' }} />
            </div>
            <h3 style={{ fontSize: '1.25rem', color: '#fff' }}>Admin</h3>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', lineHeight: '1.5' }}>
              Log in to start and host the live training session.
            </p>
          </div>

          {/* Trainee */}
          <div
            className="glass-panel launcher-card"
            style={cardBase}
            onClick={() => onSelectRole('trainee')}
          >
            <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <GraduationCap style={{ width: '30px', height: '30px', color: 'var(--accent-success)' }} />
            </div>
            <h3 style={{ fontSize: '1.25rem', color: '#fff' }}>Trainee</h3>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', lineHeight: '1.5' }}>
              Register and join the classroom, or wait for the trainer to begin.
            </p>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '28px' }}>
          <button
            onClick={onBack}
            style={{
              background: 'none', border: 'none', color: 'var(--color-text-secondary)',
              fontSize: '0.85rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px'
            }}
          >
            <ArrowLeft style={{ width: '14px', height: '14px' }} /> Back to home
          </button>
        </div>
      </div>
    </div>
  );
}

export default RoleSelect;
