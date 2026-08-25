import { useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'

export default function Attachments({ entityType, entityId, onAttachmentChange }) {
  const api = useApi()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'manager'

  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const loadAttachments = () => {
    if (!entityType || !entityId) return
    setLoading(true)
    setError('')
    api.get(`/attachments?entity_type=${entityType}&entity_id=${entityId}`)
      .then(setAttachments)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  // Load attachments when entityType or entityId changes
  useState(() => {
    loadAttachments()
  }, [entityType, entityId])

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setUploading(true)
    setError('')

    try {
      // In a real implementation, you would upload to S3 or a file storage service
      // For now, we'll use a placeholder URL
      const fileUrl = `/uploads/${Date.now()}_${file.name}`
      
      await api.post('/attachments', {
        entity_type: entityType,
        entity_id: entityId,
        file_url: fileUrl,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
      })
      
      loadAttachments()
      if (onAttachmentChange) onAttachmentChange()
    } catch (err) {
      setError(err.message || 'Failed to upload file')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (attachmentId) => {
    if (!confirm('Are you sure you want to delete this attachment?')) return

    try {
      await api.delete(`/attachments/${attachmentId}`)
      loadAttachments()
      if (onAttachmentChange) onAttachmentChange()
    } catch (err) {
      setError(err.message || 'Failed to delete attachment')
    }
  }

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  if (!entityType || !entityId) {
    return null
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Attachments</h3>
        {isAdmin && (
          <label className="btn btn-outline" style={{ cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : '+ Upload'}
            <input
              type="file"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </label>
        )}
      </div>

      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}

      {loading && <div style={{ color: 'var(--text-muted)' }}>Loading attachments…</div>}

      {!loading && attachments.length === 0 && (
        <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>No attachments</div>
      )}

      {!loading && attachments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {attachments.map((att) => (
            <div
              key={att.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-light)',
                borderRadius: 4,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.file_name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {formatFileSize(att.file_size)} • {new Date(att.uploaded_at).toLocaleDateString()}
                </div>
              </div>
              {isAdmin && (
                <button
                  className="btn btn-outline"
                  style={{ padding: '4px 8px', fontSize: 12, color: 'var(--danger)', borderColor: 'var(--danger)', marginLeft: 8 }}
                  onClick={() => handleDelete(att.id)}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
