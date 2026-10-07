import { useEffect } from 'react'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

/**
 * Full-screen creditor editor. Mirrors InvoiceEditor (quotations/invoices):
 * form on the left, live-updating preview sheet on the right, so the user
 * sees the supplier record take shape as they fill it in. Reuses the same
 * .invoice-editor-* / .doc-sheet-* styles.
 */
export default function CreditorEditor({
  editingId, form, setForm, company, error, saving,
  updateLine, addLine, removeLine, moveLine,
  inventoryItems = [], selectInventoryItem,
  amountPaid = 0, onClose, onSave,
}) {
  const { setDirty, setDirtyMessage, setOnSaveDraft } = useNavigationGuard()

  useEffect(() => {
    const hasData = form.name.trim() !== '' || form.items.some((l) => l.description.trim() !== '')
    if (hasData) {
      setDirtyMessage('You have an unsaved creditor in progress. Leaving this page will discard your changes.')
      setDirty(true)
    } else {
      setDirty(false)
    }
    setOnSaveDraft(null)
    return () => { setDirty(false); setOnSaveDraft(null) }
  }, [form, setDirty, setDirtyMessage, setOnSaveDraft])

  const itemsWithText = form.items.filter((l) => l.description.trim())
  const lineTotal = (l) => (Number(l.quantity) || 0) * (Number(l.unit_price) || 0)
  const itemsTotal = itemsWithText.reduce((s, l) => s + lineTotal(l), 0)
  const owed = Number(form.total_owed) || 0
  const balance = owed - (Number(amountPaid) || 0)
  const mismatch = itemsWithText.length > 0 && Math.abs(itemsTotal - owed) >= 0.5

  return (
    <div className="invoice-editor-overlay">
      <div className="invoice-editor">
        <div className="invoice-editor-topbar">
          <div>
            <div className="doc-sheet-muted">{editingId ? 'Edit Creditor' : 'New Creditor'}</div>
            <h2 style={{ margin: 0 }}>{form.name || 'New supplier'}</h2>
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
            <div className="form-row"><label>Supplier Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Supplier or company name" /></div>
            <div className="form-row"><label>Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. +255 7XX XXX XXX" /></div>
            <div className="form-row"><label>TIN</label>
              <input value={form.tin_number} onChange={(e) => setForm({ ...form, tin_number: e.target.value })}
                placeholder="Optional — used to reconcile with debtor records" /></div>
            <div className="form-row"><label>Total Owed (TZS)</label>
              <input type="number" value={form.total_owed} onChange={(e) => setForm({ ...form, total_owed: Number(e.target.value) })} /></div>
            <div className="form-row"><label>Note</label>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional note" /></div>
            {editingId && form.created_at && (
              <div className="form-row"><label>Date Added</label>
                <input value={new Date(form.created_at).toLocaleString()} disabled /></div>
            )}

            <div className="invoice-editor-section-label">Items (optional — what was bought on credit from this supplier)</div>
            {form.items.map((line, idx) => {
              const isCustom = !line.item_id
              return (
                <div key={idx} className="invoice-editor-line">
                  <div className="invoice-line-reorder">
                    <button type="button" className="invoice-line-reorder-btn" onClick={() => moveLine(idx, -1)}
                      disabled={idx === 0} aria-label="Move item up" title="Move up">▲</button>
                    <button type="button" className="invoice-line-reorder-btn" onClick={() => moveLine(idx, 1)}
                      disabled={idx === form.items.length - 1} aria-label="Move item down" title="Move down">▼</button>
                  </div>
                  <div className="invoice-line-item-picker">
                    <span className="invoice-line-field-label">Item / Description</span>
                    <div className="invoice-line-item-row">
                      <select className="invoice-line-item-select" value={line.item_id ?? ''}
                        onChange={(e) => selectInventoryItem(idx, e.target.value)}>
                        <option value="">— Custom item —</option>
                        {inventoryItems.map((it) => (
                          <option key={it.id} value={it.id}>{it.name} ({it.quantity} in stock)</option>
                        ))}
                      </select>
                      {isCustom && (
                        <input placeholder="Describe the item" value={line.description}
                          onChange={(e) => updateLine(idx, 'description', e.target.value)} />
                      )}
                    </div>
                  </div>
                  <label className="invoice-line-field invoice-line-qty">
                    <span className="invoice-line-field-label">Qty</span>
                    <input type="number" inputMode="decimal" placeholder="Qty" value={line.quantity}
                      onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))} />
                  </label>
                  <label className="invoice-line-field invoice-line-price">
                    <span className="invoice-line-field-label">Unit Price</span>
                    <input type="number" inputMode="decimal" placeholder="Unit Price" value={line.unit_price}
                      onChange={(e) => updateLine(idx, 'unit_price', Number(e.target.value))} />
                  </label>
                  <div className="invoice-line-total">
                    <span className="invoice-line-field-label">Total</span>
                    <span className="invoice-editor-line-total">{money(lineTotal(line))}</span>
                  </div>
                  <button type="button" className="btn btn-danger invoice-line-remove" onClick={() => removeLine(idx)} aria-label="Remove line">✕</button>
                </div>
              )
            })}
            <button type="button" className="btn btn-outline" onClick={addLine} style={{ marginBottom: 20, marginTop: 8 }}>+ Add Line</button>

            {itemsWithText.length > 0 && (
              <div className="invoice-editor-checkline">
                <div className={`invoice-editor-check-result ${mismatch ? 'mismatch' : 'match'}`}>
                  {mismatch ? (
                    <>⚠️ Items add up to {money(itemsTotal)}, but Total Owed is {money(owed)}
                      <button type="button" className="btn btn-outline" style={{ display: 'block', marginTop: 8 }}
                        onClick={() => setForm({ ...form, total_owed: itemsTotal })}>
                        Set Total Owed to {money(itemsTotal)}
                      </button></>
                  ) : (<>✅ Items match Total Owed ({money(owed)})</>)}
                </div>
              </div>
            )}
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
                  <div className="doc-sheet-title">Creditor Statement</div>
                  <div className="doc-sheet-muted">{editingId ? '(editing)' : 'New record'}</div>
                </div>
              </div>

              <div className="doc-sheet-meta">
                <div>
                  <div className="doc-sheet-label">Supplier</div>
                  <div style={{ fontWeight: 600 }}>{form.name || '—'}</div>
                  {form.phone && <div className="doc-sheet-muted">{form.phone}</div>}
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
                    <th>#</th><th>Description</th>
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
                      <td style={{ textAlign: 'right' }}>{money(lineTotal(line))}</td>
                    </tr>
                  ))}
                  {itemsWithText.length === 0 && (
                    <tr><td colSpan={5} className="doc-sheet-muted" style={{ padding: '14px 10px' }}>Add a line item to see it here.</td></tr>
                  )}
                </tbody>
              </table>

              <div className="doc-sheet-totals">
                {itemsWithText.length > 0 && <div><span>Items Total</span><span>{money(itemsTotal)}</span></div>}
                <div><span>Total Owed</span><span>{money(owed)}</span></div>
                {amountPaid > 0 && <div><span>Paid</span><span>-{money(amountPaid)}</span></div>}
                <div className="doc-sheet-total-row"><span>Balance</span><span>{money(balance)}</span></div>
              </div>

              {form.note && (
                <div style={{ marginTop: 18 }}>
                  <div className="doc-sheet-label">Note</div>
                  <div className="doc-sheet-muted">{form.note}</div>
                </div>
              )}
            </div>
          </div>

          <div className="invoice-editor-preview-mobile">
            <div className="mobile-summary-row">
              <div>
                <div className="doc-sheet-label">Creditor</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{form.name || 'New supplier'}</div>
              </div>
              <div className="mobile-summary-total">
                <div className="doc-sheet-label">Balance</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{money(balance)}</div>
              </div>
            </div>
            {itemsWithText.length > 0 ? (
              <div className="mobile-summary-items">
                {itemsWithText.map((line, i) => (
                  <div key={i} className="mobile-summary-item">
                    <div className="mobile-summary-item-desc">{line.description}</div>
                    <div className="mobile-summary-item-meta">
                      {line.quantity} × {money(line.unit_price)}
                      <span className="mobile-summary-item-amount">{money(lineTotal(line))}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="doc-sheet-muted" style={{ padding: '10px 0' }}>Add a line item to see it here.</div>
            )}
            <div className="mobile-summary-totals">
              <div><span>Total Owed</span><span>{money(owed)}</span></div>
              {amountPaid > 0 && <div><span>Paid</span><span>-{money(amountPaid)}</span></div>}
              <div className="mobile-summary-total-row"><span>Balance</span><span>{money(balance)}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
