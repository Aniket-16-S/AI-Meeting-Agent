export default function StatusBadge({ status }) {
  if (!status) return null;
  const cls = status.toLowerCase().replace(' ', '-');
  return (
    <span className={`status-badge ${cls}`}>
      <span className="status-dot"></span>
      {status}
    </span>
  );
}
