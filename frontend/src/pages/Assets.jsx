import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import { calculateRevaluation, calculateDepreciation } from '../utils/assetEngine.js'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

const CATEGORY_LABELS = {
  property: 'Property',
  vehicle: 'Vehicle',
  equipment: 'Equipment',
  shares: 'Shares',
  bonds: 'Bonds',
  group_equity: 'Group Equity (SACCOS/VIKOBA)',
  other: 'Other',
}

const TYPE_LABELS = {
  fixed_asset: 'Fixed Asset',
  financial_investment: 'Financial Investment',
  intangible: 'Intangible',
}

const emptyForm = () => ({
  name: '',
  asset_type: 'fixed_asset',
  category: 'other',
  acquisition_cost: '',
  estimated_value: '',
  salvage_value: '0',
  useful_life_years: '5',
  auto_depreciate: false,
  acquired_date: '',
  notes: ''
})

export default function Assets() {
  const { t } = useTranslation()
  const api = useApi()

  const [assets, setAssets] = useState([])
  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  // Revaluation state
  const [revalOpen, setRevalOpen] = useState(false)
  const [revalAsset, setRevalAsset] = useState(null)
  const [revalForm, setRevalForm] = useState({ new_value: '', notes: '' })

  // Schedule/History state
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyAsset, setHistoryAsset] = useState(null)

  // Reconciliation state
  const [recon, setRecon] = useState(null)

  const load = () => {
    setListLoading(true)
    api.get('/assets/').then(setAssets).catch((e) => setError(e.message)).finally(() => setListLoading(false))
    api.get('/assets/reconciliation').then(setRecon).catch(() => {})
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setError(''); setOpen(true) }
  const openEdit = (a) => {
    setEditingId(a.id)
    setForm({
      name: a.name,
      asset_type: a.asset_type,
      category: a.category,
      acquisition_cost: a.acquisition_cost,
      estimated_value: a.estimated_value,
      salvage_value: a.salvage_value,
      useful_life_years: a.useful_life_years,
      auto_depreciate: a.auto_depreciate || false,
      acquired_date: a.acquired_date ? a.acquired_date.slice(0, 10) : '',
      notes: a.notes || '',
    })
    setError('')
    setOpen(true)
  }

  const openRevalue = (a) => {
    setRevalAsset(a)
    setRevalForm({ new_value: a.estimated_value, notes: '' })
    setRevalOpen(true)
  }

  const openHistory = (a) => {
    setHistoryAsset(a)
    setHistoryOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: form.name.trim(),
        asset_type: form.asset_type,
        category: form.category,
        acquisition_cost: Number(form.acquisition_cost) || 0,
        estimated_value: Number(form.estimated_value) || Number(form.acquisition_cost) || 0,
        salvage_value: Number(form.salvage_value) || 0,
        useful_life_years: Number(form.useful_life_years) || 5,
        auto_depreciate: !!form.auto_depreciate,
        acquired_date: form.acquired_date ? new Date(form.acquired_date).toISOString() : null,
        notes: form.notes || '',
      }
      if (editingId) await api.put(`/assets/${editingId}`, payload)
      else await api.post('/assets/', payload)
      setOpen(false); setEditingId(null); setForm(emptyForm()); load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const saveRevaluation = async () => {
    if (!revalForm.new_value) return
    setSaving(true)
    try {
      await api.post(`/assets/${revalAsset.id}/revalue`, {
        new_value: Number(revalForm.new_value),
        notes: revalForm.notes
      })
      setRevalOpen(false)
      load()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (a) => {
    if (!confirm(`Delete "${a.name}"?`)) return
    try {
      await api.del(`/assets/${a.id}`)
      load()
    } catch (e) {
      alert(e.message)
    }
  }

  const totalValue = assets.reduce((s, a) => s + (Number(a.estimated_value) || 0), 0)
  const totalGainLoss = assets.reduce((s, a) => {
    if (a.asset_type === 'financial_investment') {
      return s + (a.estimated_value - a.acquisition_cost)
    }
    return s
  }, 0)

  const columns = [
    { key: 'name', header: 'Name', render: (a) => (
      <div>
        <div style={{ fontWeight: 700 }}>{a.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{TYPE_LABELS[a.asset_type]}</div>
      </div>
    ) },
    { key: 'category', header: 'Category', render: (a) => CATEGORY_LABELS[a.category] || a.category },
    { key: 'estimated_value', header: 'Carrying Value', render: (a) => (
      <div>
        <div style={{ fontWeight: 600 }}>{money(a.estimated_value)}</div>
        {a.asset_type === 'financial_investment' && (
          <div style={{ fontSize: 11, color: a.estimated_value >= a.acquisition_cost ? 'var(--success)' : 'var(--danger)' }}>
            {calculateRevaluation(a.acquisition_cost, a.estimated_value).percentageChange}% total change
          </div>
        )}
      </div>
    ) },
    { key: 'acquired_date', header: 'Acquired', render: (a) => a.acquired_date ? new Date(a.acquired_date).toLocaleDateString() : '—' },
    {
      key: 'actions', header: '', stopRowClick: true,
      render: (a) => (
        <RowActionsMenu items={[
          { label: 'Edit', onClick: () => openEdit(a) },
          { label: 'Revalue', onClick: () => openRevalue(a), hide: a.asset_type !== 'financial_investment' },
          { label: 'History & Schedule', onClick: () => openHistory(a) },
          { label: 'Delete', onClick: () => remove(a), danger: true },
        ]} />
      ),
    },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Assets & Investments</h1>
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Total value: <strong>{money(totalValue)}</strong></div>
            <div style={{ color: totalGainLoss >= 0 ? 'var(--success)' : 'var(--danger)', fontSize: 13 }}>
              Unrealized Gain/Loss: <strong>{money(totalGainLoss)}</strong>
            </div>
          </div>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Asset</button>
      </div>

      {recon && (
        <div className="card-grid" style={{ marginBottom: 20 }}>
          <div className="card" style={{ padding: 16, borderLeft: recon.fixed_assets.diff === 0 ? '4px solid var(--success)' : '4px solid var(--warning)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Fixed Assets (GL 1300)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{money(recon.fixed_assets.ledger)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              Register: {money(recon.fixed_assets.register)}
              {recon.fixed_assets.diff !== 0 && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>⚠️ Diff: {money(recon.fixed_assets.diff)}</span>}
            </div>
          </div>
          <div className="card" style={{ padding: 16, borderLeft: recon.investments.diff === 0 ? '4px solid var(--success)' : '4px solid var(--warning)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Investments (GL 1400)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{money(recon.investments.ledger)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              Register: {money(recon.investments.register)}
              {recon.investments.diff !== 0 && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>⚠️ Diff: {money(recon.investments.diff)}</span>}
            </div>
          </div>
        </div>
      )}

      <Table columns={columns} rows={assets} loading={listLoading} emptyText="No assets recorded yet." onRowClick={openEdit} />

      {open && (
        <Modal
          title={editingId ? 'Edit Asset' : 'Add Asset'}
          onClose={() => setOpen(false)}
          wide={true}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save'}
              </button>
            </>
          }
        >
          {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Family House, Toyota Hilux" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label>Asset Type</label>
              <select value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })}>
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label>Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label>Acquisition Cost</label>
              <input type="number" value={form.acquisition_cost} onChange={(e) => setForm({ ...form, acquisition_cost: e.target.value })} />
            </div>
            <div>
              <label>Current Value</label>
              <input type="number" value={form.estimated_value} onChange={(e) => setForm({ ...form, estimated_value: e.target.value })} placeholder="Defaults to cost" />
            </div>
          </div>

          {form.asset_type === 'fixed_asset' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '12px', background: 'rgba(0,0,0,0.03)', borderRadius: '8px', margin: '8px 0' }}>
              <div>
                <label>Useful Life (Years)</label>
                <input type="number" value={form.useful_life_years} onChange={(e) => setForm({ ...form, useful_life_years: e.target.value })} />
              </div>
              <div>
                <label>Salvage Value</label>
                <input type="number" value={form.salvage_value} onChange={(e) => setForm({ ...form, salvage_value: e.target.value })} />
              </div>
              <div style={{ gridColumn: 'span 2', fontSize: 11, color: 'var(--text-muted)' }}>
                Monthly Depreciation: {money(calculateDepreciation(form.acquisition_cost, form.salvage_value, form.useful_life_years).monthlyDepreciation)}
              </div>
              <label style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={form.auto_depreciate}
                  onChange={(e) => setForm({ ...form, auto_depreciate: e.target.checked })}
                  style={{ width: 16, height: 16 }}
                />
                Auto-depreciate monthly (straight-line) — posts to the ledger automatically on the 1st of each month
              </label>
            </div>
          )}

          <label>Acquired Date</label>
          <input type="date" value={form.acquired_date} onChange={(e) => setForm({ ...form, acquired_date: e.target.value })} />
          <label>Notes</label>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Modal>
      )}

      {revalOpen && (
        <Modal
          title={`Revalue ${revalAsset?.name}`}
          onClose={() => setRevalOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setRevalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRevaluation} disabled={saving}>
                {saving ? 'Updating…' : 'Update Market Price'}
              </button>
            </>
          }
        >
          <div style={{ marginBottom: 16, padding: 12, background: 'var(--success-bg)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Original Cost</div>
            <div style={{ fontWeight: 600 }}>{money(revalAsset?.acquisition_cost)}</div>
          </div>

          <label>New Market Value (Current Price)</label>
          <input
            type="number"
            autoFocus
            value={revalForm.new_value}
            onChange={(e) => setRevalForm({ ...revalForm, new_value: e.target.value })}
          />

          <div style={{ marginTop: 8, fontSize: 13 }}>
            Estimated {Number(revalForm.new_value) >= revalAsset?.estimated_value ? 'Gain' : 'Loss'}:
            <strong style={{ marginLeft: 6, color: Number(revalForm.new_value) >= revalAsset?.estimated_value ? 'var(--success)' : 'var(--danger)' }}>
              {money(Math.abs(Number(revalForm.new_value) - revalAsset?.estimated_value))}
            </strong>
          </div>

          <label style={{ marginTop: 16 }}>Revaluation Notes</label>
          <textarea
            value={revalForm.notes}
            onChange={(e) => setRevalForm({ ...revalForm, notes: e.target.value })}
            placeholder="e.g. Based on quarterly market report"
          />
        </Modal>
      )}

      {historyOpen && (
        <Modal
          title={`${historyAsset?.name} — Details`}
          onClose={() => setHistoryOpen(false)}
          footer={<button className="btn btn-primary" onClick={() => setHistoryOpen(false)}>Close</button>}
          wide
        >
          <div className="card-grid" style={{ marginBottom: 20 }}>
            <div className="card">
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Acquisition Cost</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{money(historyAsset?.acquisition_cost)}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Current Carrying Value</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{money(historyAsset?.estimated_value)}</div>
            </div>
          </div>

          {historyAsset?.asset_type === 'financial_investment' ? (
            <>
              <h3>Revaluation History</h3>
              <Table
                columns={[
                  { key: 'date', header: 'Date', render: (h) => new Date(h.date).toLocaleDateString() },
                  { key: 'previous_value', header: 'Old Value', render: (h) => money(h.previous_value) },
                  { key: 'new_value', header: 'New Value', render: (h) => money(h.new_value) },
                  {
                    key: 'gain', header: 'Gain/Loss',
                    render: (h) => (
                      <span style={{ color: h.gain_loss_amount >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {money(h.gain_loss_amount)}
                      </span>
                    )
                  },
                  { key: 'notes', header: 'Notes' }
                ]}
                rows={historyAsset.revaluation_history || []}
                emptyText="No revaluations recorded yet."
              />
            </>
          ) : (
            <>
              <h3>Depreciation Schedule (Projected)</h3>
              <div style={{ marginBottom: 12, fontSize: 14 }}>
                Straight-line method over <strong>{historyAsset?.useful_life_years} years</strong>
                (Salvage: {money(historyAsset?.salvage_value)})
              </div>
              <Table
                columns={[
                  { key: 'period', header: 'Year' },
                  { key: 'depr', header: 'Annual Depreciation', render: (v) => money(v) },
                  { key: 'accum', header: 'Accumulated', render: (v) => money(v) },
                  { key: 'nbv', header: 'Net Book Value', render: (v) => money(v) }
                ]}
                rows={(() => {
                  const schedule = [];
                  const { annualDepreciation } = calculateDepreciation(
                    historyAsset?.acquisition_cost,
                    historyAsset?.salvage_value,
                    historyAsset?.useful_life_years
                  );
                  let accum = 0;
                  for (let i = 1; i <= (historyAsset?.useful_life_years || 0); i++) {
                    accum += annualDepreciation;
                    schedule.push({
                      period: `Year ${i}`,
                      depr: annualDepreciation,
                      accum: accum,
                      nbv: Math.max(historyAsset?.salvage_value, historyAsset?.acquisition_cost - accum)
                    });
                  }
                  return schedule;
                })()}
              />
            </>
          )}
        </Modal>
      )}
    </div>
  )
}
