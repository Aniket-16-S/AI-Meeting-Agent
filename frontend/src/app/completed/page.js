'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { fetchTasks, fetchMeetings, updateTaskStatus, deleteTasksBulk } from '@/lib/api';
import PriorityBadge from '@/components/PriorityBadge';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import { SkeletonTable } from '@/components/SkeletonLoader';
import EntityResolutionBadge from '@/components/EntityResolutionBadge';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/Toast';

function formatDate(d) {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return '-'; }
}

export default function CompletedTasksPage() {
  const { user, department, getDepartmentMeetingIds, organization } = useAuth();
  const { addToast } = useToast();
  const [tasks, setTasks] = useState(null);
  const [meetings, setMeetings] = useState({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterPriority, setFilterPriority] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterMeeting, setFilterMeeting] = useState('');

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);

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
    Promise.all([fetchTasks(null, organization.id), fetchMeetings(organization.id)])
      .then(([t, m]) => {
        setTasks(t);
        const map = {};
        m.forEach((mtg) => { map[mtg.id] = mtg; });
        setMeetings(map);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [organization?.id]);

  const filteredDeptTasks = useMemo(() => {
    if (!tasks || !department || !user) return [];
    const deptMtgIds = getDepartmentMeetingIds(department.id);

    const userFullName = user.name.trim().toLowerCase();
    const userFirstName = user.name.trim().split(/\s+/)[0].toLowerCase();

    return tasks.filter((t) => {
      if (t.status !== 'Closed') return false;

      const isInDept = deptMtgIds.includes(t.meeting_id);

      let isAssignedToMe = false;
      if (Array.isArray(t.owners_list)) {
        isAssignedToMe = t.owners_list.some((o) => {
          if (!o) return false;
          const oLower = String(o).trim().toLowerCase();
          return oLower === userFullName || oLower === userFirstName;
        });
      }
      if (!isAssignedToMe && t.owner) {
        const ownerLower = String(t.owner).trim().toLowerCase();
        isAssignedToMe = (
          ownerLower === userFullName ||
          ownerLower === userFirstName ||
          ownerLower.includes(userFullName) ||
          ownerLower.includes(userFirstName)
        );
      }

      return isInDept || isAssignedToMe;
    });
  }, [tasks, department, getDepartmentMeetingIds, user]);

  const backlogMeetings = useMemo(() => {
    const ids = new Set(filteredDeptTasks.map((t) => t.meeting_id).filter(Boolean));
    return Array.from(ids).map((id) => meetings[id]).filter(Boolean);
  }, [filteredDeptTasks, meetings]);

  const filtered = useMemo(() => {
    return filteredDeptTasks.filter((t) => {
      if (filterPriority && t.priority !== filterPriority) return false;
      if (filterCategory && t.category !== filterCategory) return false;
      if (filterMeeting && t.meeting_id !== filterMeeting) return false;
      if (filterOwner) {
        const queryLower = filterOwner.toLowerCase();
        const matchesOwnerStr = (t.owner || '').toLowerCase().includes(queryLower);

        let matchesOwnersList = false;
        if (Array.isArray(t.owners_list)) {
          matchesOwnersList = t.owners_list.some(o =>
            (o || '').toLowerCase().includes(queryLower)
          );
        }

        if (!matchesOwnerStr && !matchesOwnersList) return false;
      }
      return true;
    });
  }, [filteredDeptTasks, filterPriority, filterCategory, filterOwner, filterMeeting]);

  // Toggle select mode — clear selection when exiting
  const toggleSelectMode = () => {
    setSelectMode((prev) => {
      if (prev) {
        setSelectedIds(new Set());
        setShowDeleteConfirm(false);
      }
      return !prev;
    });
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filtered.map((t) => t.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkDelete = async () => {
    if (deletingBulk || selectedIds.size === 0) return;
    setDeletingBulk(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await deleteTasksBulk(ids);
      // Immediately remove deleted tasks from state
      setTasks((prev) => prev?.filter((t) => !selectedIds.has(t.id)));
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
      setSelectMode(false);
      addToast(`${result.deleted_count ?? ids.length} task(s) permanently deleted.`, 'success');
    } catch (err) {
      addToast(err.message || 'Failed to delete tasks. Please try again.', 'error');
    } finally {
      setDeletingBulk(false);
    }
  };

  if (loading) {
    return (
      <div className="page-animate">
        <div className="page-header">
          <h1 className="page-title">Completed Tasks</h1>
        </div>
        <SkeletonTable rows={8} cols={6} />
      </div>
    );
  }

  const selectedCount = selectedIds.size;
  const allSelected = filtered.length > 0 && selectedCount === filtered.length;

  return (
    <div className="page-animate">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 className="page-title">Completed Tasks</h1>
            <p className="page-subtitle">
              {filtered.length} of {filteredDeptTasks.length} completed tasks in {department?.name}
            </p>
          </div>
          {/* Multi-select toggle — pill button with icon + label */}
          <button
            className={`btn-multiselect-toggle ${selectMode ? 'active' : ''}`}
            onClick={toggleSelectMode}
            title={selectMode ? 'Exit selection mode' : 'Select tasks to delete'}
            style={{ borderRadius: 20, padding: '0 12px 0 8px', width: 'auto', gap: 6 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <polyline points="9 11 12 14 20 6" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              {selectMode ? 'Cancel' : 'Select'}
            </span>
          </button>
        </div>
      </div>

      {/* Bulk action bar — only when in select mode and items are selected */}
      {selectMode && selectedCount > 0 && !showDeleteConfirm && (
        <div className="bulk-action-bar">
          <span className="bulk-action-bar-count">
            {selectedCount} task{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <button className="btn-select-all" onClick={allSelected ? clearSelection : selectAll}>
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          <button
            className="btn-danger-sm"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            Delete Permanently ({selectedCount})
          </button>
        </div>
      )}

      {/* Select All header when in select mode, no items selected yet */}
      {selectMode && selectedCount === 0 && (
        <div className="bulk-action-bar">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Click the checkboxes to select tasks</span>
          <button className="btn-select-all" onClick={selectAll}>Select All</button>
        </div>
      )}

      {/* Inline delete confirmation */}
      {showDeleteConfirm && (
        <div className="confirm-dialog-inline">
          <p>
            <strong>Permanently delete {selectedCount} completed task{selectedCount !== 1 ? 's' : ''}?</strong>
            {' '}This action cannot be undone and will remove the tasks from the database immediately.
          </p>
          <div className="confirm-actions">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deletingBulk}
              style={{
                padding: '7px 16px',
                borderRadius: 7,
                border: '1px solid var(--border-primary)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              className="btn-danger-sm"
              onClick={handleBulkDelete}
              disabled={deletingBulk}
              style={{ padding: '7px 16px' }}
            >
              {deletingBulk ? (
                <>
                  <span className="spinning-loader" style={{ width: 11, height: 11 }} />
                  Deleting…
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                  Confirm Delete
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="filter-bar">
        <select
          className="filter-select"
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
        >
          <option value="">All Priorities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <select
          className="filter-select"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          <option value="Action Item">Action Item</option>
          <option value="Decision">Decision</option>
          <option value="Follow-up">Follow-up</option>
          <option value="Info">Info</option>
        </select>

        <select
          className="filter-select"
          value={filterMeeting}
          onChange={(e) => setFilterMeeting(e.target.value)}
          style={{ maxWidth: '200px', textOverflow: 'ellipsis' }}
        >
          <option value="">All Meetings</option>
          {backlogMeetings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title || m.file_name}
            </option>
          ))}
        </select>

        <input
          className="filter-input"
          type="text"
          placeholder="Search by owner…"
          value={filterOwner}
          onChange={(e) => setFilterOwner(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="✅"
          title="No completed tasks match your filters"
          text={filteredDeptTasks.length ? 'Try adjusting your filters to see more results.' : 'No completed tasks found in this department. Work on active tasks on the Dashboard or Backlog!'}
        />
      ) : (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                {selectMode && <th style={{ width: 40 }}></th>}
                <th>Description</th>
                <th>Owner</th>
                <th>Priority</th>
                <th>Category</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Meeting</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const mtg = meetings[t.meeting_id];
                const isSelected = selectedIds.has(t.id);
                return (
                  <tr
                    key={t.id}
                    style={{
                      background: isSelected ? 'var(--accent-primary-glow)' : undefined,
                      transition: 'background 0.15s ease',
                    }}
                    onClick={selectMode ? () => toggleSelect(t.id) : undefined}
                  >
                    {selectMode && (
                      <td style={{ paddingLeft: 14 }}>
                        <input
                          type="checkbox"
                          className="selection-checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(t.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    )}
                    <td className="td-description">{t.task_description}</td>
                    <td>
                      <EntityResolutionBadge ownerName={t.owner} />
                    </td>
                    <td><PriorityBadge level={t.priority} /></td>
                    <td><span className="category-badge">{t.category}</span></td>
                    <td className="td-date">
                      {t.due_date ? formatDate(t.due_date) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>-</span>
                      )}
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td>
                      {mtg ? (
                        <Link
                          href={`/meetings/${t.meeting_id}`}
                          style={{ fontSize: 12, color: 'var(--accent-primary)' }}
                          title={mtg.title || mtg.file_name}
                        >
                          {(mtg.title || mtg.file_name || '').slice(0, 20)}
                          {(mtg.title || mtg.file_name || '').length > 20 ? '…' : ''}
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>-</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <select
                        value={t.status}
                        onChange={(e) => handleStatusChange(t.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          background: t.status === 'Closed' ? 'var(--color-success-bg)' : t.status === 'In Progress' ? 'var(--color-high-bg)' : 'var(--bg-input)',
                          color: t.status === 'Closed' ? 'var(--color-success-text)' : t.status === 'In Progress' ? 'var(--color-high-text)' : 'var(--text-primary)',
                          border: `1px solid ${t.status === 'Closed' ? 'var(--color-success-border)' : t.status === 'In Progress' ? 'var(--color-high-border)' : 'var(--border-primary)'}`,
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
      )}
    </div>
  );
}
