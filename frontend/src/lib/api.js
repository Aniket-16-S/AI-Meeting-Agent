const API_BASE = '/api';

export async function fetchMeetings() {
  const res = await fetch(`${API_BASE}/meetings`);
  if (!res.ok) throw new Error('Failed to fetch meetings');
  const data = await res.json();
  return data.meetings;
}

export async function fetchMeeting(id) {
  const res = await fetch(`${API_BASE}/meetings/${id}`);
  if (!res.ok) throw new Error('Failed to fetch meeting');
  const data = await res.json();
  return data.meeting;
}

export async function fetchTasks(meetingId = null) {
  const url = meetingId
    ? `${API_BASE}/tasks?meeting_id=${meetingId}`
    : `${API_BASE}/tasks`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch tasks');
  const data = await res.json();
  return data.tasks;
}

export async function fetchRisks(meetingId = null) {
  const url = meetingId
    ? `${API_BASE}/risks?meeting_id=${meetingId}`
    : `${API_BASE}/risks`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch risks');
  const data = await res.json();
  return data.risks;
}

export async function uploadFiles(files) {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

export async function queryAgent(question) {
  const res = await fetch(`${API_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error('Query failed');
  return res.json();
}
