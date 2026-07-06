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

  // Sorting for Member Tasks
  const [sortAsc, setSortAsc] = useState(true);

  // User Filter for Manager Backlog
  const [selectedUserFilter, setSelectedUserFilter] = useState('');

  const handleToggleComplete = async (taskId, currentStatus) => {
    const newStatus = currentStatus === 'Open' ? 'Closed' : 'Open';
    try {
      await updateTaskStatus(taskId, newStatus);
      setTasks((prevTasks) =>
        prevTasks?.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
      );
      addToast(
        newStatus === 'Closed'
          ? 'Task marked as completed!'
          : 'Task reopened!',
        'success'
      );
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
    return [...myTasks].sort((a, b) => {
      const dateA = a.due_date ? new Date(a.due_date) : new Date('9999-12-31');
      const dateB = b.due_date ? new Date(b.due_date) : new Date('9999-12-31');
      return sortAsc ? dateA - dateB : dateB - dateA;
    });
  }, [myTasks, sortAsc]);

  const memberKPIs = useMemo(() => {
    if (!myTasks) return { open: 0, thisWeek: 0, overdue: 0 };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(today);
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + 7);

    const open = myTasks.filter((t) => t.status === 'Open').length;

    const thisWeek = myTasks.filter((t) => {
      if (t.status !== 'Open' || !t.due_date) return false;
      const d = new Date(t.due_date);
      return d >= startOfWeek && d <= endOfWeek;
    }).length;

    const overdue = myTasks.filter((t) => {
      if (t.status !== 'Open' || !t.due_date) return false;
      const d = new Date(t.due_date);
      return d < today;
    }).length;

    return { open, thisWeek, overdue };
  }, [myTasks]);

  // Manager-Specific calculations
  const managerKPIs = useMemo(() => {
    if (!deptTasks || !deptRis) return { openTasks: 0, closedTasks: 0, criticalRisks: 0, unassigned: 0 };
    const openTasks = deptTasks.filter((t) => t.status === 'Open').length;
    const closedTasks = deptTasks.filter((t) => t.status === 'Closed' || t.status === 'Done').length;
    const criticalRisks = deptRis.filter((r) => r.severity === 'Critical').length;
    const unassigned = deptTasks.filter((t) => t.owner === 'Unassigned' || !t.owner).length;

    return { openTasks, closedTasks, criticalRisks, unassigned };
  }, [deptTasks, deptRis]);

  // Manager Chart 1: Risk Severity Doughnut Chart
  const pieData = useMemo(() => {
    if (!deptRis) return [];
    const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    deptRis.forEach((r) => {
      if (counts[r.severity] !== undefined) counts[r.severity]++;
    });
    return [
      { name: 'Critical', value: counts.Critical, color: '#ef4444' },
      { name: 'High', value: counts.High, color: '#f97316' },
      { name: 'Medium', value: counts.Medium, color: '#eab308' },
      { name: 'Low', value: counts.Low, color: '#22c55e' },
    ].filter((d) => d.value > 0);
  }, [deptRis]);

  // Manager Chart 3: Line Chart Task Burn-down (last 30 days)
  const lineData = useMemo(() => {
    if (!deptTasks) return [];
    const today = new Date();
    const data = [];

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      date.setHours(23, 59, 59, 999);

      // Cumulative tasks created up to this date
      const created = deptTasks.filter(
        (t) => new Date(t.created_at || Date.now()) <= date
      ).length;

      // Cumulative tasks closed up to this date
      const completed = deptTasks.filter((t) => {
        if (t.status !== 'Open') {
          const creationDate = new Date(t.created_at || Date.now());
          return creationDate <= date;
        }
        return false;
      }).length;

      data.push({
        dateStr: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        Created: created,
        Completed: completed,
      });
    }
    return data;
  }, [deptTasks]);

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

  const userIsManager = user?.role === 'admin';

  return (
    <div className="page-animate">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title">{userIsManager ? 'Team Oversight & Analytics' : 'My Work'}</h1>
          <p className="page-subtitle">
            {department?.name} Department, {organization?.name}
          </p>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'var(--bg-secondary)',
          padding: '6px 12px',
          borderRadius: '8px',
          border: '1px solid var(--border-primary)',
          fontSize: '13px',
          fontWeight: 500
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>Logged in as:</span>
          <span style={{
            color: user?.role === 'admin' ? 'var(--color-critical-text)' : 'var(--color-low-text)',
            background: user?.role === 'admin' ? 'var(--color-critical-bg)' : 'var(--color-low-bg)',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 700
          }}>
            {user?.role === 'admin' ? 'Admin' : 'Employee'}
          </span>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          MEMBER VIEW (Employee Dashboard)
          ───────────────────────────────────────────────────────────── */}
      {!userIsManager && (
        <>
          {/* Member KPIs */}
          <div className="kpi-grid" style={{ marginBottom: 32 }}>
            <div className="glass-card kpi-card">
              <div className="kpi-card-inner">
                <div className="kpi-icon blue">📋</div>
                <div className="kpi-content">
                  <div className="kpi-value">{memberKPIs.open}</div>
                  <div className="kpi-label">My Open Tasks</div>
                </div>
              </div>
            </div>

            <div className="glass-card kpi-card">
              <div className="kpi-card-inner">
                <div className="kpi-icon green">📅</div>
                <div className="kpi-content">
                  <div className="kpi-value">{memberKPIs.thisWeek}</div>
                  <div className="kpi-label">Due This Week</div>
                </div>
              </div>
            </div>

            <div className={`glass-card kpi-card ${memberKPIs.overdue > 0 ? 'pulse-danger' : ''}`}>
              <div className="kpi-card-inner">
                <div className="kpi-icon red">⚠️</div>
                <div className="kpi-content">
                  <div className="kpi-value red">{memberKPIs.overdue}</div>
                  <div className="kpi-label">My Overdue Tasks</div>
                </div>
              </div>
            </div>
          </div>

          {/* Member Tasks Table */}
          <div className="section-header" style={{ marginBottom: 16 }}>
            <span className="section-title">
              <span className="section-title-icon">📋</span>
              My Assigned Action Items
            </span>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Total: {myTasks.length} tasks
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
            <div className="data-table-wrapper" style={{ marginBottom: 32 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Meeting Source</th>
                    <th
                      onClick={() => setSortAsc(!sortAsc)}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}
                    >
                      Deadline {sortAsc ? '▲' : '▼'}
                    </th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMyTasks.map((t) => {
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
                          {t.status === 'Open' ? (
                            <button
                              onClick={() => handleToggleComplete(t.id, t.status)}
                              className="btn-complete"
                            >
                              ✓ Mark Complete
                            </button>
                          ) : (
                            <button
                              onClick={() => handleToggleComplete(t.id, t.status)}
                              title="Click to reopen task"
                              style={{
                                background: 'rgba(34, 197, 94, 0.1)',
                                color: '#22c55e',
                                border: '1px solid rgba(34, 197, 94, 0.2)',
                                cursor: 'pointer',
                                padding: '6px 12px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 500,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'all 0.2s ease'
                              }}
                            >
                              ✓ Completed
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent Meetings Feed */}
          <div className="section-header" style={{ marginBottom: 16 }}>
            <span className="section-title">
              <span className="section-title-icon">🎬</span>
              Department Transcripts Feed
            </span>
          </div>

          {deptMeetings.length === 0 ? (
            <EmptyState
              icon="📭"
              title="No meetings uploaded yet"
              text="Transcripts uploaded by team members in your department will appear here."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {deptMeetings.slice(0, 5).map((m) => (
                <div key={m.id} className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Link href={`/meetings/${m.id}`} style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {m.title || m.file_name}
                    </Link>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{formatDate(m.upload_date)}</span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {m.summary || 'No summary extracted for this meeting transcript.'}
                  </p>
                  <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                    <span className="section-badge" style={{ fontSize: 11 }}>
                      📋 Tasks: {deptTasks.filter((t) => t.meeting_id === m.id).length}
                    </span>
                    <span className="section-badge" style={{ fontSize: 11 }}>
                      ⚠️ Risks: {deptRis.filter((r) => r.meeting_id === m.id).length}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MANAGER VIEW (OrgAdmin & DeptManager Dashboard)
          ───────────────────────────────────────────────────────────── */}
      {userIsManager && (
        <>
          {/* Manager KPIs */}
          <div className="kpi-grid" style={{ marginBottom: 32 }}>
            <div className="glass-card kpi-card">
              <div className="kpi-card-inner">
                <div className="kpi-icon blue">📋</div>
                <div className="kpi-content">
                  <div className="kpi-value" style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span>{managerKPIs.openTasks}</span>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                      / {managerKPIs.openTasks + managerKPIs.closedTasks}
                    </span>
                  </div>
                  <div className="kpi-label">Open vs Closed Tasks</div>
                </div>
              </div>
            </div>

            <div className={`glass-card kpi-card ${managerKPIs.criticalRisks > 0 ? 'pulse-danger' : ''}`}>
              <div className="kpi-card-inner">
                <div className="kpi-icon red">⚠️</div>
                <div className="kpi-content">
                  <div className="kpi-value red">{managerKPIs.criticalRisks}</div>
                  <div className="kpi-label">Open Critical Risks</div>
                </div>
              </div>
            </div>

            <div className="glass-card kpi-card">
              <div className="kpi-card-inner">
                <div className="kpi-icon orange">👤</div>
                <div className="kpi-content">
                  <div className="kpi-value orange">{managerKPIs.unassigned}</div>
                  <div className="kpi-label">Unassigned Tasks</div>
                </div>
              </div>
            </div>
          </div>

          {/* Visual Analytics */}
          <div className="charts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, marginBottom: 32 }}>
            {/* Risk Severity Breakdown Doughnut */}
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', height: 380 }}>
              <div className="section-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12, marginBottom: 16 }}>
                <span className="section-title">
                  <span className="section-title-icon">📊</span>
                  Risk Severity Breakdown
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {mounted && (
                  pieData.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                      No risk items detected in department.
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
                        <Tooltip formatter={(value) => [`${value} Risks`, 'Count']} />
                        <Legend verticalAlign="bottom" height={36} />
                      </PieChart>
                    </ResponsiveContainer>
                  )
                )}
              </div>
            </div>

            {/* Task Distribution Bar Chart */}


            {/* Task Burn-down Line Chart */}
            <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', height: 380, gridColumn: 'span 1' }}>
              <div className="section-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12, marginBottom: 16 }}>
                <span className="section-title">
                  <span className="section-title-icon">📈</span>
                  Task Velocity (Last 30 Days)
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {mounted && (
                  deptTasks.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                      No tasks available to track burn-down.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={lineData} margin={{ right: 10, left: -15 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                        <XAxis dataKey="dateStr" stroke="var(--text-tertiary)" fontSize={11} tickCount={6} />
                        <YAxis stroke="var(--text-tertiary)" fontSize={11} allowDecimals={false} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(value, name) => [`${value} Tasks`, name]} />
                        <Legend />
                        <Line type="monotone" dataKey="Created" stroke="hsl(250, 80%, 60%)" strokeWidth={2.5} dot={false} activeDot={{ r: 6 }} />
                        <Line type="monotone" dataKey="Completed" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Team Backlog Table */}
          <div className="section-header" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span className="section-title">
              <span className="section-title-icon">📋</span>
              Team Backlog
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
            <div className="data-table-wrapper">
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
                  {filteredBacklog.map((t) => {
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
                          {t.status === 'Open' ? (
                            <button
                              onClick={() => handleToggleComplete(t.id, t.status)}
                              className="btn-complete"
                            >
                              ✓ Mark Complete
                            </button>
                          ) : (
                            <button
                              onClick={() => handleToggleComplete(t.id, t.status)}
                              title="Click to reopen task"
                              style={{
                                background: 'rgba(34, 197, 94, 0.1)',
                                color: '#22c55e',
                                border: '1px solid rgba(34, 197, 94, 0.2)',
                                cursor: 'pointer',
                                padding: '6px 12px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 500,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'all 0.2s ease'
                              }}
                            >
                              ✓ Completed
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
