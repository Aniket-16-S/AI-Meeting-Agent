'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/Toast';

const FEATURES = [
  { label: 'Auto extract tasks from any transcripts' },
  { label: 'AI generated summaries ' },
  { label: 'Risk detection and priority tracking' },
  { label: 'Natural language search across all meetings' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const { addToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      addToast('Please fill in all fields', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password);
      addToast('Welcome back!', 'success');
    } catch (err) {
      addToast(err.message || 'Login failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      width: '100vw',
      overflow: 'hidden',
    }}>
      {/* ── Left Brand Panel ───────────────────────────────── */}
      <div style={{
        flex: '0 0 45%',
        background: 'linear-gradient(145deg, #0a1628 0%, #0d2438 40%, #0f3347 70%, #0a1e30 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '60px 56px',
        position: 'relative',
        overflow: 'hidden',
      }}
        className="auth-brand-panel"
      >
        {/* Decorative glowing orbs */}
        <div style={{
          position: 'absolute', top: '-80px', right: '-80px',
          width: 320, height: 320, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(61,122,138,0.22) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: '-60px', left: '-60px',
          width: 260, height: 260, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(77,143,160,0.16) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', top: '45%', left: '55%',
          width: 180, height: 180, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(61,122,138,0.1) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Wordmark */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'inline-block',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(77, 143, 160, 0.9)',
            marginBottom: 18,
            borderLeft: '2px solid rgba(77,143,160,0.5)',
            paddingLeft: 10,
          }}>
            AI Meeting Intelligence
          </div>

          <h1 style={{
            fontSize: 'clamp(36px, 4vw, 52px)',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            color: '#F0F6FA',
            margin: 0,
            marginBottom: 6,
          }}>
            Meet
            <span style={{
              background: 'linear-gradient(90deg, #4D8FA0, #6BB8CC)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>Signal</span>
          </h1>

          <p style={{
            fontSize: 15,
            color: 'rgba(190,215,225,0.7)',
            fontWeight: 400,
            lineHeight: 1.6,
            marginTop: 16,
            marginBottom: 44,
            maxWidth: 320,
          }}>
            Your meetings are full of decisions, risks, and action items.
            MeetSignal surfaces all of them, automatically.
          </p>

          {/* Feature list */}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {FEATURES.map((f, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'rgba(77,143,160,0.18)',
                  border: '1px solid rgba(77,143,160,0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4D8FA0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span style={{ fontSize: 13, color: 'rgba(190,215,225,0.75)', fontWeight: 500 }}>
                  {f.label}
                </span>
              </li>
            ))}
          </ul>

          {/* Bottom watermark line */}
          <div style={{
            marginTop: 52,
            paddingTop: 20,
            borderTop: '1px solid rgba(255,255,255,0.07)',
            fontSize: 11,
            color: 'rgba(190, 215, 225, 0.45)',
            letterSpacing: '0.04em',
          }}>
            Never miss what Matters
          </div>
        </div>
      </div>

      {/* ── Right Form Panel ────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        padding: '40px 24px',
        overflowY: 'auto',
      }}>
        <div style={{ width: '100%', maxWidth: 400 }}>

          {/* Mobile-only wordmark (hidden on desktop via CSS) */}
          <div className="auth-mobile-brand" style={{ marginBottom: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
              Meet<span style={{ color: 'var(--accent-primary)' }}>Signal</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              AI Meeting Intelligence
            </div>
          </div>

          <h2 style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
            marginBottom: 6,
          }}>
            Welcome back
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 28 }}>
            Sign in to your organization&apos;s workspace
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Work Email
              </label>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  width: '100%',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Password
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  width: '100%',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{
                background: submitting ? 'var(--accent-primary)' : 'var(--accent-gradient)',
                color: '#fff',
                padding: '13px',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '14px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                textAlign: 'center',
                boxShadow: '0 4px 16px rgba(61,122,138,0.3)',
                marginTop: '4px',
                transition: 'all 0.2s',
                opacity: submitting ? 0.8 : 1,
                letterSpacing: '0.01em',
              }}
            >
              {submitting ? 'Authenticating…' : 'Sign In →'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            New to MeetSignal?{' '}
            <Link href="/register" className="auth-link">
              Register Organization
            </Link>
          </div>
        </div>
      </div>

      {/* Responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .auth-brand-panel { display: none !important; }
          .auth-mobile-brand { display: block !important; }
        }
        @media (min-width: 769px) {
          .auth-mobile-brand { display: none !important; }
        }
      `}</style>
    </div>
  );
}
