'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchMeetings, fetchTasks, fetchRisks } from '@/lib/api';
import { SkeletonCards, SkeletonTable } from '@/components/SkeletonLoader';
import PriorityBadge from '@/components/PriorityBadge';
import EmptyState from '@/components/EmptyState';

function formatDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return '—'; }
}

// Pure CSS donut chart
function DonutChart({ data, total }) {
  if (!total) return null;
  let cumulative = 0;
  const segments = data.map((d) => {
    const start = cumulative;
    cumulative += (d.value / total) * 100;
    return { ...d, start, end: cumulative };
  });

  const gradient = segments
    .map((s) => `${s.color} ${s.start}% ${s.end}%`)
    .join(', ');

  return (
    <div>
      <div
        className="donut-chart"
        style={{ background: `conic-gradient(${gradient})` }}
      >
        <div className="donut-hole">
          <span className="donut-total">{total}</span>
          <span className="donut-label">Total</span>
        </div>
      </div>
      <div className="chart-legend">
        {data.filter((d) => d.value > 0).map((d, i) => (
          <div key={i} className="chart-legend-item">
            <span className="chart-legend-dot" style={{ background: d.color }} />
            {d.label}: {d.value}
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChart({ data }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const colors = [
    'var(--accent-primary)',
    'hsl(250, 80%, 65%)',
    'hsl(280, 70%, 60%)',
    'hsl(190, 80%, 50%)',
  ];

  return (
    <div className="bar-chart">
      {data.map((d, i) => (
        <div key={i} className="bar-item">
          <span className="bar-item-label">{d.label}</span>
          <div className="bar-item-track">
            <div
              className="bar-item-fill"
              style={{
                width: `${Math.max((d.value / max) * 100, 8)}%`,
                background: colors[i % colors.length],
              }}
            >
              {d.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [meetings, setMeetings] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [risks, setRisks] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchMeetings(), fetchTasks(), fetchRisks()])
      .then(([m, t, r]) => {
        setMeetings(m);
        setTasks(t);
        setRisks(r);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page-animate">
        <div className="page-header">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Loading your command center…</p>
        </div>
        <SkeletonCards count={4} />
        <SkeletonTable rows={5} cols={4} />
      </div>
    );
  }

  const totalMeetings = meetings?.length || 0;
  const openTasks = tasks?.filter((t) => t.status === 'Open').length || 0;
  const criticalRisks = risks?.filter((r) => r.severity === 'Critical' || r.severity === 'High').length || 0;
  const unassigned = tasks?.filter((t) => t.owner === 'Unassigned' || !t.owner).length || 0;

  // Priority distribution for donut
  const priorityCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  tasks?.forEach((t) => { if (priorityCounts[t.priority] != null) priorityCounts[t.priority]++; });

  const donutData = [
    { label: 'Critical', value: priorityCounts.Critical, color: 'hsl(0, 84%, 60%)' },
    { label: 'High', value: priorityCounts.High, color: 'hsl(25, 95%, 53%)' },
    { label: 'Medium', value: priorityCounts.Medium, color: 'hsl(45, 93%, 47%)' },
    { label: 'Low', value: priorityCounts.Low, color: 'hsl(142, 71%, 45%)' },
  ];

  // Category distribution for bar
  const catCounts = { 'Action Item': 0, Decision: 0, 'Follow-up': 0, Info: 0 };
  tasks?.forEach((t) => { if (catCounts[t.category] != null) catCounts[t.category]++; });

  const barData = Object.entries(catCounts).map(([label, value]) => ({ label, value }));

  // Task counts per meeting (for the table)
  const meetingTaskCounts = {};
  tasks?.forEach((t) => {
    meetingTaskCounts[t.meeting_id] = (meetingTaskCounts[t.meeting_id] || 0) + 1;
  });
  const meetingRiskCounts = {};
  risks?.forEach((r) => {
    meetingRiskCounts[r.meeting_id] = (meetingRiskCounts[r.meeting_id] || 0) + 1;
  });

  const recentMeetings = (meetings || []).slice(0, 5);

  return (
    <div className="page-animate">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Project Command Center — at a glance</p>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="glass-card kpi-card">
          <div className="kpi-card-inner">
            <div className="kpi-icon blue">📋</div>
            <div className="kpi-content">
              <div className="kpi-value">{totalMeetings}</div>
              <div className="kpi-label">Total Meetings</div>
            </div>
          </div>
        </div>

        <div className="glass-card kpi-card">
          <div className="kpi-card-inner">
            <div className="kpi-icon green">✅</div>
            <div className="kpi-content">
              <div className="kpi-value">{openTasks}</div>
              <div className="kpi-label">Open Tasks</div>
            </div>
          </div>
        </div>

        <div className={`glass-card kpi-card ${criticalRisks > 0 ? 'pulse-danger' : ''}`}>
          <div className="kpi-card-inner">
            <div className="kpi-icon red">⚠️</div>
            <div className="kpi-content">
              <div className="kpi-value red">{criticalRisks}</div>
              <div className="kpi-label">Critical Risks</div>
            </div>
          </div>
        </div>

        <div className="glass-card kpi-card">
          <div className="kpi-card-inner">
            <div className="kpi-icon orange">👤</div>
            <div className="kpi-content">
              <div className="kpi-value orange">{unassigned}</div>
              <div className="kpi-label">Unassigned Tasks</div>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Charts */}
      {(tasks?.length > 0) && (
        <div className="charts-grid">
          <div className="glass-card">
            <div className="section-header">
              <span className="section-title">
                <span className="section-title-icon">📊</span>
                Priority Distribution
              </span>
            </div>
            <DonutChart data={donutData} total={tasks?.length || 0} />
          </div>

          <div className="glass-card">
            <div className="section-header">
              <span className="section-title">
                <span className="section-title-icon">📁</span>
                Tasks by Category
              </span>
            </div>
            <BarChart data={barData} />
          </div>
        </div>
      )}

      {/* Recent Meetings */}
      <div className="section-header">
        <span className="section-title">
          <span className="section-title-icon">🕐</span>
          Recent Meetings
        </span>
        {totalMeetings > 5 && (
          <Link href="/meetings" style={{ fontSize: 12, fontWeight: 500 }}>
            View all →
          </Link>
        )}
      </div>

      {recentMeetings.length === 0 ? (
        <EmptyState
          icon="📭"
          title="No meetings yet"
          text="Upload a meeting transcript to get started. Click the 'Upload Transcript' button in the sidebar."
        />
      ) : (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Meeting Title</th>
                <th>Upload Date</th>
                <th>Tasks</th>
                <th>Risks</th>
              </tr>
            </thead>
            <tbody>
              {recentMeetings.map((m) => (
                <tr key={m.id} className="clickable-row summary-trigger">
                  <td>
                    <Link href={`/meetings/${m.id}`} style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {m.title || m.file_name}
                    </Link>
                    {m.summary && (
                      <div className="summary-tooltip">
                        <div className="summary-tooltip-label">AI Summary</div>
                        {m.summary}
                      </div>
                    )}
                  </td>
                  <td className="td-date">{formatDate(m.upload_date)}</td>
                  <td>
                    <span className="section-badge">{meetingTaskCounts[m.id] || 0}</span>
                  </td>
                  <td>
                    {(meetingRiskCounts[m.id] || 0) > 0 ? (
                      <PriorityBadge level="High" />
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
