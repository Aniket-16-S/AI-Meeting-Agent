'use client';
import { useState, useRef, useCallback } from 'react';
import { uploadFiles, fetchMeetings } from '@/lib/api';
import { useToast } from './Toast';
import { useAuth } from '@/lib/AuthContext';

export default function UploadModal({ onClose, onSuccess }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const { addToast } = useToast();
  const { department, linkMeetingToDepartment, isMeetingInDepartment } = useAuth();

  const handleFiles = useCallback((incoming) => {
    const arr = Array.from(incoming);
    setFiles((prev) => [...prev, ...arr]);
  }, []);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const removeFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpload = async () => {
    if (!files.length) return;
    setUploading(true);
    setResults(null);
    try {
      const data = await uploadFiles(files);
      setResults(data.results);

      let hasNew = false;
      const hasSkipped = data.results.some((r) => r.status === 'skipped');
      let allMeetings = [];
      
      if (hasSkipped) {
        try {
          allMeetings = await fetchMeetings();
        } catch (e) {
          console.error("Failed to fetch meetings for idempotency resolution", e);
        }
      }

      data.results.forEach((r) => {
        if (r.status === 'skipped') {
          const matching = allMeetings.find(
            (m) => m.file_name === r.filename || m.title === r.filename
          );
          if (matching && department) {
            const alreadyLinked = isMeetingInDepartment(matching.id, department.id);
            if (alreadyLinked) {
              addToast(`"${r.filename}" is already linked to your department.`, 'warning');
            } else {
              linkMeetingToDepartment(matching.id, department.id);
              hasNew = true;
              addToast('Meeting already exists and has been linked to your department.', 'success');
            }
          } else {
            addToast(`"${r.filename}" already processed.`, 'warning');
          }
        } else if (r.status === 'processed') {
          hasNew = true;
          if (r.meeting_id && department) {
            linkMeetingToDepartment(r.meeting_id, department.id);
          }
          addToast(`"${r.filename}" processed successfully!`, 'success');
        } else if (r.status === 'error') {
          addToast(`"${r.filename}": ${r.reason}`, 'error');
        }
      });

      if (hasNew && onSuccess) onSuccess();
    } catch (err) {
      addToast('Upload failed: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  };


  const fileIcon = (name) => {
    if (name.endsWith('.pdf')) return '📄';
    if (name.endsWith('.vtt')) return '🎬';
    return '📝';
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">Upload Transcript</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {!results && (
          <>
            <div
              className={`dropzone ${dragging ? 'dragging' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
            >
              <div className="dropzone-icon">📂</div>
              <div className="dropzone-text">
                Drop your transcript files here
              </div>
              <div className="dropzone-sub">
                Supports .txt, .pdf, .vtt
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".txt,.pdf,.vtt"
                style={{ display: 'none' }}
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <div className="upload-file-list">
                {files.map((f, i) => (
                  <div key={i} className="upload-file-item">
                    <span className="upload-file-icon">{fileIcon(f.name)}</span>
                    <span className="upload-file-name">{f.name}</span>
                    {!uploading && (
                      <button
                        className="modal-close"
                        style={{ width: 24, height: 24, fontSize: 11 }}
                        onClick={() => removeFile(i)}
                      >
                        ✕
                      </button>
                    )}
                    {uploading && (
                      <span className="upload-file-status processing">Processing…</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button
              className="upload-submit-btn"
              disabled={!files.length || uploading}
              onClick={handleUpload}
            >
              {uploading ? (
                <>
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                  </span>
                  Processing with AI…
                </>
              ) : (
                <>Upload & Extract</>
              )}
            </button>
          </>
        )}

        {results && (
          <div>
            <div className="upload-file-list">
              {results.map((r, i) => (
                <div key={i} className="upload-file-item">
                  <span className="upload-file-icon">
                    {r.status === 'processed' ? '✅' : r.status === 'skipped' ? '⚠️' : '❌'}
                  </span>
                  <span className="upload-file-name">{r.filename}</span>
                  <span className={`upload-file-status ${r.status === 'processed' ? 'success' : r.status === 'skipped' ? 'skipped' : 'error'}`}>
                    {r.status === 'processed' ? 'Done' : r.status === 'skipped' ? 'Duplicate' : 'Error'}
                  </span>
                </div>
              ))}
            </div>
            <button className="upload-submit-btn" onClick={onClose} style={{ marginTop: 16 }}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
