import { useState, useEffect } from 'react'
import { useApi } from '../hooks/useApi.js'

export default function SupportMessages() {
  const api = useApi()
  const [threads, setThreads] = useState(null)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [threadDetail, setThreadDetail] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  const [showNew, setShowNew] = useState(false)
  const [newSubject, setNewSubject] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newError, setNewError] = useState('')
  const [creating, setCreating] = useState(false)

  const loadThreads = () => {
    api.get('/support/threads')
      .then(setThreads)
      .catch((e) => setError(e.message))
  }

  useEffect(() => { loadThreads() }, [])

  const openThread = async (id) => {
    if (expandedId === id) {
      setExpandedId(null)
      setThreadDetail(null)
      return
    }
    setExpandedId(id)
    setThreadDetail(null)
    try {
      const detail = await api.get(`/support/threads/${id}`)
      setThreadDetail(detail)
    } catch (e) {
      setError(e.message)
    }
  }

  const sendReply = async () => {
    const body = replyText.trim()
    if (!body || !expandedId) return
    setSending(true)
    try {
      const detail = await api.post(`/support/threads/${expandedId}/messages`, { body })
      setThreadDetail(detail)
      setReplyText('')
      loadThreads()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const submitNewThread = async () => {
    const body = newBody.trim()
    if (!body) {
      setNewError('Please write a message.')
      return
    }
    setCreating(true)
    setNewError('')
    try {
      await api.post('/support/threads', { subject: newSubject, body })
      setNewSubject('')
      setNewBody('')
      setShowNew(false)
      loadThreads()
    } catch (e) {
      setNewError(e.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>💬 Messages to Support</h3>
        <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? 'Cancel' : '+ New Message'}
        </button>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 18px' }}>
        Leave a message for the platform team — billing questions, bugs, anything you need help with.
      </div>

      {showNew && (
        <div style={{ marginBottom: 20, padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
          <div className="form-row" style={{ marginBottom: 10 }}>
            <label>Subject</label>
            <input
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder="What's this about? (optional)"
              maxLength={200}
            />
          </div>
          <div className="form-row" style={{ marginBottom: 10 }}>
            <label>Message</label>
            <textarea
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Describe your question or issue…"
              style={{ width: '100%', minHeight: 90 }}
            />
          </div>
          {newError && <div className="error-text" style={{ marginBottom: 8 }}>{newError}</div>}
          <button className="btn btn-primary" onClick={submitNewThread} disabled={creating}>
            {creating ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}

      {error && <div className="error-text">{error}</div>}

      {threads === null && !error && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}
      {threads && threads.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No messages yet.</div>
      )}

      {threads && threads.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {threads.map((t) => (
            <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div
                onClick={() => openThread(t.id)}
                style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t.subject}
                    {t.unread_by_tenant && (
                      <span style={{ fontSize: 10, background: 'var(--accent)', color: '#fff', borderRadius: 999, padding: '2px 7px' }}>new reply</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.last_message_preview}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                  {t.status === 'closed' ? 'Closed · ' : ''}{new Date(t.last_message_at).toLocaleDateString()}
                </div>
              </div>

              {expandedId === t.id && (
                <div style={{ borderTop: '1px solid var(--border)', padding: 14, background: 'var(--surface-sunken)' }}>
                  {!threadDetail && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}
                  {threadDetail && (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        {threadDetail.messages.map((m) => (
                          <div key={m.id} style={{ display: 'flex', justifyContent: m.sender_is_superadmin ? 'flex-start' : 'flex-end', marginBottom: 8 }}>
                            <div style={{
                              maxWidth: '75%', padding: '8px 12px', borderRadius: 12,
                              background: m.sender_is_superadmin ? 'var(--surface)' : 'var(--accent)',
                              color: m.sender_is_superadmin ? 'inherit' : '#fff',
                              border: m.sender_is_superadmin ? '1px solid var(--border)' : 'none',
                            }}>
                              <div style={{ fontSize: 10, opacity: 0.75, marginBottom: 2 }}>
                                {m.sender_is_superadmin ? 'Support' : 'You'} · {new Date(m.created_at).toLocaleString()}
                              </div>
                              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{m.body}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder={threadDetail.status === 'closed' ? 'Replying will reopen this thread…' : 'Write a reply…'}
                        style={{ width: '100%', minHeight: 60, marginBottom: 8 }}
                      />
                      <button className="btn btn-primary" onClick={sendReply} disabled={sending || !replyText.trim()}>
                        {sending ? 'Sending…' : 'Reply'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
