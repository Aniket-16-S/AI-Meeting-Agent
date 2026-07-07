export default function PriorityBadge({ level }) {
  if (!level) return null;
  const cls = level.toLowerCase();
  const dot = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
  };
  return (
    <span className={`priority-badge ${cls}`}>
      <span style={{ fontSize: '8px' }}>{dot[cls] || ''}</span>
      {level}
    </span>
  );
}
