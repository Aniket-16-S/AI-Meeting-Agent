export default function StatusBadge({ status }) {
  if (!status) return null;
  const cls = status.toLowerCase().replace(' ', '-');
  return <span className={`status-badge ${cls}`}>{status}</span>;
}
