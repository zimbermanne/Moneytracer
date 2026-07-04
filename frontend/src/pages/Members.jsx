import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'

const empty = { name: '', phone: '', is_recorder: false }
const emptyLogin = { username: '', password: '' }

export default function Members() {
  const api = useApi()
  const [members, setMembers] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const [loginTarget, setLoginTarget] = useState(null)
  const [loginForm, setLoginForm] = useState(emptyLogin)
  const [listLoading, setListLoading] = useState(true)

  const load = () => {
    setListLoading(true)
    api.get('/community/members').then(setMembers).catch((e) => setError(e.message)).finally(() => setListLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    try {
      await api.post('/community/members', form)
      setOpen(false)
      setForm(empty)
      load()
    } catch (e) { setError(e.message) }
  }

  const createLogin = async () => {
    try {
      await api.post(`/community/members/${loginTarget.id}/login`, loginForm)
      setLoginTarget(null)
      setLoginForm(emptyLogin)
      load()
    } catch (e) { setError(e.message) }
  }

  const removeMember = async (m) => {
    if (!window.confirm(`Remove ${m.name} from the group?`)) return
    try {
      await api.del(`/community/members/${m.id}`)
      load()
    } catch (e) { setError(e.message) }
  }

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'phone', header: 'Phone' },
    { key: 'is_recorder', header: 'Role', render: (r) => r.is_recorder ? <span className="badge badge-partial">Recorder</span> : 'Member' },
    { key: 'has_login', header: 'Login', render: (r) => r.has_login ? <span className="badge badge-paid">Has login</span> : <span className="badge badge-unpaid">No login</span> },
    { key: 'joined_at', header: 'Joined', render: (r) => new Date(r.joined_at).toLocaleDateString() },
    {
      key: 'actions', header: '',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8 }}>
          {!r.has_login && <button className="btn btn-outline" onClick={() => setLoginTarget(r)}>Give login</button>}
          <button className="btn btn-outline" onClick={() => removeMember(r)}>Remove</button>
        </div>
      ),
    },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <h1>Members</h1>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Add Member</button>
      </div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      <Table columns={columns} rows={members} loading={listLoading} loadingText="Loading members…" emptyText="No members added yet." />

      {open && (
        <Modal
          title="Add Member"
          onClose={() => setOpen(false)}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
          </>)}
        >
          <div className="form-row"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="form-row"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="form-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="is_recorder" checked={form.is_recorder} onChange={(e) => setForm({ ...form, is_recorder: e.target.checked })} style={{ width: 'auto' }} />
            <label htmlFor="is_recorder" style={{ margin: 0 }}>Can also record entries (co-recorder)</label>
          </div>
        </Modal>
      )}

      {loginTarget && (
        <Modal
          title={`Give login — ${loginTarget.name}`}
          onClose={() => setLoginTarget(null)}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setLoginTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={createLogin}>Create login</button>
          </>)}
        >
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
            The member will be able to sign in and view their own contributions, payouts, and loans — read-only.
          </div>
          <div className="form-row"><label>Username</label><input value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} /></div>
          <div className="form-row"><label>Password</label><input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  )
}
