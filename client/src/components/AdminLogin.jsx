import React, { useState } from 'react';
import axios from 'axios';
import { Loader2, User, Lock, AlertCircle, Shield, ArrowLeft } from 'lucide-react';

/**
 * Admin login. On valid credentials it creates the classroom session for the
 * chosen lesson and hands the new sessionId back up. Only an admin reaches here.
 */
function AdminLogin({ lessonId, onSuccess, onBack }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim() || !password) {
      setError('Name and password are required');
      return;
    }

    setLoading(true);
    try {
      // 1. Validate credentials
      await axios.post('/api/admin/login', { name: name.trim(), password });

      // 2. Create the session for the selected lesson (admin starts the session)
      const sessionRes = await axios.post('/api/sessions', { lessonId });
      const sessionId = sessionRes.data.sessionId;

      onSuccess({ name: name.trim(), sessionId });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputWrap = { position: 'relative', display: 'flex', alignItems: 'center' };
  const inputStyle = {
    width: '100%', padding: '12px 16px 12px 42px', borderRadius: '8px',
    backgroundColor: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff', fontSize: '0.9rem', outline: 'none', transition: 'var(--transition-smooth)'
  };
  const iconStyle = { position: 'absolute', left: '14px', width: '16px', height: '16px', color: 'var(--color-text-muted)' };
  const labelStyle = { fontSize: '0.78rem', fontWeight: '700', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', textTransform: 'uppercase' };

  return (
    <div className="launcher-wrap animate-fade">
      <div className="launcher-glow" />
      <div style={{ position: 'relative', width: '100%', maxWidth: '440px', padding: '0 20px', zIndex: 1 }}>
        <div className="glass-panel" style={{ padding: '40px 36px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Shield style={{ width: '26px', height: '26px', color: 'var(--accent-primary)' }} />
            </div>
            <h2 style={{ fontSize: '1.8rem', color: '#fff', marginBottom: '8px' }}>Admin Login</h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
              Sign in to start and host the session.
            </p>
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '12px 16px', color: 'var(--accent-error)', fontSize: '0.85rem' }}>
              <AlertCircle style={{ width: '16px', height: '16px', flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={labelStyle}>Admin Name</label>
              <div style={inputWrap}>
                <User style={iconStyle} />
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="admin" disabled={loading} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={labelStyle}>Password</label>
              <div style={inputWrap}>
                <Lock style={iconStyle} />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" disabled={loading} style={inputStyle} />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="launcher-start-btn"
              style={{
                background: 'linear-gradient(135deg, var(--accent-primary) 0%, hsl(217, 91%, 50%) 100%)',
                border: 'none', color: '#fff', padding: '14px', borderRadius: '8px',
                fontSize: '0.95rem', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px',
                boxShadow: '0 4px 12px rgba(59,130,246,0.2)'
              }}
            >
              {loading && <Loader2 className="animate-spin" style={{ width: '16px', height: '16px' }} />}
              {loading ? 'Starting Session...' : 'Login & Start Session'}
            </button>

            <button
              type="button"
              onClick={onBack}
              disabled={loading}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '0.85rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              <ArrowLeft style={{ width: '14px', height: '14px' }} /> Back
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AdminLogin;
