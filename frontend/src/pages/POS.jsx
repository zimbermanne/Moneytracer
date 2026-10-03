import { useEffect, useRef, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { apiUrl } from '../api-config.js'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'
import ThermalReceipt from '../components/ThermalReceipt.jsx'
import Modal from '../components/Modal.jsx'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

export default function POS() {
  const api = useApi()
  const { account } = useAuth()
  const [items, setItems] = useState([])
  const [cart, setCart] = useState([]) // [{item_id, name, price, original_price, qty, stock}]
  const [saleMode, setSaleMode] = useState('pos') // 'pos' = locked prices, 'salesman' = editable
  const [paymentMethods, setPaymentMethods] = useState([]) // dynamic, from Settings > Payment Methods
  const [paymentMethodId, setPaymentMethodId] = useState(null)
  const [customerName, setCustomerName] = useState('Walk-in')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerOptions, setCustomerOptions] = useState([]) // previous customers for the dropdown
  const [showCustomerMenu, setShowCustomerMenu] = useState(false)
  const [customerTyped, setCustomerTyped] = useState(false) // only filter once the user actually types
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [showPrintReceipt, setShowPrintReceipt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState([])
  const [showDrafts, setShowDrafts] = useState(false)
  const { setDirty, setDirtyMessage, setOnSaveDraft } = useNavigationGuard()
  const cartRef = useRef(null)

  const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0)

  const saveCartAsDraft = async () => {
    if (cart.length === 0) return true
    try {
      await api.post('/drafts/', {
        customer_name: customerName,
        items: cart,
        total_amount: total
      })
      loadDrafts()
      return true
    } catch (e) {
      alert(`Failed to save draft: ${e.message}`)
      return false
    }
  }

  const resumeDraft = (draft) => {
    if (cart.length > 0 && !confirm('Replace current cart with this draft?')) return
    try {
      const items = JSON.parse(draft.items_json)
      setCart(items)
      setCustomerName(draft.customer_name)
      setShowDrafts(false)
    } catch (e) {
      alert('Failed to load draft items')
    }
  }

  const deleteDraft = async (id) => {
    if (!confirm('Delete this draft?')) return
    try {
      await api.del(`/drafts/${id}`)
      loadDrafts()
    } catch (e) {
      alert(e.message)
    }
  }

  useEffect(() => {
    setOnSaveDraft(() => saveCartAsDraft)
    return () => setOnSaveDraft(null)
  }, [cart, customerName, total]) // eslint-disable-line

  const loadDrafts = () => {
    api.get('/drafts/').then(setDrafts).catch(() => {})
  }

  useEffect(() => {
    api.get('/inventory/').then(setItems).catch((e) => setError(e.message))
    api.get('/ledgers/payment-methods').then((methods) => {
      setPaymentMethods(methods)
      if (methods.length > 0) setPaymentMethodId((prev) => prev ?? methods[0].id)
    }).catch(() => {}) // POS still works with the legacy cash/credit default if this fails
    api.get('/customers/suggestions').then(setCustomerOptions).catch(() => {}) // dropdown is optional; typing still works
    loadDrafts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mark the sale as "in progress" as soon as there's at least one item in
  // the cart, so navigating away (sidebar, back button, refresh, tab close)
  // warns before the cart is silently lost.
  useEffect(() => {
    if (cart.length > 0) {
      setDirtyMessage('You have items in this sale with prices set that haven\u2019t been checked out yet. Leaving this page now will delete the current sale.')
      setDirty(true)
    } else {
      setDirty(false)
    }
    // Clear the guard when this page unmounts (e.g. after navigating away
    // once confirmed) so it doesn't leak into other pages.
    return () => setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart])

  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.item_id === item.id)
      if (existing) {
        if (existing.qty + 1 > item.quantity) return prev
        return prev.map((c) => c.item_id === item.id ? { ...c, qty: c.qty + 1 } : c)
      }
      if (item.quantity < 1) return prev
      return [...prev, { item_id: item.id, name: item.name, price: item.selling_price, original_price: item.selling_price, qty: 1, stock: item.quantity }]
    })
  }

  const updateQty = (item_id, qty) => {
    setCart((prev) => prev.map((c) => c.item_id === item_id ? { ...c, qty: Math.max(1, Math.min(qty, c.stock)) } : c))
  }

  const updatePrice = (item_id, price) => {
    setCart((prev) => prev.map((c) => c.item_id === item_id ? { ...c, price: Math.max(0, price) } : c))
  }

  const switchMode = (newMode) => {
    if (newMode === saleMode) return
    setSaleMode(newMode)
    if (newMode === 'pos') {
      setCart((prev) => prev.map((c) => ({ ...c, price: c.original_price })))
    }
    api.post('/activity/log', {
      action: 'pos_mode_switch',
      details: `Switched to ${newMode === 'salesman' ? 'Salesman (editable prices)' : 'POS (locked prices)'} mode`,
    }).catch(() => {}) // don't block the UI if logging fails
  }

  const removeLine = (item_id) => setCart((prev) => prev.filter((c) => c.item_id !== item_id))

  const selectedPaymentMethod = paymentMethods.find((m) => m.id === paymentMethodId)
  const isCreditSale = selectedPaymentMethod ? selectedPaymentMethod.is_credit : false

  const checkout = async () => {
    if (cart.length === 0) return

    // 1. Audit Guard: Eliminate Zero-Value Sales
    const zeroPriceItems = cart.filter(c => c.price <= 0)
    if (zeroPriceItems.length > 0) {
      setError(`Cannot checkout: ${zeroPriceItems[0].name} has a price of 0. Zero-value sales throw off financial reports. If this is a giveaway, record it as a Promotional Expense in the Expenses module instead.`)
      return
    }

    setBusy(true)
    setError('')
    try {
      const res = await api.post('/sales/checkout', {
        lines: cart.map((c) => ({ item_id: c.item_id, quantity: c.qty, unit_price: c.price })),
        // payment_mode kept for backward compatibility (credit-sale detection
        // on older backends); payment_method_id is what actually decides
        // which Cash/Bank/Mobile-Money account gets debited in the ledger.
        payment_mode: isCreditSale ? 'credit' : 'cash',
        payment_method_id: paymentMethodId,
        customer_name: customerName || 'Walk-in',
        customer_phone: isCreditSale ? customerPhone : '',
        sale_mode: saleMode,
      })
      setReceipt({ ...res, customer_name: customerName || 'Walk-in', payment_mode: selectedPaymentMethod?.name || 'Cash', created_at: new Date().toISOString() })
      setCart([])
      const refreshed = await api.get('/inventory/')
      setItems(refreshed)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const filtered = items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h1>Point of Sale</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {drafts.length > 0 && (
            <button className="btn btn-outline" onClick={() => setShowDrafts(true)}>
              📋 Drafts <span className="badge badge-sent" style={{ marginLeft: 6 }}>{drafts.length}</span>
            </button>
          )}
          <div className="mode-switch">
          <button
            className={saleMode === 'pos' ? 'active' : ''}
            onClick={() => switchMode('pos')}
          >
            🔒 POS (locked prices)
          </button>
          <button
            className={saleMode === 'salesman' ? 'active' : ''}
            onClick={() => switchMode('salesman')}
          >
            ✎ Salesman (editable prices)
          </button>
        </div>
        </div>
      </div>
      {saleMode === 'salesman' && (
        <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 12 }}>
          Salesman mode is on — prices can be changed at checkout and this is recorded in the activity log.
        </div>
      )}

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 2, minWidth: 320 }}>
          <input
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 14 }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {filtered.map((item) => (
              <div
                key={item.id}
                className="card"
                style={{ cursor: item.quantity > 0 ? 'pointer' : 'not-allowed', opacity: item.quantity > 0 ? 1 : 0.5 }}
                onClick={() => item.quantity > 0 && addToCart(item)}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.category}</div>
                <div style={{ marginTop: 8, fontWeight: 700 }}>TZS {item.selling_price.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Stock: {item.quantity}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 280 }} ref={cartRef}>
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Cart</h2>
            {cart.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No items added.</div>}
            {cart.map((c) => (
              <div key={c.item_id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <button className="btn btn-outline" style={{ padding: '2px 8px' }} onClick={() => removeLine(c.item_id)}>✕</button>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Qty</label>
                    <input
                      type="number"
                      min="1"
                      max={c.stock}
                      value={c.qty}
                      onChange={(e) => updateQty(c.item_id, Number(e.target.value))}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Price (each)</label>
                    <input
                      type="number"
                      min="0"
                      value={c.price}
                      disabled={saleMode === 'pos'}
                      onChange={(e) => updatePrice(c.item_id, Number(e.target.value))}
                      style={saleMode === 'pos' ? { background: 'var(--surface-sunken)', color: 'var(--text-muted)', cursor: 'not-allowed' } : undefined}
                    />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
                  Line total: TZS {(c.price * c.qty).toLocaleString()}
                </div>
              </div>
            ))}

            {cart.length > 0 && (
              <>
                <div className="form-row">
                  <label>Customer name</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      value={customerName}
                      autoComplete="off"
                      onFocus={(e) => { setCustomerTyped(false); setShowCustomerMenu(true); e.target.select() }}
                      onClick={() => setShowCustomerMenu(true)}
                      onBlur={() => setTimeout(() => setShowCustomerMenu(false), 150)}
                      onChange={(e) => { setCustomerName(e.target.value); setCustomerTyped(true); setShowCustomerMenu(true) }}
                    />
                    {showCustomerMenu && (() => {
                      const q = customerTyped ? customerName.trim().toLowerCase() : ''
                      const matches = customerOptions
                        .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
                        .slice(0, 8)
                      if (matches.length === 0) return null
                      return (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4,
                          background: 'var(--surface)', border: '1px solid var(--border-strong)',
                          borderRadius: 8, boxShadow: 'var(--shadow-lg)', maxHeight: 240, overflowY: 'auto'
                        }}>
                          {matches.map((c) => (
                            <div
                              key={c.name}
                              // onMouseDown fires before the input's blur, so the pick isn't lost
                              onMouseDown={(e) => {
                                e.preventDefault()
                                setCustomerName(c.name)
                                if (c.phone) setCustomerPhone(c.phone)
                                setShowCustomerMenu(false)
                              }}
                              style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid var(--border)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-sunken)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                            >
                              <span style={{ fontWeight: 600 }}>{c.name}</span>
                              {c.phone && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.phone}</span>}
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                </div>
                <div className="form-row">
                  <label>Payment Method</label>
                  <select
                    value={paymentMethodId ?? ''}
                    onChange={(e) => setPaymentMethodId(Number(e.target.value))}
                  >
                    {paymentMethods.length === 0 && <option value="">Loading payment methods…</option>}
                    {paymentMethods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}{m.is_credit ? ' (Deni)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {isCreditSale && (
                  <div style={{
                    padding: 10,
                    background: 'rgba(193, 95, 60, 0.08)',
                    borderLeft: '3px solid var(--accent)',
                    borderRadius: 4,
                    fontSize: 12,
                    marginBottom: 14,
                    lineHeight: 1.4
                  }}>
                    <strong>Tip:</strong> For regular business-to-business credit, consider using the
                    <a href="/app/invoices" style={{ color: 'var(--accent)', fontWeight: 700, marginLeft: 4 }}>Invoices</a>
                    module to track aging and formal collection.
                  </div>
                )}
                {isCreditSale && (
                  <div className="form-row">
                    <label>Customer phone</label>
                    <input
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="e.g. 255712345678"
                    />
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, marginBottom: 14 }}>
                  <span>Total</span>
                  <span>TZS {total.toLocaleString()}</span>
                </div>
                <button className="btn btn-gold" style={{ width: '100%' }} onClick={checkout} disabled={busy}>
                  {busy ? 'Processing…' : 'Complete Sale'}
                </button>
              </>
            )}
          </div>

          {receipt && (
            <div className="card doc-numerals" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>Receipt <span className="doc-number">{receipt.receipt_no}</span></h3>
                <button className="btn btn-gold" style={{ padding: '6px 14px' }} onClick={() => setShowPrintReceipt(true)}>
                  🖨 Print Receipt
                </button>
              </div>
              {receipt.sales.map((s) => (
                <div key={s.id} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                  <span>{s.item_name} x{s.quantity}</span>
                  <span>TZS {s.total.toLocaleString()}</span>
                </div>
              ))}
              <div style={{ fontWeight: 700, marginTop: 8, borderTop: '1px solid #eee', paddingTop: 8 }}>
                Total: TZS {receipt.total.toLocaleString()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 14 }}>
                <img
                  src={apiUrl(`/api/public/qr/receipt/${receipt.receipt_no}.png`)}
                  alt="Scan to verify receipt"
                  width={110} height={110}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Scan to verify receipt</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showPrintReceipt && receipt && (
        <ThermalReceipt
          receipt={receipt}
          company={account}
          onClose={() => setShowPrintReceipt(false)}
        />
      )}

      {showDrafts && (
        <Modal
          title="Saved Drafts"
          onClose={() => setShowDrafts(false)}
          footer={<button className="btn btn-outline" onClick={() => setShowDrafts(false)}>Close</button>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {drafts.map((d) => (
              <div key={d.id} className="card" style={{ padding: 14, background: 'var(--surface-sunken)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{d.customer_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(d.created_at).toLocaleString()}</div>
                  </div>
                  <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{money(d.total_amount)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" style={{ flex: 1, fontSize: 12 }} onClick={() => resumeDraft(d)}>Resume Sale</button>
                  <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => deleteDraft(d.id)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Phone-only: the cart lives below a whole grid of products, so
          without this a cashier has to scroll all the way down just to see
          the running total or reach checkout. This sticky bar surfaces
          both at all times and jumps down to the real cart on tap. */}
      {cart.length > 0 && (
        <button type="button" className="pos-mobile-cart-bar" onClick={() => cartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <span>🛒 {cart.length} item{cart.length !== 1 ? 's' : ''}</span>
          <span>TZS {total.toLocaleString()} · View Cart ▲</span>
        </button>
      )}
    </div>
  )
}
