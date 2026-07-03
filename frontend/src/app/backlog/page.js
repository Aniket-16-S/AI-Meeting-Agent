'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { fetchTasks, fetchMeetings } from '@/lib/api';
import PriorityBadge from '@/components/PriorityBadge';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import { SkeletonTable } from '@/components/SkeletonLoader';

function formatDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return '—'; }
}

export default function BacklogPage() {
  const [tasks, setTasks] = useState(null);
  const [meetings, setMeetings] = useState({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterPriority, setFilterPriority] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => {
    Promise.all([fetchTasks(), fetchMeetings()])
      .then(([t, m]) => {
        setTasks(t);
        const map = {};
        m.forEach((mtg) => { map[mtg.id] = mtg; });
        setMeetings(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!tasks) return [];
    return tasks.filter((t) => {
      if (filterPriority && t.priority !== filterPriority) return false;
      if (filterCategory && t.category !== filterCategory) return false;
      if (filterStatus && t.status !== filterStatus) return false;
      if (filterOwner) {
        const owner = (t.owner || '').toLowerCase();
        if (!owner.includes(filterOwner.toLowerCase())) return false;
      }
      return true;
    });
  }, [tasks, filterPriority, filterCategory, filterOwner, filterStatus]);

  if (loading) {
    return (
      <div className="page-animate">
        <div className="page-header">
          <h1 className="page-title">Global Backlog</h1>
        </div>
        <SkeletonTable rows={8} cols={6} />
      </div>
    );
  }

  return (
    <div className="page-animate">
      <div className="page-header">
        <h1 className="page-title">Global Backlog</h1>
        <p className="page-subtitle">
          {filtered.length} of {tasks?.length || 0} tasks
        </p>
      </div>

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
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="Open">Open</option>
          <option value="Closed">Closed</option>
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
          icon="🔍"
          title="No tasks match your filters"
          text={tasks?.length ? 'Try adjusting your filters to see more results.' : 'Upload a meeting transcript to populate the backlog.'}
        />
      ) : (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Owner</th>
                <th>Priority</th>
                <th>Category</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Meeting</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const mtg = meetings[t.meeting_id];
                return (
                  <tr key={t.id}>
                    <td className="td-description">{t.task_description}</td>
                    <td className="td-owner">
                      {t.owner === 'Unassigned' || !t.owner ? (
                        <span className="owner-unassigned">Unassigned</span>
                      ) : (
                        t.owner
                      )}
                    </td>
                    <td><PriorityBadge level={t.priority} /></td>
                    <td><span className="category-badge">{t.category}</span></td>
                    <td className="td-date">
                      {t.due_date ? formatDate(t.due_date) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                      )}
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td>
                      {mtg ? (
                        <Link
                          href={`/meetings/${t.meeting_id}`}
                          style={{ fontSize: 12, color: 'var(--text-accent)' }}
                          title={mtg.title || mtg.file_name}
                        >
                          {(mtg.title || mtg.file_name || '').slice(0, 20)}
                          {(mtg.title || mtg.file_name || '').length > 20 ? '…' : ''}
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>
                      )}
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
