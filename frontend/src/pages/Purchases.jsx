import { useEffect, useMemo, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'

const empty = {
  item_name: '', category: 'General', unit: 'pcs', selling_price: '',
  supplier: '', quantity: 1, unit_cost: 0,
}

export default function Purchases() {
  const api = useApi()
  const [purchases, setPurchases] = useState([])
  const [inventory, setInventory] = useState([])
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const [listLoading, setListLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setListLoading(true)
    api.get('/purchases/').then(setPurchases).catch((e) => setError(e.message)).finally(() => setListLoading(false))
    api.get('/purchases/stats/summary').then(setStats).catch(() => {})
  }
  const loadInventory = () => { api.get('/inventory/').then(setInventory).catch(() => {}) }

  useEffect(() => { load(); loadInventory() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Matches the typed name against inventory (case-insensitive) so picking
  // a name from the dropdown restocks that exact item instead of risking a
  // near-duplicate ("Sugar 1kg" vs "sugar 1kg ") being created by accident.
  const matchedItem = useMemo(
    () => inventory.find((i) => i.name.trim().toLowerCase() === form.item_name.trim().toLowerCase()),
    [inventory, form.item_name]
  )
  const isNewItem = form.item_name.trim().length > 0 && !matchedItem
  const total = Number(form.quantity || 0) * Number(form.unit_cost || 0)

  const save = async () => {
    setError('')
    try {
      setSaving(true)
      if (!form.item_name.trim()) throw new Error('Item name is required')
      const payload = matchedItem
        ? {
            item_id: matchedItem.id,
            supplier: form.supplier,
            quantity: Number(form.quantity),
            unit_cost: Number(form.unit_cost),
          }
        : {
            item_name: form.item_name,
            category: form.category || 'General',
            unit: form.unit || 'pcs',
            selling_price: form.selling_price !== '' ? Number(form.selling_price) : undefined,
            supplier: form.supplier,
            quantity: Number(form.quantity),
            unit_cost: Number(form.unit_cost),
          }
      await api.post('/purchases/', payload)
      setOpen(false)
      setForm(empty)
      load()
      loadInventory()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this purchase?')) return
    try {
      await api.del(`/purchases/${id}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const columns = [
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString(), sortable: true },
    { key: 'item_name', header: 'Item', sortable: true },
    { key: 'supplier', header: 'Supplier', sortable: true },
    { key: 'quantity', header: 'Qty', sortable: true },
    { key: 'total', header: 'Total', render: (r) => `TZS ${r.total.toLocaleString()}`, sortable: true },
    { key: 'actions', header: '', render: (r) => <button className="btn btn-danger" onClick={() => remove(r.id)}>Delete</button> },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <h1>Purchases Ledger</h1>
        <button className="btn btn-primary" onClick={() => { setForm(empty); setOpen(true) }}>+ Record Purchase</button>
      </div>
      {error && !open && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      {stats && (
        <div className="card-grid">
          <div className="card metric-card"><div className="label">Total Purchases</div><div className="value">{stats.total_purchases}</div></div>
          <div className="card metric-card"><div className="label">Total Spent</div><div className="value">TZS {stats.total_spent.toLocaleString()}</div></div>
        </div>
      )}
      <Table columns={columns} rows={purchases} loading={listLoading} loadingText="Loading purchases…" />

      {open && (
        <Modal
          title="Record Purchase"
          onClose={() => setOpen(false)}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>)}
        >
          {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}

          <div className="form-row">
            <label>Item Name</label>
            <input
              list="purchase-item-options"
              value={form.item_name}
              placeholder="Type or pick from inventory…"
              onChange={(e) => setForm({ ...form, item_name: e.target.value })}
            />
            <datalist id="purchase-item-options">
              {inventory.map((inv) => <option key={inv.id} value={inv.name} />)}
            </datalist>
            {matchedItem && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Matches existing item — {matchedItem.quantity} {matchedItem.unit} currently in stock. This purchase will restock it.
              </div>
            )}
            {isNewItem && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                No match found — this will create a new inventory item.
              </div>
            )}
          </div>

          {isNewItem && (
            <>
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="form-row" style={{ flex: 1 }}><label>Category</label><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
                <div className="form-row" style={{ flex: 1 }}><label>Unit</label><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
              </div>
              <div className="form-row"><label>Selling Price (optional)</label><input type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} /></div>
            </>
          )}

          <div className="form-row"><label>Supplier</label><input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="form-row" style={{ flex: 1 }}><label>Quantity</label><input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
            <div className="form-row" style={{ flex: 1 }}>
              <label>Unit Cost</label>
              <input type="number" value={form.unit_cost}
                placeholder={matchedItem ? `TZS ${matchedItem.cost_price}` : undefined}
                onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
            </div>
          </div>
          <div style={{ fontWeight: 600, textAlign: 'right' }}>Total: TZS {total.toLocaleString()}</div>
        </Modal>
      )}
    </div>
  )
}
