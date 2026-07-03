export default function EmptyState({ icon, title, text }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon || '📭'}</div>
      <div className="empty-state-title">{title || 'Nothing here yet'}</div>
      <div className="empty-state-text">{text || 'Data will appear here once available.'}</div>
    </div>
  );
}
