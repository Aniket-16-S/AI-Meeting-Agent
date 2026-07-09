export default function PriorityBadge({ level }) {
  if (!level) return null;
  const cls = level.toLowerCase();
  return (
    <span className={`priority-badge ${cls}`}>
      <span className="priority-dot"></span>
      {level}
    </span>
  );
}
