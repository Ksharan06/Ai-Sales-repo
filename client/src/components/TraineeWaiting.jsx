import React, { useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import { Loader2, Clock, LogOut } from 'lucide-react';

/**
 * Waiting room shown to a registered trainee when no live session is active yet.
 * Listens for the admin's `session-started` broadcast (with a polling fallback)
 * and transitions into the classroom the moment the trainer begins.
 */
function TraineeWaiting({ traineeInfo, onSessionLive, onLeave }) {
  const socketRef = useRef(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const goLive = (sessionId) => {
      if (firedRef.current) return;
      firedRef.current = true;
      onSessionLive(sessionId);
    };

    socketRef.current = io();

    socketRef.current.on('session-started', ({ sessionId }) => {
      goLive(sessionId);
    });

    // Polling fallback in case the socket event is missed (reconnects, etc.)
    const poll = setInterval(async () => {
      try {
        const res = await axios.get('/api/session/state');
        if (res.data && res.data.isLive && res.data.sessionId) {
          goLive(res.data.sessionId);
        }
      } catch { /* ignore transient errors */ }
    }, 3000);

    // Immediate check on mount (admin may have started between register and here)
    axios.get('/api/session/state')
      .then(res => {
        if (res.data && res.data.isLive && res.data.sessionId) goLive(res.data.sessionId);
      })
      .catch(() => {});

    return () => {
      clearInterval(poll);
      if (socketRef.current) socketRef.current.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="launcher-wrap animate-fade">
      <div className="launcher-glow" />
      <div style={{ position: 'relative', width: '100%', maxWidth: '480px', padding: '0 20px', zIndex: 1 }}>
        <div className="glass-panel" style={{ padding: '48px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '22px', textAlign: 'center' }}>
          <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Clock style={{ width: '34px', height: '34px', color: 'var(--accent-primary)' }} />
          </div>

          <div>
            <h2 style={{ fontSize: '1.5rem', color: '#fff', marginBottom: '8px' }}>
              Waiting for the trainer to start the session…
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
              You'll join the classroom automatically as soon as it begins.
            </p>
          </div>

          {traineeInfo && (
            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              Registered as <strong style={{ color: '#fff' }}>{traineeInfo.name}</strong> ({traineeInfo.traineeId})
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--color-text-secondary)' }}>
            <Loader2 className="animate-spin" style={{ width: '18px', height: '18px' }} />
            <span style={{ fontSize: '0.85rem' }}>Listening for the session to go live…</span>
          </div>

          <button
            onClick={onLeave}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '0.82rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}
          >
            <LogOut style={{ width: '14px', height: '14px' }} /> Leave waiting room
          </button>
        </div>
      </div>
    </div>
  );
}

export default TraineeWaiting;
