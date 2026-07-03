export default function StatusBadge({ status }) {
  if (!status) return null;
  const cls = status.toLowerCase();
  return <span className={`status-badge ${cls}`}>{status}</span>;
}
