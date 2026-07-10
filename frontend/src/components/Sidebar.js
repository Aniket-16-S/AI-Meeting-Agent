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

  const navItems = [
    {
      href: '/',
      label: 'Dashboard',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      ),
    },
    {
      href: '/completed',
      label: 'Completed Tasks',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
    },
  ];

  if (userIsManager) {
    navItems.push({
      href: '/settings/users',
      label: 'User Management',
      match: '/settings',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      ),
    });
  }

  return (
    <>
      {/* Click-outside overlay (transparent — popup style) */}
      <div
        className={`sidebar-overlay ${isOpen ? 'visible' : ''}`}
        onClick={onToggle}
      />

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Compact header — logo text only, no icon */}
        <div className="sidebar-header" style={{ padding: '16px 16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div className="sidebar-logo-text" style={{ fontSize: 16, letterSpacing: '-0.02em' }}>MeetSignal</div>
              <div className="sidebar-logo-sub" style={{ fontSize: 10, marginTop: 2 }}>AI Meeting Agent</div>
            </div>
            <button
              onClick={onToggle}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-secondary)',
                width: 24,
                height: 24,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                flexShrink: 0,
              }}
              title="Close Navigation"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Upload Button */}
        <button
          className="sidebar-upload-btn"
          onClick={() => { onUpload(); onToggle(); }}
          style={{ margin: '8px 12px 4px', width: 'calc(100% - 24px)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload Transcript
        </button>

        {/* Divider between upload button and nav links */}
        <div style={{
          height: 1,
          background: 'var(--border-subtle)',
          margin: '8px 12px 4px',
          opacity: 0.7,
        }} />

        {/* Nav Links */}
        <nav className="sidebar-nav" style={{ flex: 1, padding: '4px 8px' }}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-nav-link ${isActive(item) ? 'active' : ''}`}
              onClick={() => { onToggle(); }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* Footer health indicator */}
        <div className="sidebar-footer" style={{ padding: '10px 14px' }}>
          <div className="sidebar-health">
            <span className={`health-dot ${health === 'offline' ? 'offline' : ''}`} />
            <span>API {health === 'online' ? 'Online' : health === 'offline' ? 'Offline' : 'Checking…'}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
