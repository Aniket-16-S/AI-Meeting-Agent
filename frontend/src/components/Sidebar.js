'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';

function getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

export default function Sidebar({ isOpen, onToggle, onUpload }) {
  const pathname = usePathname();
  const [health, setHealth] = useState('checking');
  const { user, logout, department, departments, switchDepartment } = useAuth();

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? setHealth('online') : setHealth('offline')))
      .catch(() => setHealth('offline'));
  }, []);

  const isActive = (item) => {
    if (item.href === '/') return pathname === '/';
    return pathname.startsWith(item.match || item.href);
  };

  const userIsManager = user?.role === 'admin';

  // Build navigation items dynamically based on user role
  const navItems = [
    {
      href: '/',
      label: 'Dashboard',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      ),
    },
    {
      href: '/meetings',
      label: 'Meetings',
      match: '/meetings',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v4M16 2v4" />
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M3 10h18" />
        </svg>
      ),
    },
    {
      href: '/backlog',
      label: 'Global Backlog',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      ),
    },
  ];

  // Append settings link for OrgAdmins and DeptManagers
  if (userIsManager) {
    navItems.push({
      href: '/settings/users',
      label: 'Settings',
      match: '/settings',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      ),
    });
  }

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${isOpen ? 'visible' : ''}`}
        onClick={onToggle}
      />

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">⚡</div>
            <div>
              <div className="sidebar-logo-text">ActionCenter</div>
              <div className="sidebar-logo-sub">AI Meeting Agent</div>
            </div>
          </div>
        </div>

        {/* Upload Button */}
        <button className="sidebar-upload-btn" onClick={onUpload} style={{ margin: '16px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload Transcript
        </button>

        {/* Department Switcher Dropdown */}
        {userIsManager && departments.length > 0 && (
          <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Active Department
            </label>
            <select
              value={department?.id || ''}
              onChange={(e) => switchDepartment(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-primary)',
                padding: '6px 10px',
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Nav Links */}
        <nav className="sidebar-nav" style={{ flex: 1 }}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-nav-link ${isActive(item) ? 'active' : ''}`}
              onClick={() => {
                if (window.innerWidth <= 768) onToggle();
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* Health connection and User Profile Widget */}
        <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '14px', background: 'transparent' }}>
          
          <div className="sidebar-health">
            <span className={`health-dot ${health === 'offline' ? 'offline' : ''}`} />
            <span>API {health === 'online' ? 'Connected' : health === 'offline' ? 'Offline' : 'Checking…'}</span>
          </div>

          {/* User Profile Card */}
          {user && (
            <div style={{
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              width: '100%'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, hsl(217, 91%, 55%), hsl(250, 80%, 60%))',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 700,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
                }}>
                  {getInitials(user.name)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={user.name}>
                    {user.name}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    {user.role}
                  </span>
                </div>
              </div>
              
              <button
                onClick={logout}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-input)',
                  color: 'var(--color-critical-text)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'background var(--transition-fast)'
                }}
                className="sidebar-logout-btn"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
