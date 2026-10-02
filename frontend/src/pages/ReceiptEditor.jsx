import { useMemo, useState } from 'react'
import Modal from './Modal.jsx'
import { useApi } from '../hooks/useApi.js'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

/**
 * Edit a finished receipt: client name, and each line's quantity / unit price,
 * or remove a line. Saves through PUT /api/sales/receipt/{receipt_no}, which
 * keeps stock, the linked debt (credit sales) and the ledger in step -- the
 * original journal entries are reversed and new ones posted, never edited in
 * place -- so this component only has to collect the changes.
 *
 * receipt: { receipt_no, customer_name, is_credit, created_at, total,
 *            lines: [{ sale_id, item_name, quantity, unit_price }] }
 * customerNames: optional list for the client-name suggestions.
 * onSaved(result): called with the server response after a successful save.
 */
export default function ReceiptEditor({ receipt, customerNames = [], onClose, onSaved }) {
  const api = useApi()
  const [name, setName] = useState(receipt.customer_name || '')
  const [phone, setPhone] = useState('')
  const [lines, setLines] = useState(() =>
    receipt.lines.map((l) => ({
      sale_id: l.sale_id,
      item_name: l.item_name,
      origQty: l.quantity,
      origPrice: l.unit_price,
      quantity: String(l.quantity),
      unit_price: String(l.unit_price),
      remove: false,
    }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setLine = (id, patch) => setLines((prev) => prev.map((l) => (l.sale_id === id ? { ...l, ...patch } : l)))

  const kept = lines.filter((l) => !l.remove)
  const newTotal = useMemo(
    () => kept.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
    [lines] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const diff = newTotal - receipt.total

  const moneyChanged = lines.some(
    (l) => l.remove || Number(l.quantity) !== l.origQty || Number(l.unit_price) !== l.origPrice
  )
  const nameChanged = name.trim() !== (receipt.customer_name || '').trim()
  const dirty = moneyChanged || nameChanged

  const validate = () => {
    if (kept.length === 0) return 'A receipt needs at least one line. To cancel the whole sale, delete it from the Sales page.'
    for (const l of kept) {
      if (!(Number(l.quantity) > 0)) return `Quantity for ${l.item_name} must be greater than zero.`
      if (!(Number(l.unit_price) > 0)) return `Price for ${l.item_name} must be greater than zero.`
    }
    return ''
  }

  const save = async () => {
    const problem = validate()
    if (problem) { setError(problem); return }
    setSaving(true)
    setError('')
    try {
      const body = {
        customer_name: name.trim() || 'Walk-in',
        lines: lines.map((l) => ({
          sale_id: l.sale_id,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          remove: l.remove,
        })),
      }
      if (receipt.is_credit && phone.trim()) body.customer_phone = phone.trim()
      const res = await api.put(`/sales/receipt/${encodeURIComponent(receipt.receipt_no)}`, body)
      onSaved(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const listId = `receipt-edit-names-${receipt.receipt_no}`

  return (
    <Modal
      title={`Edit receipt ${receipt.receipt_no}`}
      onClose={onClose}
      isDirty={dirty}
      wide={true}
      footer={<>
        <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-gold" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </>}
    >
      <div className="form-row">
        <label>Client name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} list={listId} autoComplete="off" />
        <datalist id={listId}>
          {customerNames.map((n) => <option key={n} value={n} />)}
        </datalist>
        {nameChanged && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            This receipt will move to “{name.trim() || 'Walk-in'}”.
          </div>
        )}
      </div>

      {receipt.is_credit && (
        <div className="form-row">
          <label>Client phone (credit sale)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Leave blank to keep as is" />
        </div>
      )}

      <div className="responsive-table" style={{ overflowX: 'auto', margin: '12px 0' }}>
        <table className="pl-table">
          <thead>
            <tr>
              <th>Item</th>
              <th style={{ width: 90 }}>Qty</th>
              <th style={{ width: 130 }}>Unit price</th>
              <th style={{ width: 120, textAlign: 'right' }}>Line total</th>
              <th style={{ width: 70 }}>Remove</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const lineTotal = l.remove ? 0 : (Number(l.quantity) || 0) * (Number(l.unit_price) || 0)
              const changed = !l.remove && (Number(l.quantity) !== l.origQty || Number(l.unit_price) !== l.origPrice)
              return (
                <tr key={l.sale_id} style={l.remove ? { opacity: 0.45, textDecoration: 'line-through' } : changed ? { background: 'var(--surface-sunken)' } : undefined}>
                  <td data-label="Item">{l.item_name}</td>
                  <td data-label="Qty">
                    <input type="number" min="0" step="any" value={l.quantity} disabled={l.remove}
                      onChange={(e) => setLine(l.sale_id, { quantity: e.target.value })} style={{ width: '100%' }} />
                  </td>
                  <td data-label="Unit price">
                    <input type="number" min="0" step="any" value={l.unit_price} disabled={l.remove}
                      onChange={(e) => setLine(l.sale_id, { unit_price: e.target.value })} style={{ width: '100%' }} />
                  </td>
                  <td data-label="Line total" style={{ textAlign: 'right', fontWeight: 600 }}>{money(lineTotal)}</td>
                  <td data-label="Remove" style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={l.remove} onChange={(e) => setLine(l.sale_id, { remove: e.target.checked })} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontWeight: 700, fontSize: 16 }}>
        <span>New total</span>
        <span>
          {money(newTotal)}
          {moneyChanged && diff !== 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 8, color: diff > 0 ? 'var(--success)' : 'var(--danger)' }}>
              {diff > 0 ? '+' : '−'}{money(Math.abs(diff))}
            </span>
          )}
        </span>
      </div>

      {moneyChanged && (
        <div style={{
          padding: 10, marginTop: 14, background: 'rgba(193, 95, 60, 0.08)', borderLeft: '3px solid var(--accent)',
          borderRadius: 4, fontSize: 12, lineHeight: 1.5,
        }}>
          Changing prices or quantities also updates <strong>stock</strong>
          {receipt.is_credit ? <>, the customer’s <strong>debt</strong></> : null} and the <strong>ledger</strong>
          {' '}(the original entries are reversed and fresh ones posted, so the audit trail stays intact).
          Receipts in a closed fiscal period can only have their client name changed.
        </div>
      )}

      {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  )
}
