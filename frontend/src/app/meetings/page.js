'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { fetchMeetings, fetchTasks, fetchRisks } from '@/lib/api';
import { SkeletonTable } from '@/components/SkeletonLoader';
import EmptyState from '@/components/EmptyState';
import { useAuth } from '@/lib/AuthContext';

function formatUploadDate(d) {
  if (!d) return '-';
  try {
    // The backend now returns ISO strings with a 'Z' suffix (UTC).
    // JavaScript will convert them to the user's local timezone automatically.
    return new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '-';
  }
}

export default function MeetingsPage() {
  // Use deptMeetingIds array directly (not the stable function ref) so the
  // useMemo below re-runs whenever the department meeting list updates.
  const { user, department, deptMeetingIds, organization } = useAuth();
  const [meetings, setMeetings] = useState(null);
  const [taskCounts, setTaskCounts] = useState({});
  const [riskCounts, setRiskCounts] = useState({});
  const [myMeetingIds, setMyMeetingIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organization?.id) return;
    setLoading(true);
    Promise.all([
      fetchMeetings(organization.id),
      fetchTasks(null, organization.id),
      fetchRisks(null, organization.id)
    ])
      .then(([m, t, r]) => {
        setMeetings(m);
        const tc = {};
        
        // Find which meeting IDs have tasks assigned to this user
        const userFullName = user?.name?.trim().toLowerCase();
        const userFirstName = user?.name?.trim().split(/\s+/)[0].toLowerCase();
        const myMtgIds = new Set();

        t.forEach((task) => {
          tc[task.meeting_id] = (tc[task.meeting_id] || 0) + 1;
          
          let isAssigned = false;
          if (Array.isArray(task.owners_list)) {
            isAssigned = task.owners_list.some((o) => {
              if (!o) return false;
              const oLower = String(o).trim().toLowerCase();
              return oLower === userFullName || oLower === userFirstName;
            });
          }
          if (!isAssigned && task.owner) {
            const ownerLower = String(task.owner).trim().toLowerCase();
            isAssigned = (
              ownerLower === userFullName ||
              ownerLower === userFirstName ||
              ownerLower.includes(userFullName) ||
              ownerLower.includes(userFirstName)
            );
          }
          if (isAssigned) {
            myMtgIds.add(task.meeting_id);
          }
        });
        setTaskCounts(tc);
        setMyMeetingIds(myMtgIds);

        const rc = {};
        r.forEach((risk) => { rc[risk.meeting_id] = (rc[risk.meeting_id] || 0) + 1; });
        setRiskCounts(rc);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [organization?.id, user]);

  // Filter meetings to only show those linked to the user's active department or those where the user has tasks.
  const filteredMeetings = useMemo(() => {
    if (!meetings || !department) return [];
    return meetings.filter((m) => deptMeetingIds.includes(m.id) || myMeetingIds.has(m.id));
  }, [meetings, department, deptMeetingIds, myMeetingIds]);

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
                  <td className="td-date">{formatUploadDate(m.upload_date)}</td>
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
