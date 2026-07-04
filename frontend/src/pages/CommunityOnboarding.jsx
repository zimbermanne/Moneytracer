import { useState } from 'react'
import { useAuth } from '../hooks/useAuth.jsx'
import { useApi } from '../hooks/useApi.js'

const GROUP_TYPES = ['Chama', 'VICOBA', 'Vibati', 'Table Banking', 'Merry-go-round', 'Other']

export default function CommunityOnboarding() {
  const { account, refreshAccount } = useAuth()
  const api = useApi()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: account?.name || '',
    group_type: 'Chama',
    region: '',
    district: '',
    contribution_style: 'fixed',
    contribution_amount: '',
    currency: 'TZS',
    cycle_frequency: 'monthly',
    meeting_day: '',
    rotation_enabled: false,
  })

  const set = (field) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((f) => ({ ...f, [field]: val }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Group name is required.'); return }
    if (!form.region.trim() || !form.district.trim()) { setError('Region and district are required.'); return }

    setSaving(true)
    try {
      await api.post('/community/setup', {
        ...form,
        contribution_amount: form.contribution_amount === '' ? null : Number(form.contribution_amount),
      })
      // Setup also marks the account's onboarding as complete server-side.
      await refreshAccount()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  if (!account) return null

  return (
    <div className="wizard-screen">
      <div className="wizard-card">
        <h1 style={{ textAlign: 'center', fontSize: 20, marginBottom: 4 }}>Let's set up your savings group</h1>
        <div className="sub" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
          A few details so contributions, payouts, and loans are tracked correctly.
        </div>

        {error && <div className="error-text" style={{ marginBottom: 14 }}>{error}</div>}

        <form onSubmit={submit}>
          <div className="wizard-row">
            <div className="form-row">
              <label>Group name *</label>
              <input value={form.name} onChange={set('name')} autoFocus />
            </div>
            <div className="form-row">
              <label>Group type</label>
              <select value={form.group_type} onChange={set('group_type')}>
                {GROUP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>Region *</label>
              <input value={form.region} onChange={set('region')} />
            </div>
            <div className="form-row">
              <label>District *</label>
              <input value={form.district} onChange={set('district')} />
            </div>
            <div className="form-row">
              <label>Meeting day</label>
              <input value={form.meeting_day} onChange={set('meeting_day')} placeholder="e.g. Every Sunday" />
            </div>
            <div className="form-row">
              <label>Currency</label>
              <input value={form.currency} onChange={set('currency')} />
            </div>
            <div className="form-row">
              <label>Contribution style</label>
              <select value={form.contribution_style} onChange={set('contribution_style')}>
                <option value="fixed">Fixed — everyone pays the same amount</option>
                <option value="flexible">Flexible — members vary how much they pay</option>
              </select>
            </div>
            <div className="form-row">
              <label>Contribution amount {form.contribution_style === 'flexible' ? '(optional)' : ''}</label>
              <input type="number" min="0" value={form.contribution_amount} onChange={set('contribution_amount')} placeholder="e.g. 10000" />
            </div>
            <div className="form-row">
              <label>Cycle frequency</label>
              <select value={form.cycle_frequency} onChange={set('cycle_frequency')}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every two weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="form-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="rotation" checked={form.rotation_enabled} onChange={set('rotation_enabled')} style={{ width: 'auto' }} />
              <label htmlFor="rotation" style={{ margin: 0 }}>Enable merry-go-round rotation payouts</label>
            </div>
          </div>

          <div className="wizard-actions" style={{ marginTop: 20 }}>
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
              {saving ? 'Setting up…' : 'Create my group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
