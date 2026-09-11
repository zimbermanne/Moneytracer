import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import SearchBar from '../components/SearchBar.jsx'
import PageLoader from '../components/PageLoader.jsx'

export default function Messages() {
  const { t } = useTranslation()
  const api = useApi()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeThreadId = searchParams.get('thread')

  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeThread, setActiveThread] = useState(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)

  const scrollRef = useRef(null)

  const loadThreads = () => {
    api.get('/messages/threads')
      .then(setThreads)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadThreads()
    const id = setInterval(loadThreads, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (activeThreadId) {
      api.get(`/messages/threads/${activeThreadId}`)
        .then(setActiveThread)
        .catch(e => setError(e.message))
    } else {
      setActiveThread(null)
    }
  }, [activeThreadId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [activeThread])

  const sendReply = async (e) => {
    e.preventDefault()
    if (!reply.trim() || sending) return
    setSending(true)
    try {
      const updated = await api.post(`/messages/threads/${activeThreadId}/messages`, { body: reply })
      setActiveThread(updated)
      setReply('')
      loadThreads()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const searchBusinesses = (q) => {
    setQuery(q)
    if (q.length < 3) { setResults([]); return }
    setSearching(true)
    api.get(`/messages/directory?q=${encodeURIComponent(q)}`)
      .then(setResults)
      .catch(() => {})
      .finally(() => setSearching(false))
  }

  const startPeerThread = async (business) => {
    try {
      const thread = await api.post('/messages/threads', {
        recipient_account_id: business.id,
        subject: `Conversation with ${business.name}`,
        body: 'Hello! I would like to connect.'
      })
      setSearchParams({ thread: thread.id })
      setShowSearch(false)
      loadThreads()
    } catch (e) {
      setError(e.message)
    }
  }

  const startSupportThread = async () => {
    try {
      const thread = await api.post('/messages/threads', {
        subject: 'Support Request',
        body: 'I need help with...'
      })
      setSearchParams({ thread: thread.id })
      loadThreads()
    } catch (e) {
      setError(e.message)
    }
  }

  if (loading) return <PageLoader label={t('common.loading')} />

  return (
    <div className="page" style={{ height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <h1>{t('nav.messages')}</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" onClick={() => setShowSearch(true)}>Search Businesses</button>
          <button className="btn btn-primary" onClick={startSupportThread}>Contact Support</button>
        </div>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flex: 1, gap: 20, minHeight: 0, overflow: 'hidden' }}>
        {/* Threads List */}
        <div className={`card ${activeThreadId ? 'hide-on-mobile' : ''}`} style={{ width: 320, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
            <strong>Conversations</strong>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {threads.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)' }}>
                No messages yet.
              </div>
            ) : threads.map(t => (
              <div
                key={t.id}
                onClick={() => setSearchParams({ thread: t.id })}
                style={{
                  padding: '12px 16px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  background: activeThreadId == t.id ? 'var(--accent-soft, #f3e1d6)' : (t.unread ? 'var(--surface-sunken)' : 'transparent'),
                  position: 'relative'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: t.unread ? 700 : 600, fontSize: 14 }}>{t.partner_name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                    {new Date(t.last_message_at).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.last_message_preview}
                </div>
                {t.unread && (
                  <div style={{ position: 'absolute', right: 16, bottom: 12, width: 8, height: 8, borderRadius: 4, background: 'var(--accent)' }} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Conversation View */}
        <div className={`card ${!activeThreadId ? 'hide-on-mobile' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {activeThread ? (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="btn-icon show-on-mobile" onClick={() => setSearchParams({})}>←</button>
                <div>
                  <div style={{ fontWeight: 700 }}>{activeThread.partner_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{activeThread.subject}</div>
                </div>
              </div>
              <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeThread.messages.map(m => (
                  <MessageBubble key={m.id} message={m} currentAccountUserId={user.id} currentAccountId={user.account_id} />
                ))}
              </div>
              <form onSubmit={sendReply} style={{ padding: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
                <input
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  placeholder="Type a message..."
                  style={{ flex: 1, margin: 0 }}
                  autoFocus
                />
                <button className="btn btn-primary" disabled={!reply.trim() || sending}>
                  {sending ? '...' : 'Send'}
                </button>
              </form>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>
              Select a conversation to start chatting.
            </div>
          )}
        </div>
      </div>

      {showSearch && (
        <div className="modal-overlay" onClick={() => setShowSearch(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h2>Find Business</h2>
            <p className="sub">Connect with other tenants on Moneytracer to share documents.</p>
            <SearchBar value={query} onChange={searchBusinesses} placeholder="Search by company name or email..." autoFocus />
            <div style={{ marginTop: 20, maxHeight: 300, overflowY: 'auto' }}>
              {searching ? <div>Searching...</div> : (
                results.length === 0 && query.length >= 3 ? <div>No results found.</div> :
                results.map(b => (
                  <div
                    key={b.id}
                    onClick={() => startPeerThread(b)}
                    style={{ padding: '12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    className="hover-bg"
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <strong>{b.name}</strong>
                      {b.match_type === 'user' && (
                        <span className="badge badge-outline" style={{ fontSize: 10 }}>User match</span>
                      )}
                    </div>
                    {b.match_type === 'user' && (
                      <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{b.matched_value}</div>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.email}</div>
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-outline" onClick={() => setShowSearch(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MessageBubble({ message, currentAccountId }) {
  const isDoc = !!message.attachment_type
  const fromMe = !message.is_from_superadmin && (message.sender_account_id === currentAccountId);

  return (
    <div style={{
      maxWidth: '80%',
      padding: '10px 14px',
      borderRadius: 16,
      alignSelf: fromMe ? 'flex-end' : 'flex-start',
      background: fromMe ? 'var(--accent)' : (message.is_from_superadmin ? '#eee' : 'var(--surface-sunken)'),
      color: fromMe ? '#fff' : '#333',
      marginBottom: 4,
      border: fromMe ? 'none' : '1px solid var(--border)'
    }}>
      <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2 }}>
        {message.sender_username} • {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div>{message.body}</div>
      {isDoc && (
        <div style={{
          marginTop: 8,
          padding: 8,
          background: 'rgba(0,0,0,0.1)',
          borderRadius: 8,
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer'
        }} onClick={() => window.open(`/app/verify/${message.attachment_type}/${message.attachment_id}`, '_blank')}>
          <span>📄</span>
          <strong>{message.attachment_type.toUpperCase()} #{message.attachment_id}</strong>
          <span style={{ fontSize: 10 }}>View →</span>
        </div>
      )}
    </div>
  )
}
