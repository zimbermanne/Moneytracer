import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { apiUrl } from '../api-config.js'
import { downloadFile } from '../utils/download.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import SearchBar from '../components/SearchBar.jsx'
import PurchaseOrderPreview from '../components/PurchaseOrderPreview.jsx'
import { useSearch } from '../hooks/useSearch.js'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

const emptyLine = () => ({ description: '', quantity: 1, unit_price: 0, item_id: null })
const emptyForm = () => ({
  supplier_name: '', supplier_phone: '', supplier_email: '', supplier_address: '',
  supplier_tin: '', supplier_vrn: '', expected_date: '',
  tax_rate: 0, discount: 0, notes: '', items: [emptyLine()],
})

export default function PurchaseOrders() {
  const api = useApi()
  const { user } = useAuth()
  const canApprove = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'manager'
  const { setDirty, setDirtyMessage, setOnSaveDraft } = useNavigationGuard()

  const [docs, setDocs] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [pdfLoading, setPdfLoading] = useState(null)
  const [listLoading, setListLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [inventoryItems, setInventoryItems] = useState([])
  const [previewDoc, setPreviewDoc] = useState(null)
  const [company, setCompany] = useState(null)
  const [suppliers, setSuppliers] = useState([])

  useEffect(() => {
    if (open) {
      const hasData = form.supplier_name.trim() !== '' || form.items.some(l => l.description.trim() !== '')
      if (hasData) {
        setDirtyMessage('You have an unsaved purchase order in progress. Leaving this page will discard your changes.')
        setDirty(true)
        setOnSaveDraft(() => () => save(true))
      } else {
        setDirty(false)
        setOnSaveDraft(null)
      }
    } else {
      setDirty(false)
      setOnSaveDraft(null)
    }
    return () => {
      setDirty(false)
      setOnSaveDraft(null)
    }
  }, [open, form, setDirty, setDirtyMessage, setOnSaveDraft])

  const isLocked = (doc) => doc.status === 'received' || doc.status === 'approved'

  const load = () => {
    setListLoading(true)
    api.get('/purchase-orders/').then(setDocs).catch((e) => setError(e.message)).finally(() => setListLoading(false))
  }
  useEffect(() => { load() }, []) // eslint-disable-line
  useEffect(() => { api.get('/inventory/').then(setInventoryItems).catch(() => {}) }, []) // eslint-disable-line
  useEffect(() => { api.get('/accounts/company-info').then(setCompany).catch(() => {}) }, []) // eslint-disable-line
  useEffect(() => { api.get('/suppliers/').then(setSuppliers).catch(() => {}) }, []) // eslint-disable-line

  const selectSupplier = (name) => {
    const match = suppliers.find((s) => s.name === name)
    setForm((f) => ({
      ...f,
      supplier_name: name,
      supplier_phone: match?.phone || f.supplier_phone,
      supplier_email: match?.email || f.supplier_email,
      supplier_address: match?.address || f.supplier_address,
      supplier_tin: match?.tin_number || f.supplier_tin,
      supplier_vrn: match?.vrn_number || f.supplier_vrn,
    }))
  }

  const updateLine = (idx, field, value) => {
    setForm((f) => ({ ...f, items: f.items.map((l, i) => i === idx ? { ...l, [field]: value } : l) }))
  }
  const addLine = () => setForm((f) => ({ ...f, items: [...f.items, emptyLine()] }))
  const removeLine = (idx) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))
  const moveLine = (idx, dir) => {
    const items = [...form.items]
    const target = idx + dir
    if (target < 0 || target >= items.length) return
    const [removed] = items.splice(idx, 1)
    items.splice(target, 0, removed)
    setForm((f) => ({ ...f, items }))
  }

  const selectInventoryItem = (idx, itemId) => {
    if (!itemId) {
      setForm((f) => ({ ...f, items: f.items.map((l, i) => i === idx ? { ...l, item_id: null } : l) }))
      return
    }
    const inv = inventoryItems.find((it) => String(it.id) === String(itemId))
    if (!inv) return
    setForm((f) => ({
      ...f,
      items: f.items.map((l, i) => i === idx
        ? { ...l, item_id: inv.id, description: inv.name, unit_price: inv.cost_price || inv.selling_price || 0 }
        : l),
    }))
  }

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setError(''); setOpen(true) }
  const openEdit = (doc) => {
    setEditingId(doc.id)
    setForm({
      supplier_name: doc.supplier_name || '', supplier_phone: doc.supplier_phone || '',
      supplier_email: doc.supplier_email || '',
      supplier_address: doc.supplier_address || '', supplier_tin: doc.supplier_tin || '',
      supplier_vrn: doc.supplier_vrn || '',
      expected_date: doc.expected_date ? doc.expected_date.slice(0, 10) : '',
      tax_rate: doc.tax_rate, discount: doc.discount, notes: doc.notes || '',
      items: doc.items.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, item_id: l.item_id ?? null })),
    })
    setError('')
    setOpen(true)
  }

  const save = async (isDraft = false) => {
    setError('')
    setSaving(true)
    try {
      const { expected_date, ...rest } = form
      const payload = {
        ...rest,
        items: form.items.filter((l) => l.description.trim()),
        expected_date: expected_date ? new Date(expected_date).toISOString() : null,
        ...(isDraft ? { status: 'draft' } : {}),
      }
      if (!isDraft && !payload.items.length) { setError('Add at least one line item'); setSaving(false); return }
      if (editingId) {
        await api.put(`/purchase-orders/${editingId}`, payload)
      } else {
        await api.post('/purchase-orders/', payload)
      }
      setOpen(false); setEditingId(null); setForm(emptyForm()); load()
      return true
    } catch (e) { setError(e.message); return false }
    finally { setSaving(false) }
  }

  const removePO = async (id) => {
    if (!confirm('Delete this purchase order?')) return
    try { await api.del(`/purchase-orders/${id}`); load() } catch (e) { setError(e.message) }
  }

  const approvePO = async (doc) => {
    if (!confirm(`Approve ${doc.po_no}? This authorizes the purchase but does not add stock yet.`)) return
    try {
      await api.post(`/purchase-orders/${doc.id}/approve`, {})
      load()
    } catch (e) { setError(e.message) }
  }

  const markReceived = async (doc) => {
    if (!confirm(`Mark ${doc.po_no} as received? This adds items to inventory and records the purchase.`)) return
    try {
      await api.patch(`/purchase-orders/${doc.id}/status?status=received`)
      load()
    } catch (e) { setError(e.message) }
  }

  const downloadPdf = (doc) => {
    downloadFile(apiUrl(`/api/purchase-orders/${doc.id}/pdf`), `PurchaseOrder-${doc.po_no}.pdf`)
  }

  const columns = [
    { key: 'no', header: 'No.', render: (r) => <span className="cheque-number">{r.po_no}</span> },
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() },
    { key: 'supplier_name', header: 'Supplier' },
    { key: 'total', header: 'Total', render: (r) => money(r.total) },
    { key: 'status', header: 'Status', render: (r) => <span className={`badge badge-${r.status}`}>{r.status}</span> },
    {
      key: 'actions', header: '',
      stopRowClick: true,
      render: (r) => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
          {isLocked(r) && (
            <span title="Locked" style={{ fontSize: 12, color: 'var(--text-muted)' }}>🔒</span>
          )}
          <RowActionsMenu items={[
            { label: 'View', icon: '👁', onClick: () => setPreviewDoc(r) },
            { label: 'Edit', icon: '✎', onClick: () => openEdit(r), hidden: isLocked(r) },
            { label: 'Approve', icon: '👍', onClick: () => approvePO(r), hidden: !canApprove || (r.status !== 'draft' && r.status !== 'sent') },
            { label: 'Mark as Received', icon: '✓', onClick: () => markReceived(r), hidden: r.status !== 'approved' },
            { label: 'PDF', icon: '⬇', onClick: () => downloadPdf(r) },
            { label: 'Delete', icon: '✕', onClick: () => removePO(r.id), danger: true, hidden: r.status === 'received' },
          ]} />
        </div>
      ),
    },
  ]

  const { query, setQuery, filtered } = useSearch(docs, ['supplier_name', 'po_no'])

  const subtotal = form.items.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0)
  const taxAmt   = subtotal * ((Number(form.tax_rate) || 0) / 100)
  const total    = subtotal + taxAmt - (Number(form.discount) || 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Purchase Orders</h1>
        <button className="btn btn-primary" onClick={openNew}>+ New Purchase Order</button>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', marginBottom: 14 }}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search by supplier or order number…" />
      </div>

      <Table columns={columns} rows={filtered} loading={listLoading} loadingText="Loading..."
        emptyText="No purchase orders found." onRowClick={(row) => setPreviewDoc(row)} />

      {open && (
        <Modal
          title={editingId ? 'Edit Purchase Order' : 'New Purchase Order'}
          onClose={() => setOpen(false)}
          wide={true}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : 'Save Purchase Order'}
            </button>
          </>)}
        >
          <div className="doc-sheet doc-numerals" style={{ boxShadow: 'none', border: 'none', padding: 0 }}>
            {/* Header Mirroring Document Style */}
            <div className="doc-sheet-head" style={{ marginBottom: 24 }}>
              <div>
                <div className="doc-sheet-company">{company?.name || 'Your Company'}</div>
                <div className="doc-sheet-muted">{company?.address || ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="doc-sheet-title">Purchase Order</div>
                <div className="doc-sheet-muted">Date: {new Date().toLocaleDateString()}</div>
              </div>
            </div>

            {/* Supplier & Delivery Grid */}
            <div className="debtor-section-label">Supplier Information</div>
            <div className="debtor-form-grid" style={{ marginBottom: 24 }}>
              <div className="form-row">
                <label>Supplier Name *</label>
                <input value={form.supplier_name} onChange={(e) => selectSupplier(e.target.value)}
                  list="po-supplier-list" placeholder="Pick or type supplier..." />
                <datalist id="po-supplier-list">
                  {suppliers.map((s) => <option key={s.id} value={s.name} />)}
                </datalist>
              </div>
              <div className="form-row">
                <label>Phone</label>
                <input value={form.supplier_phone} onChange={(e) => setForm({ ...form, supplier_phone: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Email</label>
                <input type="email" value={form.supplier_email} onChange={(e) => setForm({ ...form, supplier_email: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Expected Delivery</label>
                <input type="date" value={form.expected_date} onChange={(e) => setForm({ ...form, expected_date: e.target.value })} />
              </div>
              <div className="form-row span-2">
                <label>Address</label>
                <input value={form.supplier_address} onChange={(e) => setForm({ ...form, supplier_address: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Supplier TIN</label>
                <input value={form.supplier_tin} onChange={(e) => setForm({ ...form, supplier_tin: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Supplier VRN</label>
                <input value={form.supplier_vrn} onChange={(e) => setForm({ ...form, supplier_vrn: e.target.value })} />
              </div>
            </div>

            {/* Line Items Section */}
            <div className="debtor-section-label">Order Items</div>
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table className="doc-sheet-items">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Item Description</th>
                    <th style={{ width: 100 }}>Qty</th>
                    <th style={{ width: 140 }}>Unit Cost</th>
                    <th style={{ width: 140, textAlign: 'right' }}>Total</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((line, idx) => (
                    <tr key={idx}>
                      <td style={{ verticalAlign: 'middle' }}>
                        <div className="invoice-line-reorder" style={{ flexDirection: 'row', gap: 2 }}>
                          <button type="button" className="invoice-line-reorder-btn" onClick={() => moveLine(idx, -1)} disabled={idx === 0}>▲</button>
                          <button type="button" className="invoice-line-reorder-btn" onClick={() => moveLine(idx, 1)} disabled={idx === form.items.length - 1}>▼</button>
                        </div>
                      </td>
                      <td>
                        <select
                          className="invoice-line-item-select"
                          style={{ marginBottom: 4 }}
                          value={line.item_id ?? ''}
                          onChange={(e) => selectInventoryItem(idx, e.target.value)}
                        >
                          <option value="">— Custom / new item —</option>
                          {inventoryItems.map((it) => (
                            <option key={it.id} value={it.id}>{it.name} ({it.quantity} in stock)</option>
                          ))}
                        </select>
                        <input
                          placeholder="Description..."
                          value={line.description}
                          onChange={(e) => updateLine(idx, 'description', e.target.value)}
                          style={{ border: 'none', background: 'transparent', padding: '4px 0', fontSize: 13 }}
                        />
                      </td>
                      <td>
                        <input type="number" value={line.quantity} onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))} />
                      </td>
                      <td>
                        <input type="number" value={line.unit_price} onChange={(e) => updateLine(idx, 'unit_price', Number(e.target.value))} />
                      </td>
                      <td style={{ textAlign: 'right', verticalAlign: 'middle', fontWeight: 600 }}>
                        {money((Number(line.quantity) || 0) * (Number(line.unit_price) || 0))}
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        <button className="btn btn-outline btn-sm" style={{ color: 'var(--danger)', borderColor: 'transparent' }} onClick={() => removeLine(idx)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-outline" onClick={addLine} style={{ marginBottom: 24 }}>+ Add Line Item</button>

            {/* Totals & Notes Section */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 40 }}>
              <div className="form-row">
                <label>Notes / Terms</label>
                <textarea
                  placeholder="Special instructions for the supplier..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={4}
                />
              </div>
              <div className="doc-sheet-totals" style={{ marginTop: 0, width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>Subtotal</span>
                  <span>{money(subtotal)}</span>
                </div>
                <div className="form-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <label style={{ margin: 0, flex: 1 }}>Tax Rate (%)</label>
                  <input type="number" style={{ width: 80, margin: 0 }} value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} />
                </div>
                <div className="form-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <label style={{ margin: 0, flex: 1 }}>Discount</label>
                  <input type="number" style={{ width: 100, margin: 0 }} value={form.discount} onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })} />
                </div>
                <div className="doc-sheet-total-row" style={{ borderTop: '2px solid var(--accent)', paddingTop: 12 }}>
                  <span>Total Due</span>
                  <span style={{ color: 'var(--accent)' }}>{money(total)}</span>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {previewDoc && (
        <PurchaseOrderPreview doc={previewDoc} company={company} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  )
}
