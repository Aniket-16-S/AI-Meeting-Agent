'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/Toast';

const STEPS = [
  { n: '01', label: 'Create your organization workspace' },
  { n: '02', label: 'Invite your team and departments' },
  { n: '03', label: 'Upload your first meeting transcript' },
  { n: '04', label: 'Let AI extract tasks and insights' },
];

export default function RegisterPage() {
  const [orgName, setOrgName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminDepartment, setAdminDepartment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { registerOrg } = useAuth();
  const { addToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!orgName || !adminName || !adminEmail || !adminPassword || !adminDepartment) {
      addToast('Please fill in all fields', 'warning');
      return;
    }
    if (adminPassword.length < 6) {
      addToast('Password must be at least 6 characters', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await registerOrg(orgName, adminName, adminEmail, adminPassword, adminDepartment);
      addToast('Organization registered and Admin logged in!', 'success');
    } catch (err) {
      addToast(err.message || 'Registration failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    padding: '11px 14px',
    borderRadius: '10px',
    background: 'var(--bg-input)',
    border: '1px solid var(--border-primary)',
    color: 'var(--text-primary)',
    fontSize: '14px',
    outline: 'none',
    width: '100%',
    transition: 'border-color 0.2s',
  };

  const labelStyle = {
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      width: '100vw',
      overflow: 'hidden',
    }}>
      {/* ── Left Brand Panel ───────────────────────────────── */}
      <div
        className="auth-brand-panel"
        style={{
          flex: '0 0 42%',
          background: 'linear-gradient(155deg, #0a1628 0%, #0c2033 35%, #112d40 65%, #091520 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px 52px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative orbs */}
        <div style={{
          position: 'absolute', top: '-100px', right: '-100px',
          width: 360, height: 360, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(61,122,138,0.18) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: '10%', right: '-40px',
          width: 200, height: 200, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(77,143,160,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', top: '30%', left: '-60px',
          width: 220, height: 220, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(61,122,138,0.1) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Eyebrow */}
          <div style={{
            display: 'inline-block',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'rgba(77,143,160,0.85)',
            marginBottom: 18,
            borderLeft: '2px solid rgba(77,143,160,0.4)',
            paddingLeft: 10,
          }}>
            Get Started Free
          </div>

          {/* Wordmark */}
          <h1 style={{
            fontSize: 'clamp(34px, 3.5vw, 48px)',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            color: '#F0F6FA',
            margin: 0,
            marginBottom: 6,
          }}>
            Meet<span style={{
              background: 'linear-gradient(90deg, #4D8FA0, #6BB8CC)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>Signal</span>
          </h1>

          <p style={{
            fontSize: 14,
            color: 'rgba(190,215,225,0.65)',
            fontWeight: 400,
            lineHeight: 1.65,
            marginTop: 14,
            marginBottom: 40,
            maxWidth: 300,
          }}>
            Set up your organization in minutes. No credit card required.
          </p>

          {/* Onboarding steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <span style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: 'rgba(77,143,160,0.7)',
                  letterSpacing: '0.06em',
                  lineHeight: 1,
                  marginTop: 2,
                  flexShrink: 0,
                  width: 20,
                  textAlign: 'right',
                }}>
                  {s.n}
                </span>
                <div style={{
                  flex: 1,
                  height: 0,
                  background: 'rgba(77,143,160,0.2)',
                  marginTop: 7,
                  flexShrink: 0,
                  width: 0,
                  maxWidth: 0,
                  minWidth: 0,
                }} />
                <span style={{ fontSize: 13, color: 'rgba(190,215,225,0.75)', fontWeight: 500, lineHeight: 1.4 }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{
            marginTop: 48,
            paddingTop: 18,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            fontSize: 10,
            color: 'rgba(190,215,225,0.3)',
            letterSpacing: '0.06em',
          }}>
            From conversations to Actions
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
        <div style={{ width: '100%', maxWidth: 440 }}>

          {/* Mobile-only wordmark */}
          <div className="auth-mobile-brand" style={{ marginBottom: 24, textAlign: 'center' }}>
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
            marginBottom: 4,
          }}>
            Register your organization
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 26 }}>
            You&apos;ll be the admin. Invite teammates after setup.
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={labelStyle}>Organization Name</label>
              <input type="text" placeholder="Acme Corp, Google Inc…" value={orgName}
                onChange={(e) => setOrgName(e.target.value)} style={inputStyle} />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={labelStyle}>Your Full Name</label>
                <input type="text" placeholder="Sundar Pichai" value={adminName}
                  onChange={(e) => setAdminName(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={labelStyle}>Department</label>
                <input type="text" placeholder="Engineering" value={adminDepartment}
                  onChange={(e) => setAdminDepartment(e.target.value)} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={labelStyle}>Work Email</label>
              <input type="email" placeholder="admin@company.com" value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)} style={inputStyle} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={labelStyle}>Password <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-tertiary)', fontSize: 10 }}>(min. 6 characters)</span></label>
              <input type="password" placeholder="••••••••" value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)} style={inputStyle} />
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
                marginTop: '6px',
                transition: 'all 0.2s',
                opacity: submitting ? 0.8 : 1,
                letterSpacing: '0.01em',
              }}
            >
              {submitting ? 'Creating Organization…' : 'Create Organization →'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '22px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Already have an account?{' '}
            <Link href="/login" className="auth-link">
              Sign In
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
