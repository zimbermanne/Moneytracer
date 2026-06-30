import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'

const emptyLine = () => ({ description: '', quantity: 1, unit_price: 0 })
const emptyForm = () => ({
  customer_name: 'Walk-in',
  customer_phone: '',
  customer_address: '',
  tax_rate: 0,
  discount: 0,
  notes: '',
  valid_days: 14,
  items: [emptyLine()],
})

export default function Documents({ kind }) {
  // kind: 'invoices' | 'quotations'
  const api = useApi()
  const isInvoice = kind === 'invoices'
  const title = isInvoice ? 'Invoices' : 'Quotations / Proforma'
  const numberKey = isInvoice ? 'invoice_no' : 'quote_no'

  const [docs, setDocs] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm())

  const load = () => {
    api.get(`/${kind}/`).then(setDocs).catch((e) => setError(e.message))
  }

  useEffect(() => { load() }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateLine = (idx, field, value) => {
    const items = form.items.map((line, i) => (i === idx ? { ...line, [field]: value } : line))
    setForm({ ...form, items })
  }

  const addLine = () => setForm({ ...form, items: [...form.items, emptyLine()] })
  const removeLine = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })

  const save = async () => {
    try {
      const payload = { ...form, items: form.items.filter((l) => l.description.trim()) }
      if (!payload.items.length) {
        setError('Add at least one line item')
        return
      }
      await api.post(`/${kind}/`, payload)
      setOpen(false)
      setForm(emptyForm())
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (id) => {
    if (!confirm(`Delete this ${isInvoice ? 'invoice' : 'quotation'}?`)) return
    try {
      await api.del(`/${kind}/${id}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const convert = async (id) => {
    try {
      await api.post(`/quotations/${id}/convert`, {})
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const columns = [
    { key: 'no', header: 'No.', render: (r) => r[numberKey] },
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'customer_name', header: 'Customer' },
    { key: 'total', header: 'Total', render: (r) => `TZS ${r.total.toLocaleString()}` },
    { key: 'status', header: 'Status', render: (r) => <span className={`badge badge-${r.status}`}>{r.status}</span> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8 }}>
          {!isInvoice && r.status !== 'accepted' && r.status !== 'rejected' && (
            <button className="btn btn-outline" onClick={() => convert(r.id)}>Convert to Invoice</button>
          )}
          <button className="btn btn-danger" onClick={() => remove(r.id)}>Delete</button>
        </div>
      ),
    },
  ]

  const subtotal = form.items.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0)
  const taxAmount = subtotal * ((Number(form.tax_rate) || 0) / 100)
  const total = subtotal + taxAmount - (Number(form.discount) || 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1>{title}</h1>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>+ New {isInvoice ? 'Invoice' : 'Quotation'}</button>
      </div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      <Table columns={columns} rows={docs} />

      {open && (
        <Modal
          title={`New ${isInvoice ? 'Invoice' : 'Quotation'}`}
          onClose={() => setOpen(false)}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
          </>)}
        >
          <div className="form-row"><label>Customer Name</label><input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
          <div className="form-row"><label>Phone</label><input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} /></div>
          <div className="form-row"><label>Address</label><input value={form.customer_address} onChange={(e) => setForm({ ...form, customer_address: e.target.value })} /></div>
          {!isInvoice && (
            <div className="form-row"><label>Valid for (days)</label><input type="number" value={form.valid_days} onChange={(e) => setForm({ ...form, valid_days: Number(e.target.value) })} /></div>
          )}

          <div className="form-row"><label>Items</label></div>
          {form.items.map((line, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input
                placeholder="Description"
                value={line.description}
                onChange={(e) => updateLine(idx, 'description', e.target.value)}
                style={{ flex: 2 }}
              />
              <input
                type="number"
                placeholder="Qty"
                value={line.quantity}
                onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))}
                style={{ width: 70 }}
              />
              <input
                type="number"
                placeholder="Unit Price"
                value={line.unit_price}
                onChange={(e) => updateLine(idx, 'unit_price', Number(e.target.value))}
                style={{ width: 100 }}
              />
              <button type="button" className="btn btn-danger" onClick={() => removeLine(idx)}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-outline" onClick={addLine} style={{ marginBottom: 16 }}>+ Add Line</button>

          <div className="form-row"><label>Tax Rate (%)</label><input type="number" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} /></div>
          <div className="form-row"><label>Discount (TZS)</label><input type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })} /></div>
          <div className="form-row"><label>Notes</label><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>

          <div style={{ textAlign: 'right', fontWeight: 700, marginTop: 8 }}>
            Total: TZS {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </Modal>
      )}
    </div>
  )
}
