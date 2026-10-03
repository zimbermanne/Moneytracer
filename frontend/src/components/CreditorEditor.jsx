import { useEffect, useState } from 'react'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

/**
 * Full-screen creditor editor (resembling the Invoice/Quotation process).
 * Renders the form on the left and a live-updating preview of the creditor
 * record/statement sheet on the right, so the user can see exactly what
 * is being recorded in real-time as they fill it in.
 */
export default function CreditorEditor({
  editingId,
  form,
  setForm,
  company,
  error,
  updateLine,
  addLine,
  removeLine,
  moveLine,
  itemsTotal,
  lockTotal,
  setLockTotal,
  onClose,
  onSave,
  saving,
  inventoryItems = [],
  selectInventoryItem,
}) {
  const [checkAmount, setCheckAmount] = useState('')
  const { setDirty, setDirtyMessage, setOnSaveDraft } = useNavigationGuard()

  useEffect(() => {
    const hasData = form.name.trim() !== '' || form.items.some((l) => l.description.trim() !== '')
    if (hasData) {
      setDirtyMessage('You have an unsaved creditor record in progress. Leaving this page will discard your changes.')
      setDirty(true)
      setOnSaveDraft(() => () => onSave(true))
    } else {
      setDirty(false)
      setOnSaveDraft(null)
    }
    return () => {
      setDirty(false)
      setOnSaveDraft(null)
    }
  }, [form, onSave, setDirty, setDirtyMessage, setOnSaveDraft])

  const checkValue = checkAmount === '' ? null : Number(checkAmount)
  const checkDiff = checkValue === null ? null : Math.round((checkValue - Number(form.total_owed || 0)) * 100) / 100
  const checkMatches = checkValue !== null && Math.abs(checkDiff) < 0.5
  const itemsWithText = form.items.filter((l) => l.description.trim())

  return (
    <div className="invoice-editor-overlay">
      <div className="invoice-editor">
        <div className="invoice-editor-topbar">
          <div>
            <div className="doc-sheet-muted">{editingId ? 'Edit Creditor' : 'New Creditor Record'}</div>
            <h2 style={{ margin: 0 }}>{form.name || 'New supplier / creditor'}</h2>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save'}
            </button>
          </div>
        </div>

        {error && <div className="error-text" style={{ padding: '0 24px' }}>{error}</div>}

        <div className="invoice-editor-body">
          <div className="invoice-editor-form">
            <div className="form-row">
              <label>Supplier / Creditor Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Client or company name"
              />
            </div>
            <div className="form-row">
              <label>Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="e.g. +255 7XX XXX XXX"
              />
            </div>
            <div className="form-row">
              <label>TIN Number</label>
              <input
                value={form.tin_number}
                onChange={(e) => setForm({ ...form, tin_number: e.target.value })}
                placeholder="Optional — used to reconcile with debtor records"
              />
            </div>

            <div className="form-row">
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Total Amount Owed (TZS) *</span>
                <span
                  style={{
                    fontSize: 11,
                    cursor: 'pointer',
                    color: lockTotal ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: 600,
                  }}
                  onClick={() => setLockTotal(!lockTotal)}
                >
                  {lockTotal ? '🔒 Auto Calculated' : '🔓 Manual Override'}
                </span>
              </label>
              <input
                type="number"
                value={form.total_owed}
                onChange={(e) => {
                  setForm({ ...form, total_owed: Number(e.target.value) })
                  setLockTotal(false)
                }}
                disabled={lockTotal && itemsTotal > 0}
              />
              {lockTotal && itemsTotal > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                  Auto-updated from item lines subtotal ({money(itemsTotal)})
                </div>
              )}
            </div>

            <div className="form-row">
              <label>Note / Reference</label>
              <input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Optional notes or reference regarding this debt"
              />
            </div>

            <div className="invoice-editor-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Line Items (bought on credit)</span>
              {itemsTotal > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>Subtotal: {money(itemsTotal)}</span>}
            </div>

            {form.items.map((line, idx) => {
              const isCustom = !line.item_id
              return (
                <div key={idx} className="invoice-editor-line">
                  <div className="invoice-line-reorder">
                    <button
                      type="button"
                      className="invoice-line-reorder-btn"
                      onClick={() => moveLine(idx, -1)}
                      disabled={idx === 0}
                      aria-label="Move item up"
                      title="Move up"
                    >▲</button>
                    <button
                      type="button"
                      className="invoice-line-reorder-btn"
                      onClick={() => moveLine(idx, 1)}
                      disabled={idx === form.items.length - 1}
                      aria-label="Move item down"
                      title="Move down"
                    >▼</button>
                  </div>

                  <div className="invoice-line-item-picker">
                    <select
                      className="invoice-line-item-select"
                      value={line.item_id ?? ''}
                      onChange={(e) => selectInventoryItem(idx, e.target.value)}
                    >
                      <option value="">— Custom item (not in inventory) —</option>
                      {inventoryItems.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({it.quantity} in stock)
                        </option>
                      ))}
                    </select>
                    {isCustom ? (
                      <input
                        placeholder="Describe the item"
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      />
                    ) : (
                      <input
                        placeholder="Additional notes on item (optional)"
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      />
                    )}
                  </div>

                  <input
                    type="number"
                    placeholder="Qty"
                    value={line.quantity}
                    onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))}
                  />
                  <input
                    type="number"
                    placeholder="Unit Price"
                    value={line.unit_price}
                    onChange={(e) => updateLine(idx, 'unit_price', Number(e.target.value))}
                  />
                  <span className="invoice-editor-line-total">
                    {money((Number(line.quantity) || 0) * (Number(line.unit_price) || 0))}
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => removeLine(idx)}
                    aria-label="Remove line"
                  >✕</button>
                </div>
              )
            })}

            <button type="button" className="btn btn-outline" onClick={addLine} style={{ marginBottom: 20, marginTop: 8 }}>
              + Add Line
            </button>

            <div className="invoice-editor-checkline">
              <div>
                <label>Total Amount Cross-Check</label>
                <div className="doc-sheet-muted" style={{ marginBottom: 6 }}>
                  Enter the expected amount owed to cross-check against computed total.
                </div>
                <input
                  type="number"
                  placeholder={`e.g. ${Math.round(form.total_owed)}`}
                  value={checkAmount}
                  onChange={(e) => setCheckAmount(e.target.value)}
                />
              </div>
              {checkValue !== null && (
                <div className={`invoice-editor-check-result ${checkMatches ? 'match' : 'mismatch'}`}>
                  {checkMatches ? (
                    <>✅ Matches total owed ({money(form.total_owed)})</>
                  ) : (
                    <>
                      ⚠️ {checkDiff > 0 ? 'Over' : 'Under'} total owed by {money(Math.abs(checkDiff))}
                      <span className="doc-sheet-muted" style={{ display: 'block', marginTop: 2 }}>
                        Current total owed is {money(form.total_owed)}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="invoice-editor-preview">
            <div className="invoice-editor-preview-label">Live Preview</div>
            <div className="doc-sheet doc-sheet-live">
              <div className="doc-sheet-head">
                <div>
                  <div className="doc-sheet-company">{company?.name || 'Your Company'}</div>
                  {company?.address && <div className="doc-sheet-muted">{company.address}</div>}
                  {company?.email && <div className="doc-sheet-muted">{company.email}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="doc-sheet-title">Creditor Record</div>
                  <div className="doc-sheet-muted">{editingId ? '(editing)' : 'Credit Purchase Statement'}</div>
                </div>
              </div>

              <div className="doc-sheet-meta">
                <div>
                  <div className="doc-sheet-label">Supplier / Creditor</div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{form.name || '—'}</div>
                  {form.phone && <div className="doc-sheet-muted">Phone: {form.phone}</div>}
                  {form.tin_number && <div className="doc-sheet-muted">TIN: {form.tin_number}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="doc-sheet-label">Date</div>
                  <div>{new Date(form.created_at || Date.now()).toLocaleDateString()}</div>
                </div>
              </div>

              <table className="doc-sheet-items">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Description</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Rate</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsWithText.map((line, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{line.description}</td>
                      <td style={{ textAlign: 'right' }}>{line.quantity}</td>
                      <td style={{ textAlign: 'right' }}>{money(line.unit_price)}</td>
                      <td style={{ textAlign: 'right' }}>{money((Number(line.quantity) || 0) * (Number(line.unit_price) || 0))}</td>
                    </tr>
                  ))}
                  {itemsWithText.length === 0 && (
                    <tr>
                      <td colSpan={5} className="doc-sheet-muted" style={{ padding: '14px 10px', textAlign: 'center' }}>
                        Add a line item to see it on the live preview sheet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="doc-sheet-totals">
                <div><span>Items Subtotal</span><span>{money(itemsTotal)}</span></div>
                <div className="doc-sheet-total-row"><span>Total Owed</span><span>{money(form.total_owed)}</span></div>
              </div>

              {form.note && (
                <div style={{ marginTop: 18 }}>
                  <div className="doc-sheet-label">Notes</div>
                  <div className="doc-sheet-muted">{form.note}</div>
                </div>
              )}
            </div>
          </div>

          <div className="invoice-editor-preview-mobile">
            <div className="mobile-summary-row">
              <div>
                <div className="doc-sheet-label">Creditor record for</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{form.name || 'New supplier'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="doc-sheet-label">Total Owed</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent)' }}>{money(form.total_owed)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
