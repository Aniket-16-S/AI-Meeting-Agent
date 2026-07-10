'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { 
  fetchMeetings, 
  fetchTasks, 
  fetchRisks, 
  updateTaskStatus,
  fetchGoogleStatus,
  cancelGoogleMeeting,
  fetchLatestGoogleMeetings
} from '@/lib/api';
import ScheduleMeetModal from '@/components/ScheduleMeetModal';
import { SkeletonCards, SkeletonTable } from '@/components/SkeletonLoader';
import PriorityBadge from '@/components/PriorityBadge';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import EntityResolutionBadge from '@/components/EntityResolutionBadge';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/Toast';

// Import Recharts
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart as RecBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts';

function formatDate(d) {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

function formatMeetingPeriod(startStr, endStr) {
  if (!startStr || !endStr) return '';
  try {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    let datePrefix = '';
    if (start.toDateString() === today.toDateString()) {
      datePrefix = 'Today';
    } else if (start.toDateString() === tomorrow.toDateString()) {
      datePrefix = 'Tomorrow';
    } else {
      datePrefix = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    const timeOpt = { hour: 'numeric', minute: '2-digit', hour12: true };
    const startTimeStr = start.toLocaleTimeString('en-US', timeOpt);
    const endTimeStr = end.toLocaleTimeString('en-US', timeOpt);

    return `${datePrefix} • ${startTimeStr} - ${endTimeStr}`;
  } catch (e) {
    return '';
  }
}

export default function DashboardPage() {
  const { user, department, organization, deptMeetingIds, users } = useAuth();
  const { addToast } = useToast();
  const [meetings, setMeetings] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [risks, setRisks] = useState(null);
  const [loading, setLoading] = useState(true);

  // Google Meet States
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState('');
  const [activeMeetings, setActiveMeetings] = useState([]);
  const [selectedActiveMeetingId, setSelectedActiveMeetingId] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  // Client-side mount state
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const userIsManager = user?.role === 'admin';

  // Card filter states
  const [cardFilter, setCardFilter] = useState(null); // 'requires-attention', 'unassigned'
  const [memberCardFilter, setMemberCardFilter] = useState(null); // 'immediate', 'up-next', 'completed'

  // Sorting and Grouping for Tasks
  const [sortMode, setSortMode] = useState('smart'); // date-asc, date-desc, priority-desc, priority-asc, smart
  const [groupBy, setGroupBy] = useState('none'); // none, category, meeting

  // User Filter for Manager Backlog
  const [selectedUserFilter, setSelectedUserFilter] = useState('');

  const checkGoogleConnection = async () => {
    if (!user?.id) return;
    try {
      const status = await fetchGoogleStatus(user.id);
      setGoogleConnected(status.connected);
      setGoogleEmail(status.google_email || '');
    } catch (e) {
      console.error('Failed to load Google connection status', e);
    }
  };

  const fetchActiveMeetings = async () => {
    if (!organization?.id || !user?.id) return;
    try {
      const list = await fetchLatestGoogleMeetings(organization.id, user.id);
      setActiveMeetings(list);
      if (list.length > 0) {
        // If the current selected active meeting id is no longer in the list, default to the first one
        if (!list.some(m => m.id === selectedActiveMeetingId)) {
          setSelectedActiveMeetingId(list[0].id);
        }
      } else {
        setSelectedActiveMeetingId('');
      }
    } catch (e) {
      console.error('Failed to fetch active meetings', e);
    }
  };

  const handleCancelMeeting = async (meetingId) => {
    const confirm = window.confirm(
      'Are you sure you want to cancel this meeting? This will delete the Google Calendar event and notify all participants.'
    );
    if (!confirm) return;

    try {
      await cancelGoogleMeeting(meetingId);
      addToast('Google Meet meeting cancelled successfully', 'success');
      fetchActiveMeetings();
    } catch (e) {
      addToast(e.message || 'Failed to cancel meeting', 'error');
    }
  };

  // Google popup OAuth listener
  useEffect(() => {
    const handleOAuthMessage = (event) => {
      if (event.data === 'google-connected') {
        addToast('Google Calendar connected successfully!', 'success');
        setGoogleConnected(true);
        setShowScheduleModal(true);
        checkGoogleConnection();
        fetchActiveMeetings();
      }
    };
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [user?.id]);

  useEffect(() => {
    if (organization?.id && user?.id) {
      checkGoogleConnection();
      fetchActiveMeetings();
    }
  }, [organization?.id, user?.id]);

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await updateTaskStatus(taskId, newStatus);
      setTasks((prevTasks) =>
        prevTasks?.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
      );
      let msg = 'Task status updated!';
      if (newStatus === 'Closed') {
        msg = 'Task marked as completed!';
      } else if (newStatus === 'In Progress') {
        msg = 'Task marked as In Progress!';
      } else if (newStatus === 'Open') {
        msg = 'Task reopened!';
      }
      addToast(msg, 'success');
    } catch (err) {
      addToast(err.message || 'Failed to update task status', 'error');
    }
  };

  useEffect(() => {
    if (!organization?.id) return;
    setLoading(true);
    Promise.all([
      fetchMeetings(organization.id),
      fetchTasks(null, organization.id),
      fetchRisks(null, organization.id),
    ])
      .then(([m, t, r]) => {
        setMeetings(m);
        setTasks(t);
        setRisks(r);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [organization?.id]);

  // Filter backend data by user's active department meetings
  const { deptMeetings, deptTasks, deptRis } = useMemo(() => {
    if (!meetings || !tasks || !risks || !department) {
      return { deptMeetings: [], deptTasks: [], deptRis: [] };
    }
    const mFiltered = meetings.filter((m) => deptMeetingIds.includes(m.id));
    const tFiltered = tasks.filter((t) => deptMeetingIds.includes(t.meeting_id));
    const rFiltered = risks.filter((r) => deptMeetingIds.includes(r.meeting_id));

    return { deptMeetings: mFiltered, deptTasks: tFiltered, deptRis: rFiltered };
  }, [meetings, tasks, risks, department, deptMeetingIds]);

  // Member-Specific calculations
  const myTasks = useMemo(() => {
    if (!tasks || !user) return [];
    const userFullName = user.name.trim().toLowerCase();
    const userFirstName = user.name.trim().split(/\s+/)[0].toLowerCase();

    return tasks.filter((t) => {
      // 1. Check owners_list first
      if (Array.isArray(t.owners_list)) {
        const matchesList = t.owners_list.some((o) => {
          if (!o) return false;
          const oLower = String(o).trim().toLowerCase();
          return oLower === userFullName || oLower === userFirstName;
        });
        if (matchesList) return true;
      }

      // 2. Fall back to raw owner string
      if (!t.owner) return false;
      const ownerLower = String(t.owner).trim().toLowerCase();
      return (
        ownerLower === userFullName ||
        ownerLower === userFirstName ||
        ownerLower.includes(userFullName) ||
        ownerLower.includes(userFirstName)
      );
    });
  }, [tasks, user]);

  const sortedMyTasks = useMemo(() => {
    let baseTasks = [...myTasks];
    
    if (memberCardFilter === 'completed') {
      baseTasks = baseTasks.filter(t => t.status === 'Closed');
    } else {
      baseTasks = baseTasks.filter(t => t.status !== 'Closed');
    }

    if (memberCardFilter === 'immediate') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      baseTasks = baseTasks.filter(t => {
        if (!t.due_date) return false;
        const d = new Date(t.due_date);
        return d < tomorrow;
      });
    } else if (memberCardFilter === 'up-next') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + 7);
      baseTasks = baseTasks.filter(t => {
        if (!t.due_date) return false;
        const d = new Date(t.due_date);
        return d >= tomorrow && d <= nextWeek;
      });
    }

    if (sortMode === 'smart') {
      const pWeights = { 'Critical': 1, 'High': 0.75, 'Medium': 0.5, 'Low': 0.25 };
      baseTasks.sort((a, b) => {
        const pA = pWeights[a.priority] || 0.25;
        const pB = pWeights[b.priority] || 0.25;

        const hoursA = a.due_date ? (new Date(a.due_date) - new Date()) / (1000 * 60 * 60) : 9999;
        const hoursB = b.due_date ? (new Date(b.due_date) - new Date()) / (1000 * 60 * 60) : 9999;

        const scoreA = (pA * 0.6) + ((1 / (Math.max(hoursA, 0) + 24)) * 0.4 * 100);
        const scoreB = (pB * 0.6) + ((1 / (Math.max(hoursB, 0) + 24)) * 0.4 * 100);

        return scoreB - scoreA;
      });
    } else if (sortMode.startsWith('priority')) {
      const pWeights = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
      baseTasks.sort((a, b) => {
        const pA = pWeights[a.priority] || 1;
        const pB = pWeights[b.priority] || 1;
        return sortMode === 'priority-desc' ? pB - pA : pA - pB;
      });
    } else {
      baseTasks.sort((a, b) => {
        const dateA = a.due_date ? new Date(a.due_date) : new Date('9999-12-31');
        const dateB = b.due_date ? new Date(b.due_date) : new Date('9999-12-31');
        return sortMode === 'date-asc' ? dateA - dateB : dateB - dateA;
      });
    }
    return baseTasks;
  }, [myTasks, memberCardFilter, sortMode]);

  const groupedMyTasks = useMemo(() => {
    if (groupBy === 'none') return { 'All Tasks': sortedMyTasks };

    const groups = {};
    const catLabels = {
      'Action Item': 'Action Items',
      'Decision': 'Agreements & Policies',
      'Follow-up': 'Follow-ups',
      'Info': 'General Notes',
    };

    sortedMyTasks.forEach((t) => {
      let key = 'Other';
      if (groupBy === 'category') {
        key = catLabels[t.category] || t.category || 'Other';
      } else if (groupBy === 'meeting') {
        const mtg = meetings?.find((m) => m.id === t.meeting_id);
        key = mtg ? (mtg.title || mtg.file_name) : 'No Meeting Source';
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
  }, [sortedMyTasks, groupBy, meetings]);

  // Metrics calculations for overview cards
  const overdueTasksCount = useMemo(() => {
    if (!deptTasks) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return deptTasks.filter((t) => {
      if ((t.status === 'Open' || t.status === 'In Progress') && t.due_date) {
        const d = new Date(t.due_date);
        return d < today;
      }
      return false;
    }).length;
  }, [deptTasks]);

  const criticalRisksCount = useMemo(() => {
    if (!deptRis) return 0;
    return deptRis.filter((r) => r.severity === 'Critical').length;
  }, [deptRis]);

  const requiresAttentionCount = overdueTasksCount + criticalRisksCount;

  const unassignedTasksCount = useMemo(() => {
    if (!deptTasks) return 0;
    return deptTasks.filter((t) => t.owner === 'Unassigned' || !t.owner).length;
  }, [deptTasks]);

  const meetingsThisWeekCount = useMemo(() => {
    if (!deptMeetings) return 0;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return deptMeetings.filter(m => {
      if (!m.upload_date) return false;
      return new Date(m.upload_date) >= oneWeekAgo;
    }).length;
  }, [deptMeetings]);

  const immediateTasks = useMemo(() => {
    if (!myTasks) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    return myTasks.filter((t) => {
      if (t.status === 'Closed') return false;
      if (!t.due_date) return false;
      const d = new Date(t.due_date);
      return d < tomorrow;
    });
  }, [myTasks]);

  const upNextTasks = useMemo(() => {
    if (!myTasks) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);

    return myTasks.filter((t) => {
      if (t.status === 'Closed') return false;
      if (!t.due_date) return false;
      const d = new Date(t.due_date);
      return d >= tomorrow && d <= nextWeek;
    });
  }, [myTasks]);

  const completedTasksCount = useMemo(() => {
    if (!myTasks) return 0;
    return myTasks.filter(t => t.status === 'Closed').length;
  }, [myTasks]);

  // Manager Table: Filtered Backlog
  const filteredBacklog = useMemo(() => {
    if (!deptTasks) return [];
    let list = deptTasks;
    
    if (selectedUserFilter) {
      if (selectedUserFilter === 'Unassigned') {
        list = list.filter(t => t.owner === 'Unassigned' || !t.owner);
      } else {
        const selUserLower = selectedUserFilter.toLowerCase();
        const selUserFirstName = selectedUserFilter.trim().split(/\s+/)[0].toLowerCase();
        list = list.filter((t) => {
          if (Array.isArray(t.owners_list)) {
            const matchesList = t.owners_list.some((o) => {
              if (!o) return false;
              const oLower = String(o).trim().toLowerCase();
              return oLower === selUserLower || oLower === selUserFirstName;
            });
            if (matchesList) return true;
          }
          if (!t.owner) return false;
          const ownerLower = String(t.owner).trim().toLowerCase();
          return (
            ownerLower === selUserLower ||
            ownerLower === selUserFirstName ||
            ownerLower.includes(selUserLower) ||
            ownerLower.includes(selUserFirstName)
          );
        });
      }
    }

    if (cardFilter === 'requires-attention') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      list = list.filter(t => {
        const isOverdue = (t.status === 'Open' || t.status === 'In Progress') && t.due_date && new Date(t.due_date) < today;
        const isCritical = t.priority === 'Critical';
        return isOverdue || isCritical;
      });
    } else if (cardFilter === 'unassigned') {
      list = list.filter(t => t.owner === 'Unassigned' || !t.owner);
    }

    return list;
  }, [deptTasks, selectedUserFilter, cardFilter]);

  // Sorting for Backlog
  const sortedBacklog = useMemo(() => {
    let sorted = [...filteredBacklog].filter(t => t.status !== 'Closed');

    if (sortMode === 'smart') {
      const pWeights = { 'Critical': 1, 'High': 0.75, 'Medium': 0.5, 'Low': 0.25 };

      sorted.sort((a, b) => {
        const pA = pWeights[a.priority] || 0.25;
        const pB = pWeights[b.priority] || 0.25;

        // Calculate hours remaining, ensuring we don't go negative for overdue tasks
        const hoursA = Math.max(a.due_date ? (new Date(a.due_date) - new Date()) / (1000 * 60 * 60) : 9999, 0);
        const hoursB = Math.max(b.due_date ? (new Date(b.due_date) - new Date()) / (1000 * 60 * 60) : 9999, 0);

        // Normalized Urgency: 24 / (hours + 24)
        // At 0 hours, this is 1.0. As hours increase, this approaches 0.
        const urgencyA = 24 / (hoursA + 24);
        const urgencyB = 24 / (hoursB + 24);

        // Final Score: 50% Priority, 50% Urgency (Both max out at 1.0)
        const scoreA = (pA * 0.5) + (urgencyA * 0.5);
        const scoreB = (pB * 0.5) + (urgencyB * 0.5);

        return scoreB - scoreA; // Sort descending (highest score first)
      });
    } else if (sortMode.startsWith('priority')) {
      const pWeights = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
      sorted.sort((a, b) => {
        const pA = pWeights[a.priority] || 1;
        const pB = pWeights[b.priority] || 1;
        return sortMode === 'priority-desc' ? pB - pA : pA - pB;
      });
    } else {
      sorted.sort((a, b) => {
        const dateA = a.due_date ? new Date(a.due_date) : new Date('9999-12-31');
        const dateB = b.due_date ? new Date(b.due_date) : new Date('9999-12-31');
        return sortMode === 'date-asc' ? dateA - dateB : dateB - dateA;
      });
    }
    return sorted;
  }, [filteredBacklog, sortMode]);

  // Grouping for Backlog
  const groupedBacklog = useMemo(() => {
    if (groupBy === 'none') return { 'All Tasks': sortedBacklog };

    const groups = {};
    const catLabels = {
      'Action Item': 'Action Items',
      'Decision': 'Agreements & Policies',
      'Follow-up': 'Follow-ups',
      'Info': 'General Notes',
    };

    sortedBacklog.forEach((t) => {
      let key = 'Other';
      if (groupBy === 'category') {
        key = catLabels[t.category] || t.category || 'Other';
      } else if (groupBy === 'meeting') {
        const mtg = meetings?.find((m) => m.id === t.meeting_id);
        key = mtg ? (mtg.title || mtg.file_name) : 'No Meeting Source';
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
  }, [sortedBacklog, groupBy, meetings]);

  // Top 8 next actionable tasks for admins
  const next8ActionableTasks = useMemo(() => {
    return sortedBacklog.filter(t => t.status !== 'Closed').slice(0, 8);
  }, [sortedBacklog]);

  if (loading) {
    return (
      <div className="page-animate">
        <div className="page-header">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Loading command center…</p>
        </div>
        <SkeletonCards count={4} />
        <SkeletonTable rows={5} cols={4} />
      </div>
    );
  }

  return (
    <div className="page-animate">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title">{userIsManager ? 'Team Oversight & Analytics' : 'My Work'}</h1>
          <p className="page-subtitle">
            {department?.name} Department, {organization?.name}
          </p>
        </div>

        {/* Google Meet Actions & Widget Column/Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {/* Active Google Meet Widget */}
          {activeMeetings && activeMeetings.length > 0 && (() => {
            const currentMeeting = activeMeetings.find(m => m.id === selectedActiveMeetingId) || activeMeetings[0];
            return (
              <div 
                style={{ 
                  padding: '12px 18px', 
                  borderRadius: '8px', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '8px', 
                  minWidth: '320px', 
                  border: '1px solid var(--border-primary)',
                  boxShadow: 'var(--shadow-card)',
                  background: 'var(--bg-secondary)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Upcoming Meet
                  </span>
                  
                  {/* Select Dropdown if > 1 meetings */}
                  {activeMeetings.length > 1 && (
                    <select
                      value={selectedActiveMeetingId}
                      onChange={(e) => setSelectedActiveMeetingId(e.target.value)}
                      style={{
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-primary)',
                        color: 'var(--text-primary)',
                        borderRadius: '6px',
                        padding: '2px 6px',
                        fontSize: '11px',
                        outline: 'none',
                        cursor: 'pointer',
                        maxWidth: '160px'
                      }}
                    >
                      {activeMeetings.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.meeting_title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '280px' }}>
                    {currentMeeting.meeting_title}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {formatMeetingPeriod(currentMeeting.meeting_start_time, currentMeeting.meeting_end_time)}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <a
                    href={currentMeeting.google_meet_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      background: 'var(--accent-primary)',
                      color: 'var(--accent-primary-text)',
                      fontSize: '12px',
                      fontWeight: 600,
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                    }}
                  >
                    Join Google Meet ↗
                  </a>
                  <button
                    onClick={() => handleCancelMeeting(currentMeeting.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-primary)',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#ef4444',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 'auto',
                      height: 'auto'
                    }}
                    title="Cancel Meeting"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          MEMBER VIEW (Employee Dashboard)
          ───────────────────────────────────────────────────────────── */}
      {!userIsManager && (
        <>
          {/* Top Row: Focus Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '32px' }}>
            {/* Due Today / Overdue Card */}
            <div
              onClick={() => setMemberCardFilter(memberCardFilter === 'immediate' ? null : 'immediate')}
              style={{
                padding: '20px',
                background: 'var(--bg-secondary)',
                border: memberCardFilter === 'immediate' ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
                borderRadius: '12px',
                boxShadow: 'var(--shadow-card)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--text-secondary)'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = memberCardFilter === 'immediate' ? 'var(--text-primary)' : 'var(--border-primary)'}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Due Today / Overdue
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--color-critical-text)', marginTop: '8px' }}>
                {immediateTasks.length}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                Immediate action items
              </div>
            </div>

            {/* Up Next Card */}
            <div
              onClick={() => setMemberCardFilter(memberCardFilter === 'up-next' ? null : 'up-next')}
              style={{
                padding: '20px',
                background: 'var(--bg-secondary)',
                border: memberCardFilter === 'up-next' ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
                borderRadius: '12px',
                boxShadow: 'var(--shadow-card)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--text-secondary)'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = memberCardFilter === 'up-next' ? 'var(--text-primary)' : 'var(--border-primary)'}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Up Next
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '8px' }}>
                {upNextTasks.length}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                Due this week (next 7 days)
              </div>
            </div>

            {/* Completed Card */}
            <div
              onClick={() => setMemberCardFilter(memberCardFilter === 'completed' ? null : 'completed')}
              style={{
                padding: '20px',
                background: 'var(--bg-secondary)',
                border: memberCardFilter === 'completed' ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
                borderRadius: '12px',
                boxShadow: 'var(--shadow-card)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--text-secondary)'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = memberCardFilter === 'completed' ? 'var(--text-primary)' : 'var(--border-primary)'}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Completed
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--color-success-text)', marginTop: '8px' }}>
                {completedTasksCount}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                Weekly task completion count
              </div>
            </div>
          </div>

          {/* Member Tasks List View */}
          <div className="section-header" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <span className="section-title">
              My Assigned Tasks
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 12, fontWeight: 500 }}>
                ({sortedMyTasks.length} shown)
              </span>
            </span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-charcoal)', padding: '6px 12px', borderRadius: '8px', fontSize: 13, color: 'var(--text-primary)', outline: 'none', cursor: 'pointer' }}
              >
                <option value="none">Group By: None</option>
                <option value="category">Group By: Category</option>
                <option value="meeting">Group By: Context (Meeting)</option>
              </select>

              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-charcoal)', padding: '6px 12px', borderRadius: '8px', fontSize: 13, color: 'var(--text-primary)', outline: 'none', cursor: 'pointer' }}
              >
                <option value="smart">Sort: Smart (AI Urgency)</option>
                <option value="priority-desc">Sort: Priority (Critical first)</option>
                <option value="priority-asc">Sort: Priority (Low first)</option>
                <option value="date-asc">Sort: Due Date (Asc)</option>
                <option value="date-desc">Sort: Due Date (Desc)</option>
              </select>
            </div>
          </div>

          {sortedMyTasks.length === 0 ? (
            <EmptyState
              icon="🎉"
              title="All caught up!"
              text="No tasks match the active filters or focus cards."
              style={{ marginBottom: 32 }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginBottom: 32 }}>
              {Object.keys(groupedMyTasks).map((groupKey) => {
                let icon = '📁';
                if (groupBy === 'category') {
                  if (groupKey.includes('Action')) icon = '📋';
                  else if (groupKey.includes('Agreements') || groupKey.includes('Decision')) icon = '🤝';
                  else if (groupKey.includes('Follow')) icon = '🔁';
                  else if (groupKey.includes('Notes') || groupKey.includes('Info')) icon = 'ℹ️';
                } else if (groupBy === 'meeting') {
                  icon = '🎬';
                }
                return (
                  <div key={groupKey} style={{ border: '1px solid var(--border-primary)', borderRadius: '12px', background: 'var(--bg-secondary)', overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
                    {groupBy !== 'none' && (
                      <div style={{
                        padding: '14px 20px',
                        background: 'var(--bg-tertiary)',
                        borderBottom: '1px solid var(--border-primary)',
                        fontWeight: 700,
                        fontSize: '13px',
                        color: 'var(--text-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '16px' }}>{icon}</span>
                          <span>{groupKey}</span>
                        </div>
                        <span style={{
                          background: 'var(--accent-primary-glow)',
                          color: 'var(--text-primary)',
                          padding: '2px 8px',
                          borderRadius: '20px',
                          fontSize: '11px',
                          fontWeight: 600
                        }}>
                          {groupedMyTasks[groupKey].length} {groupedMyTasks[groupKey].length === 1 ? 'task' : 'tasks'}
                        </span>
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {groupedMyTasks[groupKey].map((t) => {
                        const mtg = meetings?.find((m) => m.id === t.meeting_id);
                        return (
                          <div key={t.id} style={{
                            padding: '16px 20px',
                            borderBottom: '1px solid var(--border-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '24px',
                            transition: 'background var(--transition-fast)',
                            cursor: 'default'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                          onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flex: 1, minWidth: 0 }}>


                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                                <span style={{
                                  fontSize: '14px',
                                  fontWeight: 500,
                                  color: 'var(--text-primary)',
                                  textDecoration: t.status === 'Closed' ? 'line-through' : 'none',
                                  opacity: t.status === 'Closed' ? 0.6 : 1,
                                  lineHeight: '1.4'
                                }}>
                                  {t.task_description}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                  {mtg && (
                                    <Link href={`/meetings/${mtg.id}`} style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                                      {mtg.title || mtg.file_name} ↗
                                    </Link>
                                  )}
                                  {t.due_date && (
                                    <span>Due: {formatDate(t.due_date)}</span>
                                  )}
                                  <span style={{ textTransform: 'capitalize' }}>Category: {t.category}</span>
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                              <PriorityBadge level={t.priority} />
                              <StatusBadge status={t.status} />

                              {/* Dropdown status changer */}
                              <select
                                value={t.status}
                                onChange={(e) => handleStatusChange(t.id, e.target.value)}
                                style={{
                                  background: t.status === 'Closed' ? 'var(--color-success-bg)' : t.status === 'In Progress' ? 'var(--color-medium-bg)' : 'var(--bg-input)',
                                  color: t.status === 'Closed' ? 'var(--color-success-text)' : t.status === 'In Progress' ? 'var(--color-medium-text)' : 'var(--text-primary)',
                                  border: '1px solid var(--border-primary)',
                                  cursor: 'pointer',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  fontWeight: 500,
                                  outline: 'none',
                                }}
                              >
                                <option value="Open">Open</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Closed">Closed</option>
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MANAGER VIEW (OrgAdmin & DeptManager Dashboard)
          ───────────────────────────────────────────────────────────── */}
      {userIsManager && (
        <>
          {/* Actionable Overview Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '32px' }}>
            {/* Requires Attention Card */}
            <div
              onClick={() => setCardFilter(cardFilter === 'requires-attention' ? null : 'requires-attention')}
              style={{
                padding: '20px',
                background: 'var(--bg-secondary)',
                border: cardFilter === 'requires-attention' ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
                borderRadius: '12px',
                boxShadow: 'var(--shadow-card)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--text-secondary)'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = cardFilter === 'requires-attention' ? 'var(--text-primary)' : 'var(--border-primary)'}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Requires Attention
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--color-critical-text)', marginTop: '8px' }}>
                {requiresAttentionCount}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                {overdueTasksCount} overdue tasks + {criticalRisksCount} critical risks
              </div>
            </div>

            {/* Unassigned Action Items Card */}
            <div
              onClick={() => setCardFilter(cardFilter === 'unassigned' ? null : 'unassigned')}
              style={{
                padding: '20px',
                background: 'var(--bg-secondary)',
                border: cardFilter === 'unassigned' ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
                borderRadius: '12px',
                boxShadow: 'var(--shadow-card)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--text-secondary)'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = cardFilter === 'unassigned' ? 'var(--text-primary)' : 'var(--border-primary)'}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Unassigned Tasks
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '8px' }}>
                {unassignedTasksCount}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                Tasks needing designated owners
              </div>
            </div>

            {/* Meetings Processed This Week */}
            <div
              style={{
                padding: '20px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '12px',
                boxShadow: 'var(--shadow-card)'
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Processed This Week
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '8px' }}>
                {meetingsThisWeekCount}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                Meetings processed in the last 7 days
              </div>
            </div>
          </div>

          {/* Team Backlog Table */}
          <div className="section-header" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span className="section-title">
              Department Action Items
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 12, fontWeight: 500 }}>
                ({filteredBacklog.length} total)
              </span>
            </span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-charcoal)', padding: '6px 12px', borderRadius: '6px', fontSize: 13, color: 'var(--text-primary)', outline: 'none' }}
              >
                <option value="none">Group By: None</option>
                <option value="category">Group By: Category</option>
                <option value="meeting">Group By: Context (Meeting)</option>
              </select>

              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-charcoal)', padding: '6px 12px', borderRadius: '6px', fontSize: 13, color: 'var(--text-primary)', outline: 'none' }}
              >
                <option value="smart">Sort: Smart (AI Urgency)</option>
                <option value="priority-desc">Sort: Priority (Critical first)</option>
                <option value="priority-asc">Sort: Priority (Low first)</option>
                <option value="date-asc">Sort: Due Date (Asc)</option>
                <option value="date-desc">Sort: Due Date (Desc)</option>
              </select>

              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Assignee:</label>
              <select
                value={selectedUserFilter}
                onChange={(e) => setSelectedUserFilter(e.target.value)}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-charcoal)',
                  color: 'var(--text-primary)',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  fontSize: '13px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="">All Team Members</option>
                {users.filter(u => u.departmentId === department?.id).map((u) => (
                  <option key={u.id} value={u.name}>
                    {u.name}
                  </option>
                ))}
                <option value="Unassigned">Unassigned / Raw</option>
              </select>
            </div>
          </div>

          {filteredBacklog.length === 0 ? (
            <EmptyState
              icon="📭"
              title="No backlog tasks"
              text="No tasks match the active user filter."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 32, marginBottom: 32 }}>
              {Object.keys(groupedBacklog).map((groupKey) => {
                let icon = '📁';
                if (groupBy === 'category') {
                  if (groupKey.includes('Action')) icon = '📋';
                  else if (groupKey.includes('Agreements') || groupKey.includes('Decision')) icon = '🤝';
                  else if (groupKey.includes('Follow')) icon = '🔁';
                  else if (groupKey.includes('Notes') || groupKey.includes('Info')) icon = 'ℹ️';
                } else if (groupBy === 'meeting') {
                  icon = '🎬';
                }
                return (
                  <div key={groupKey} className="data-table-wrapper" style={{ border: '1px solid var(--border-primary)', boxShadow: 'var(--shadow-elevated)' }}>
                    {groupBy !== 'none' && (
                      <div style={{
                        padding: '14px 20px',
                        background: 'var(--bg-tertiary)',
                        borderBottom: '1px solid var(--border-primary)',
                        borderLeft: '4px solid var(--accent-primary)',
                        fontWeight: 700,
                        fontSize: '14px',
                        color: 'var(--text-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '16px' }}>{icon}</span>
                          <span>{groupKey}</span>
                        </div>
                        <span style={{
                          background: 'var(--accent-primary-glow)',
                          color: 'var(--text-accent)',
                          padding: '3px 10px',
                          borderRadius: '20px',
                          fontSize: '11px',
                          fontWeight: 700
                        }}>
                          {groupedBacklog[groupKey].length} {groupedBacklog[groupKey].length === 1 ? 'task' : 'tasks'}
                        </span>
                      </div>
                    )}
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Task Description</th>
                          <th>Assigned To</th>
                          <th>Meeting Source</th>
                          <th>Due Date</th>
                          <th>Priority</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedBacklog[groupKey].map((t) => {
                          const mtg = meetings?.find((m) => m.id === t.meeting_id);
                          return (
                            <tr key={t.id}>
                              <td className="td-description">{t.task_description}</td>
                              <td>
                                <EntityResolutionBadge ownerName={t.owner} />
                              </td>
                              <td>
                                {mtg ? (
                                  <Link href={`/meetings/${mtg.id}`} style={{ fontWeight: 500 }}>
                                    {mtg.title || mtg.file_name}
                                  </Link>
                                ) : (
                                  '-'
                                )}
                              </td>
                              <td className="td-date">{formatDate(t.due_date)}</td>
                              <td>
                                <PriorityBadge level={t.priority} />
                              </td>
                              <td>
                                <StatusBadge status={t.status} />
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <select
                                  value={t.status}
                                  onChange={(e) => handleStatusChange(t.id, e.target.value)}
                                  style={{
                                    background: t.status === 'Closed' ? 'rgba(34, 197, 94, 0.1)' : t.status === 'In Progress' ? 'hsla(45, 93%, 47%, 0.1)' : 'var(--bg-input)',
                                    color: t.status === 'Closed' ? '#22c55e' : t.status === 'In Progress' ? 'hsl(45, 93%, 40%)' : 'var(--text-primary)',
                                    border: `1px solid ${t.status === 'Closed' ? 'rgba(34, 197, 94, 0.2)' : t.status === 'In Progress' ? 'hsla(45, 93%, 47%, 0.2)' : 'var(--border-primary)'}`,
                                    cursor: 'pointer',
                                    padding: '6px 12px',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    outline: 'none',
                                  }}
                                >
                                  <option value="Open">Open</option>
                                  <option value="In Progress">In Progress</option>
                                  <option value="Closed">Closed</option>
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {showScheduleModal && (
        <ScheduleMeetModal
          onClose={() => setShowScheduleModal(false)}
          onSuccess={() => fetchActiveMeetings()}
        />
      )}
    </div>
  );
}
