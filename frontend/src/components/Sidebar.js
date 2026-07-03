'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const NAV_ITEMS = [
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

export default function Sidebar({ isOpen, onToggle, onUpload }) {
  const pathname = usePathname();
  const [health, setHealth] = useState('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? setHealth('online') : setHealth('offline')))
      .catch(() => setHealth('offline'));
  }, []);

  const isActive = (item) => {
    if (item.href === '/') return pathname === '/';
    return pathname.startsWith(item.match || item.href);
  };

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

        <button className="sidebar-upload-btn" onClick={onUpload}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload Transcript
        </button>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
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

        <div className="sidebar-footer">
          <div className="sidebar-health">
            <span className={`health-dot ${health === 'offline' ? 'offline' : ''}`} />
            <span>API {health === 'online' ? 'Connected' : health === 'offline' ? 'Offline' : 'Checking…'}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
