'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { fetchMeetings, fetchTasks, fetchRisks } from '@/lib/api';
import { SkeletonTable } from '@/components/SkeletonLoader';
import EmptyState from '@/components/EmptyState';
import { useAuth } from '@/lib/AuthContext';

function formatDate(d) {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '-'; }
}

export default function MeetingsPage() {
  const { department, getDepartmentMeetingIds } = useAuth();
  const [meetings, setMeetings] = useState(null);
  const [taskCounts, setTaskCounts] = useState({});
  const [riskCounts, setRiskCounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchMeetings(), fetchTasks(), fetchRisks()])
      .then(([m, t, r]) => {
        setMeetings(m);
        const tc = {};
        t.forEach((task) => { tc[task.meeting_id] = (tc[task.meeting_id] || 0) + 1; });
        setTaskCounts(tc);
        const rc = {};
        r.forEach((risk) => { rc[risk.meeting_id] = (rc[risk.meeting_id] || 0) + 1; });
        setRiskCounts(rc);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  // Filter meetings to only show those linked to the user's active department
  const filteredMeetings = useMemo(() => {
    if (!meetings || !department) return [];
    const deptMtgIds = getDepartmentMeetingIds(department.id);
    return meetings.filter((m) => deptMtgIds.includes(m.id));
  }, [meetings, department, getDepartmentMeetingIds]);

  if (loading) {
    return (
      <div className="page-animate">
        <div className="page-header">
          <h1 className="page-title">All Meetings</h1>
        </div>
        <SkeletonTable rows={8} cols={5} />
      </div>
    );
  }

  return (
    <div className="page-animate">
      <div className="page-header">
        <h1 className="page-title">All Meetings</h1>
        <p className="page-subtitle">
          {filteredMeetings.length} meetings in {department?.name}
        </p>
      </div>

      {!filteredMeetings.length ? (
        <EmptyState
          icon="📭"
          title="No meetings yet"
          text="Upload your first meeting transcript to get started."
        />
      ) : (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Upload Date</th>
                <th>Tasks</th>
                <th>Risks</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {filteredMeetings.map((m) => (
                <tr key={m.id} className="clickable-row">
                  <td>
                    <Link href={`/meetings/${m.id}`} style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {m.title || m.file_name}
                    </Link>
                  </td>
                  <td className="td-date">{formatDate(m.upload_date)}</td>
                  <td>
                    <span className="section-badge">{taskCounts[m.id] || 0}</span>
                  </td>
                  <td>
                    <span className="section-badge">{riskCounts[m.id] || 0}</span>
                  </td>
                  <td className="td-description" style={{ maxWidth: 300 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {m.summary
                        ? m.summary.length > 100
                          ? m.summary.slice(0, 100) + '…'
                          : m.summary
                        : '-'}
                    </span>
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
