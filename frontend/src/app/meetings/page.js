'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { fetchMeetings, fetchTasks, fetchRisks, deleteMeeting } from '@/lib/api';
import { SkeletonTable } from '@/components/SkeletonLoader';
import EmptyState from '@/components/EmptyState';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/Toast';

function formatUploadDate(d) {
  if (!d) return '-';
  try {
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
  const { user, department, deptMeetingIds, organization } = useAuth();
  const { addToast } = useToast();
  const [meetings, setMeetings] = useState(null);
  const [taskCounts, setTaskCounts] = useState({});
  const [riskCounts, setRiskCounts] = useState({});
  const [myMeetingIds, setMyMeetingIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, title }
  const [deleting, setDeleting] = useState(false);

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

  const filteredMeetings = useMemo(() => {
    if (!meetings || !department) return [];
    return meetings.filter((m) => deptMeetingIds.includes(m.id) || myMeetingIds.has(m.id));
  }, [meetings, department, deptMeetingIds, myMeetingIds]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteMeeting(deleteTarget.id, organization.id);
      setMeetings((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      addToast('Meeting permanently deleted.', 'success');
      setDeleteTarget(null);
    } catch (err) {
      addToast(err.message || 'Failed to delete meeting', 'error');
    } finally {
      setDeleting(false);
    }
  };

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

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => !deleting && setDeleteTarget(null)}>
          <div
            className="modal-content delete-confirm-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ textAlign: 'center' }}
          >
            <div className="modal-warning-icon" style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: 'var(--color-critical-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: 'var(--color-critical-text)',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
              </svg>
            </div>

            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
              Delete Meeting Permanently?
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
              <strong style={{ color: 'var(--text-primary)' }}>
                &quot;{(deleteTarget.title || deleteTarget.file_name || 'This meeting').slice(0, 60)}&quot;
              </strong>
              {' '}and all its associated{' '}
              <strong style={{ color: 'var(--color-critical-text)' }}>tasks, summaries, and risks</strong>{' '}
              will be permanently removed. This action cannot be undone.
            </p>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                style={{
                  padding: '9px 20px',
                  borderRadius: 8,
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="btn-danger-sm"
                style={{ padding: '9px 20px', fontSize: 13, borderRadius: 8 }}
              >
                {deleting ? (
                  <>
                    <span className="spinning-loader" style={{ width: 12, height: 12 }} />
                    Deleting…
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                    Delete Permanently
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMeetings.map((m) => (
                <tr key={m.id} className="clickable-row">
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <Link href={`/meetings/${m.id}`} style={{ color: 'var(--text-primary)', fontWeight: 500, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.title || m.file_name}>
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
                  <td className="td-description" style={{ maxWidth: 305 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {m.summary
                        ? m.summary.length > 90
                          ? m.summary.slice(0, 90) + '…'
                          : m.summary
                        : '-'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <Link
                        href={`/meetings/${m.id}`}
                        style={{
                          display: 'inline-block',
                          background: 'var(--accent-primary-glow)',
                          color: 'var(--accent-primary)',
                          border: '1px solid var(--border-primary)',
                          padding: '5px 11px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          textDecoration: 'none',
                          transition: 'all 0.2s ease',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        View Details ↗
                      </Link>
                      <button
                        onClick={() => setDeleteTarget(m)}
                        className="btn-danger-sm"
                        title="Delete meeting permanently"
                        style={{ padding: '5px 8px' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                        </svg>
                      </button>
                    </div>
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
