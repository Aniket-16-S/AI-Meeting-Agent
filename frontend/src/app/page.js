'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { fetchMeetings, fetchTasks, fetchRisks, updateTaskStatus } from '@/lib/api';
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

export default function DashboardPage() {
  const { user, department, organization, deptMeetingIds, users } = useAuth();
  const { addToast } = useToast();
  const [meetings, setMeetings] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [risks, setRisks] = useState(null);
  const [loading, setLoading] = useState(true);

  // Client-side mount state to avoid hydration issues with Recharts
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const userIsManager = user?.role === 'admin';

  // Sorting and Grouping for Tasks
  const [sortMode, setSortMode] = useState('smart'); // date-asc, date-desc, priority-desc, priority-asc, smart
  const [groupBy, setGroupBy] = useState('none'); // none, category, meeting

  // User Filter for Manager Backlog
  const [selectedUserFilter, setSelectedUserFilter] = useState('');

  // Days range for task velocity chart (10, 15, or 30 days)
  const [taskVelocityDays, setTaskVelocityDays] = useState(15);

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
    let sorted = [...myTasks].filter(t => t.status !== 'Closed');
    
    if (sortMode === 'smart') {
      const pWeights = { 'Critical': 1, 'High': 0.75, 'Medium': 0.5, 'Low': 0.25 };
      sorted.sort((a, b) => {
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
  }, [myTasks, sortMode]);

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

  const memberKPIs = useMemo(() => {
    if (!myTasks) return { open: 0, closed: 0, total: 0, completionRate: 100, overdue: 0 };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const open = myTasks.filter((t) => t.status === 'Open' || t.status === 'In Progress').length;
    const closed = myTasks.filter((t) => t.status === 'Closed').length;
    const total = open + closed;
    const completionRate = total > 0 ? Math.round((closed / total) * 100) : 100;

    const overdue = myTasks.filter((t) => {
      if ((t.status === 'Open' || t.status === 'In Progress') && t.due_date) {
        const d = new Date(t.due_date);
        return d < today;
      }
      return false;
    }).length;

    return { open, closed, total, completionRate, overdue };
  }, [myTasks]);

  // Manager-Specific calculations
  const managerKPIs = useMemo(() => {
    if (!deptTasks || !deptRis) return { openTasks: 0, closedTasks: 0, criticalRisks: 0, unassigned: 0 };
    const openTasks = deptTasks.filter((t) => t.status === 'Open' || t.status === 'In Progress').length;
    const closedTasks = deptTasks.filter((t) => t.status === 'Closed' || t.status === 'Done').length;
    const criticalRisks = deptRis.filter((r) => r.severity === 'Critical').length;
    const unassigned = deptTasks.filter((t) => t.owner === 'Unassigned' || !t.owner).length;

    return { openTasks, closedTasks, criticalRisks, unassigned };
  }, [deptTasks, deptRis]);

  // Task Severity/Priority Breakdown Doughnut Chart data (counts tasks instead of risks, supports both views)
  const pieData = useMemo(() => {
    const tasksSource = userIsManager ? deptTasks : myTasks;
    if (!tasksSource) return [];
    
    const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    tasksSource.forEach((t) => {
      if (!t.priority) return;
      const key = t.priority.charAt(0).toUpperCase() + t.priority.slice(1).toLowerCase();
      if (counts[key] !== undefined) counts[key]++;
    });
    
    const totalCount = counts.Critical + counts.High + counts.Medium + counts.Low;
    if (totalCount === 0) return [];
    return [
      { name: 'Critical', value: counts.Critical, color: '#ef4444' },
      { name: 'High', value: counts.High, color: '#f97316' },
      { name: 'Medium', value: counts.Medium, color: '#eab308' },
      { name: 'Low', value: counts.Low, color: '#22c55e' },
    ];
  }, [deptTasks, myTasks, userIsManager]);

  // Manager Chart: Line Chart Task Velocity (configurable days, defaults to 15)
  const lineData = useMemo(() => {
    if (!deptTasks) return [];
    const today = new Date();
    const data = [];

    for (let i = taskVelocityDays - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      date.setHours(23, 59, 59, 999);

      // Cumulative tasks created up to this date
      const created = deptTasks.filter(
        (t) => new Date(t.created_at || Date.now()) <= date
      ).length;

      // Cumulative tasks closed up to this date
      const completed = deptTasks.filter((t) => {
        if (t.status === 'Closed') {
          const creationDate = new Date(t.created_at || Date.now());
          return creationDate <= date;
        }
        return false;
      }).length;

      // Cumulative tasks in progress up to this date
      const inProgress = deptTasks.filter((t) => {
        if (t.status === 'In Progress') {
          const creationDate = new Date(t.created_at || Date.now());
          return creationDate <= date;
        }
        return false;
      }).length;

      data.push({
        dateStr: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        Created: created,
        Completed: completed,
        'In Progress': inProgress,
      });
    }
    return data;
  }, [deptTasks, taskVelocityDays]);

  // Manager Table: Filtered Backlog
  const filteredBacklog = useMemo(() => {
    if (!deptTasks) return [];
    return deptTasks.filter((t) => {
      if (!selectedUserFilter) return true;
      if (selectedUserFilter === 'Unassigned') {
        return t.owner === 'Unassigned' || !t.owner;
      }

      const selUserLower = selectedUserFilter.toLowerCase();
      const selUserFirstName = selectedUserFilter.trim().split(/\s+/)[0].toLowerCase();

      // Check owners_list first
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
  }, [deptTasks, selectedUserFilter]);

  // Sorting for Backlog
  const sortedBacklog = useMemo(() => {
    let sorted = [...filteredBacklog].filter(t => t.status !== 'Closed');
    
    if (sortMode === 'smart') {
      const pWeights = { 'Critical': 1, 'High': 0.75, 'Medium': 0.5, 'Low': 0.25 };
      sorted.sort((a, b) => {
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
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title">{userIsManager ? 'Team Oversight & Analytics' : 'My Work'}</h1>
          <p className="page-subtitle">
            {department?.name} Department, {organization?.name}
          </p>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          MEMBER VIEW (Employee Dashboard)
          ───────────────────────────────────────────────────────────── */}
      {!userIsManager && (
        <>
          {/* Top Row: Task Completion Rate & Severity Breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, marginBottom: 32 }}>
            {/* Task Completion Rate Card */}
            <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: 360 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12, marginBottom: 20 }}>
                Task Completion Rate
              </div>
              <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
                <div style={{ position: 'relative', width: 110, height: 110 }}>
                  <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%' }}>
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none" stroke="var(--border-primary)" strokeWidth="3"
                    />
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none" stroke="var(--accent-primary)" strokeWidth="3"
                      strokeDasharray={`${memberKPIs.completionRate}, 100`}
                    />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
                    {memberKPIs.completionRate}%
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>
                    {memberKPIs.closed} <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-secondary)' }}>/ {memberKPIs.total}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>Completed vs Total Tasks</div>
                </div>
              </div>
            </div>

            {/* Severity Breakdown Card */}
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', height: 360 }}>
              <div className="section-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12, marginBottom: 16 }}>
                <span className="section-title">
                  <span className="section-title-icon">📊</span>
                  My Tasks Severity Breakdown
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {mounted && (
                  pieData.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                      No tasks assigned to you.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="45%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            borderRadius: '8px',
                            color: 'var(--text-primary)'
                          }}
                          itemStyle={{ color: 'var(--text-primary)' }}
                          labelStyle={{ color: 'var(--text-secondary)', fontWeight: 600 }}
                          formatter={(value) => [`${value} Tasks`, 'Count']}
                        />
                        <Legend verticalAlign="bottom" height={36} />
                      </PieChart>
                    </ResponsiveContainer>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Bottom Row: Top 4 Next Actionable Tasks */}
          <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', marginBottom: 32 }}>
            <div className="section-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12, marginBottom: 20 }}>
              <span className="section-title">
                <span className="section-title-icon">🎯</span>
                Next Actionable Tasks
              </span>
            </div>
            {sortedMyTasks.filter(t => t.status !== 'Closed').length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'var(--text-tertiary)', fontSize: 13 }}>
                No upcoming actionable tasks. All caught up! 🎉
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: 20
              }}>
                {sortedMyTasks.filter(t => t.status !== 'Closed').slice(0, 4).map((t) => {
                  const mtg = meetings?.find((m) => m.id === t.meeting_id);
                  return (
                    <div key={t.id} style={{
                      padding: '16px',
                      border: '1px solid var(--border-primary)',
                      borderRadius: 12,
                      background: 'var(--bg-tertiary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      boxShadow: 'var(--shadow-card)',
                      transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                    }}
                    className="hover-card-effect"
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.5, flex: 1 }}>
                        {t.task_description}
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                          <span style={{ color: 'var(--text-tertiary)' }}>
                            Due: {formatDate(t.due_date)}
                          </span>
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <PriorityBadge level={t.priority} />
                            <StatusBadge status={t.status} />
                          </div>
                          {mtg && (
                            <Link href={`/meetings/${mtg.id}`} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-accent)' }}>
                              Source ↗
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Member Tasks Table */}
          <div className="section-header" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <span className="section-title">
              <span className="section-title-icon">📋</span>
              My Assigned Action Items
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 12, fontWeight: 500 }}>
                ({myTasks.length} total)
              </span>
            </span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-primary)', padding: '6px 12px', borderRadius: '6px', fontSize: 13, color: 'var(--text-primary)', outline: 'none' }}
              >
                <option value="none">Group By: None</option>
                <option value="category">Group By: Category</option>
                <option value="meeting">Group By: Context (Meeting)</option>
              </select>
              
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-primary)', padding: '6px 12px', borderRadius: '6px', fontSize: 13, color: 'var(--text-primary)', outline: 'none' }}
              >
                <option value="smart">Sort: Smart (AI Urgency)</option>
                <option value="priority-desc">Sort: Priority (Critical first)</option>
                <option value="priority-asc">Sort: Priority (Low first)</option>
                <option value="date-asc">Sort: Due Date (Asc)</option>
                <option value="date-desc">Sort: Due Date (Desc)</option>
              </select>
            </div>
          </div>

          {myTasks.length === 0 ? (
            <EmptyState
              icon="🎉"
              title="All caught up!"
              text="No open tasks assigned to you in this department."
              style={{ marginBottom: 32 }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 32, marginBottom: 32 }}>
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
                          {groupedMyTasks[groupKey].length} {groupedMyTasks[groupKey].length === 1 ? 'task' : 'tasks'}
                        </span>
                      </div>
                    )}
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Meeting Source</th>
                        <th>Deadline</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedMyTasks[groupKey].map((t) => {
                        const mtg = meetings?.find((m) => m.id === t.meeting_id);
                        return (
                          <tr key={t.id}>
                            <td className="td-description">{t.task_description}</td>
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

      {/* ─────────────────────────────────────────────────────────────
          MANAGER VIEW (OrgAdmin & DeptManager Dashboard)
          ───────────────────────────────────────────────────────────── */}
      {userIsManager && (
        <>
          {/* Visual Analytics */}
          <div className="charts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, marginBottom: 32 }}>
            {/* Task Severity Breakdown Doughnut */}
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', height: 380 }}>
              <div className="section-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12, marginBottom: 16 }}>
                <span className="section-title">
                  <span className="section-title-icon">📊</span>
                  Task Severity Breakdown
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {mounted && (
                  pieData.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                      No tasks detected in department.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="45%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            borderRadius: '8px',
                            color: 'var(--text-primary)'
                          }}
                          itemStyle={{ color: 'var(--text-primary)' }}
                          labelStyle={{ color: 'var(--text-secondary)', fontWeight: 600 }}
                          formatter={(value) => [`${value} Tasks`, 'Count']}
                        />
                        <Legend verticalAlign="bottom" height={36} />
                      </PieChart>
                    </ResponsiveContainer>
                  )
                )}
              </div>
            </div>

            {/* Task Velocity Line Chart */}
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', height: 380 }}>
              <div className="section-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="section-title">
                  <span className="section-title-icon">📈</span>
                  Task Velocity <span style={{ fontWeight: 400, fontSize: '13px', marginLeft: '6px', color: 'var(--text-secondary)' }}>(Last {taskVelocityDays} days)</span>
                </span>
                <select
                  value={taskVelocityDays}
                  onChange={(e) => setTaskVelocityDays(Number(e.target.value))}
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '12px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value={10}>Last 10 Days</option>
                  <option value={15}>Last 15 Days</option>
                  <option value={30}>Last 30 Days</option>
                </select>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {mounted && (
                  deptTasks.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                      No tasks available to track velocity.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={lineData} margin={{ right: 10, left: -15 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                        <XAxis dataKey="dateStr" stroke="var(--text-tertiary)" fontSize={11} tickCount={6} />
                        <YAxis stroke="var(--text-tertiary)" fontSize={11} allowDecimals={false} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            background: 'var(--bg-secondary)',
                            borderColor: 'var(--border-primary)',
                            borderRadius: '8px',
                            color: 'var(--text-primary)'
                          }}
                          itemStyle={{ color: 'var(--text-primary)' }}
                          labelStyle={{ color: 'var(--text-secondary)', fontWeight: 600 }}
                          formatter={(value, name) => [`${value} Tasks`, name]}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="Created" stroke="hsl(250, 80%, 60%)" strokeWidth={2.5} dot={false} activeDot={{ r: 6 }} />
                        <Line type="monotone" dataKey="In Progress" stroke="#f97316" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="Completed" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Top 8 Next Actionable Tasks Card */}
          <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', marginBottom: 32 }}>
            <div className="section-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12, marginBottom: 20 }}>
              <span className="section-title">
                <span className="section-title-icon">🎯</span>
                Top 8 Next Actionable Tasks
              </span>
            </div>
            {next8ActionableTasks.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'var(--text-tertiary)', fontSize: 13 }}>
                No upcoming actionable tasks. All caught up! 🎉
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 20
              }}>
                {next8ActionableTasks.map((t) => {
                  const mtg = meetings?.find((m) => m.id === t.meeting_id);
                  return (
                    <div key={t.id} style={{
                      padding: '16px',
                      border: '1px solid var(--border-primary)',
                      borderRadius: 12,
                      background: 'var(--bg-tertiary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      boxShadow: 'var(--shadow-card)',
                      transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                    }}
                    className="hover-card-effect"
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.5, flex: 1 }}>
                        {t.task_description}
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            Owner: <strong>{t.owner}</strong>
                          </span>
                          <span style={{ color: 'var(--text-tertiary)' }}>
                            Due: {formatDate(t.due_date)}
                          </span>
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <PriorityBadge level={t.priority} />
                            <StatusBadge status={t.status} />
                          </div>
                          {mtg && (
                            <Link href={`/meetings/${mtg.id}`} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-accent)' }}>
                              Source ↗
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Team Backlog Table */}
          <div className="section-header" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span className="section-title">
              <span className="section-title-icon">📋</span>
              Team Backlog
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 12, fontWeight: 500 }}>
                ({filteredBacklog.length} total)
              </span>
            </span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-primary)', padding: '6px 12px', borderRadius: '6px', fontSize: 13, color: 'var(--text-primary)', outline: 'none' }}
              >
                <option value="none">Group By: None</option>
                <option value="category">Group By: Category</option>
                <option value="meeting">Group By: Context (Meeting)</option>
              </select>
              
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-primary)', padding: '6px 12px', borderRadius: '6px', fontSize: 13, color: 'var(--text-primary)', outline: 'none' }}
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
                  border: '1px solid var(--border-primary)',
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
    </div>
  );
}
