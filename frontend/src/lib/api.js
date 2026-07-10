const API_BASE = '/api';

export async function fetchMeetings(organizationId) {
  if (!organizationId) return [];
  const res = await fetch(`${API_BASE}/meetings?organization_id=${organizationId}`);
  if (!res.ok) throw new Error('Failed to fetch meetings');
  const data = await res.json();
  return data.meetings;
}

export async function fetchMeeting(id, organizationId) {
  if (!organizationId) return null;
  const res = await fetch(`${API_BASE}/meetings/${id}?organization_id=${organizationId}`);
  if (!res.ok) throw new Error('Failed to fetch meeting');
  const data = await res.json();
  return data.meeting;
}

export async function fetchMeetingStatus(id, organizationId) {
  if (!organizationId) return 'FAILED';
  const res = await fetch(`${API_BASE}/meetings/${id}/status?organization_id=${organizationId}`);
  if (!res.ok) throw new Error('Failed to fetch status');
  const data = await res.json();
  return data.status;
}

export async function fetchTasks(meetingId = null, organizationId) {
  if (!organizationId) return [];
  let url = `${API_BASE}/tasks?organization_id=${organizationId}`;
  if (meetingId) {
    url += `&meeting_id=${meetingId}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch tasks');
  const data = await res.json();
  return data.tasks;
}

export async function fetchRisks(meetingId = null, organizationId) {
  if (!organizationId) return [];
  let url = `${API_BASE}/risks?organization_id=${organizationId}`;
  if (meetingId) {
    url += `&meeting_id=${meetingId}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch risks');
  const data = await res.json();
  return data.risks;
}

export async function uploadFiles(files, organizationId, uploadedBy, teamId = null) {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  
  let url = `${API_BASE}/upload?organization_id=${organizationId}&uploaded_by=${uploadedBy}`;
  if (teamId) {
    url += `&team_id=${teamId}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

export async function queryAgent(question, organizationId, userName) {
  if (!organizationId) throw new Error('Organization ID is required');
  const res = await fetch(`${API_BASE}/query?organization_id=${organizationId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, user_name: userName }),
  });
  if (!res.ok) throw new Error('Query failed');
  return res.json();
}

export async function updateTaskStatus(taskId, status) {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error('Failed to update task status');
  return res.json();
}

export async function fetchGoogleStatus(userId) {
  if (!userId) return { connected: false };
  const res = await fetch(`${API_BASE}/google/status?user_id=${userId}`);
  if (!res.ok) throw new Error('Failed to fetch Google status');
  return res.json();
}

export async function scheduleGoogleMeeting(userId, organizationId, meetingData) {
  const res = await fetch(`${API_BASE}/meetings/google?user_id=${userId}&organization_id=${organizationId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meetingData),
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.detail || 'Failed to schedule Google Meet');
  }
  return res.json();
}

export async function cancelGoogleMeeting(meetingId) {
  const res = await fetch(`${API_BASE}/meetings/google/${meetingId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.detail || 'Failed to cancel Google Meet');
  }
  return res.json();
}

export async function fetchLatestGoogleMeetings(organizationId, userId) {
  if (!organizationId || !userId) return [];
  const res = await fetch(`${API_BASE}/meetings/google/latest?organization_id=${organizationId}&user_id=${userId}`);
  if (!res.ok) throw new Error('Failed to fetch scheduled meetings');
  const data = await res.json();
  return data.meetings || [];
}

export async function deleteMeeting(meetingId, organizationId) {
  const res = await fetch(`${API_BASE}/meetings/${meetingId}?organization_id=${organizationId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || 'Failed to delete meeting');
  }
  return res.json();
}

export async function deleteTasksBulk(taskIds) {
  if (!taskIds || taskIds.length === 0) throw new Error('No task IDs provided');
  const res = await fetch(`${API_BASE}/tasks/bulk`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_ids: taskIds }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || 'Failed to bulk delete tasks');
  }
  return res.json();
}

