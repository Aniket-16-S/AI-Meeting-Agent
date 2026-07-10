'use client';
import './globals.css';
import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import UploadModal from '@/components/UploadModal';
import ScheduleMeetModal from '@/components/ScheduleMeetModal';
import QueryWidget from '@/components/QueryWidget';
import { ToastProvider, useToast } from '@/components/Toast';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ThemeProvider, useTheme } from '@/lib/ThemeContext';
import { fetchMeetingStatus, fetchGoogleStatus } from '@/lib/api';

function getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

function LayoutWrapper({ children }) {
  const { user, loading, organization, logout } = useAuth();
  const { addToast } = useToast();
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [processingMeetings, setProcessingMeetings] = useState([]);

  const toggleSidebar = () => setSidebarOpen((p) => !p);

  const isAuthPage = pathname === '/login' || pathname === '/register';

  useEffect(() => {
    if (!loading) {
      if (!user && !isAuthPage) {
        router.replace('/login');
      } else if (user && isAuthPage) {
        router.replace('/');
      } else if (user && user.role === 'employee' && pathname.startsWith('/settings')) {
        router.replace('/');
      }
    }
  }, [user, loading, pathname, isAuthPage, router]);

  const [googleConnected, setGoogleConnected] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const checkGoogleConnection = async () => {
    if (!user?.id) return;
    try {
      const status = await fetchGoogleStatus(user.id);
      setGoogleConnected(status.connected);
    } catch (e) {
      console.error('Failed to load Google connection status', e);
    }
  };

  useEffect(() => {
    if (organization?.id && user?.id) {
      checkGoogleConnection();
    }
  }, [organization?.id, user?.id]);

  // Google popup OAuth listener
  useEffect(() => {
    const handleOAuthMessage = (event) => {
      if (event.data === 'google-connected') {
        addToast('Google Calendar connected successfully!', 'success');
        setGoogleConnected(true);
        setShowScheduleModal(true);
        checkGoogleConnection();
      }
    };
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [user?.id, addToast]);

  const handleScheduleClick = () => {
    if (googleConnected) {
      setShowScheduleModal(true);
    } else {
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      window.open(
        `/api/auth/google/login?user_id=${user?.id}`,
        'Google OAuth Connect',
        `width=${width},height=${height},left=${left},top=${top}`
      );
    }
  };

  const handleUploadQueued = (meetingId, filename) => {
    setProcessingMeetings((prev) => [
      ...prev,
      { id: meetingId, filename, status: 'PROCESSING' }
    ]);
  };

  // Poll for background transcription jobs
  useEffect(() => {
    const activeProcessing = processingMeetings.filter((m) => m.status === 'PROCESSING');
    if (!activeProcessing.length || !organization?.id) {
      return;
    }

    const interval = setInterval(async () => {
      for (const meeting of activeProcessing) {
        try {
          const status = await fetchMeetingStatus(meeting.id, organization.id);
          if (status === 'COMPLETED' || status === 'FAILED') {
            setProcessingMeetings((prev) =>
              prev.map((m) => (m.id === meeting.id ? { ...m, status } : m))
            );
            // Reload page content automatically
            setRefreshKey((k) => k + 1);
            
            if (status === 'COMPLETED') {
              addToast(`"${meeting.filename}" processed successfully!`, 'success');
            } else {
              addToast(`Failed to process "${meeting.filename}".`, 'error');
            }
          }
        } catch (e) {
          console.error("Error polling meeting status", e);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [processingMeetings, organization, addToast]);

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div className="pulse-danger" style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </div>
          <div style={{ fontWeight: 500 }}>Initializing Command Center…</div>
        </div>
      </div>
    );
  }

  // If not logged in and trying to access protected page, show loading state while redirecting
  if (!user && !isAuthPage) {
    return null;
  }

  // If logged in and trying to access login/register, show loading state while redirecting
  if (user && isAuthPage) {
    return null;
  }

  // Render auth pages full-screen without sidebar and widgets
  if (isAuthPage) {
    return <main style={{ minHeight: '100vh' }}>{children}</main>;
  }

  const activeProcessingCount = processingMeetings.filter((m) => m.status === 'PROCESSING').length;

  return (
    <div className="app-layout">
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={toggleSidebar}
        onUpload={() => setUploadOpen(true)}
      />

      {/* Top bar with hamburger */}
      <div className="topbar">
        <button className="hamburger-btn" onClick={toggleSidebar} aria-label="Toggle menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="topbar-title">MeetSignal</span>
        
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '16px', position: 'relative' }}>
          {/* Schedule Meet button */}
          <button
            onClick={handleScheduleClick}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              background: 'var(--accent-primary)',
              color: 'var(--accent-primary-text)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background var(--transition-fast)'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'var(--accent-primary-hover)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'var(--accent-primary)'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Schedule Meet
          </button>

          <ThemeToggle />

          {/* User Profile Avatar with dropdown */}
          {user && (
            <div ref={profileRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setProfileDropdownOpen((p) => !p)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'var(--accent-primary)',
                  color: 'var(--accent-primary-text)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: '1px solid var(--border-primary)',
                  transition: 'opacity 0.2s ease'
                }}
                onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                title={user.name}
              >
                {getInitials(user.name)}
              </button>

              {profileDropdownOpen && (
                <>
                  <div style={{
                    position: 'absolute',
                    right: 0,
                    top: '40px',
                    width: '200px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '8px',
                    boxShadow: 'var(--shadow-elevated)',
                    zIndex: 150,
                    padding: '8px 0',
                    display: 'flex',
                    flexDirection: 'column'
                  }}>
                    <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {user.name}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>
                        {user.role}
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        setProfileDropdownOpen(false);
                        logout();
                      }}
                      style={{
                        padding: '10px 16px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-critical-text)',
                        fontSize: '12px',
                        fontWeight: 600,
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'background var(--transition-fast)'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                      onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <main className={`main-content ${sidebarOpen ? 'sidebar-open' : ''}`} key={refreshKey}>
        {children}
      </main>

      {/* Floating Processing Panel */}
      {activeProcessingCount > 0 && (
        <div className="processing-floating-panel">
          <div className="processing-panel-header">
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e', marginRight: 8, animation: 'pulse-dot 1.5s infinite' }} />
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>AI Processing ({activeProcessingCount})</span>
          </div>
          <div className="processing-panel-body">
            {processingMeetings.filter((m) => m.status === 'PROCESSING').map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                <span className="spinning-loader" />
                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 200, color: 'var(--text-secondary)' }} title={m.filename}>
                  {m.filename}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onSuccess={() => setRefreshKey((k) => k + 1)}
          onUploadQueued={handleUploadQueued}
        />
      )}

      {showScheduleModal && (
        <ScheduleMeetModal
          onClose={() => setShowScheduleModal(false)}
          onSuccess={() => {
            window.dispatchEvent(new Event('meeting-scheduled'));
          }}
        />
      )}

      <QueryWidget />
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
        borderRadius: '20px',
        padding: '6px 12px',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '13px',
        fontWeight: '500',
        transition: 'all 0.2s ease',
      }}
    >
      {theme === 'dark' ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '2px' }}>
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
          Light
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '2px' }}>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
          Dark
        </>
      )}
    </button>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>MeetSignal, Project Command Center</title>
        <meta name="description" content="AI-powered meeting transcript analyzer. Extract tasks, risks, and insights automatically." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='gold'><polygon points='55,10 15,60 50,60 45,90 85,40 50,40'/></svg>" />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <LayoutWrapper>{children}</LayoutWrapper>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

