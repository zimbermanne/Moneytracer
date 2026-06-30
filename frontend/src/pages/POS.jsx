import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'

export default function POS() {
  const api = useApi()
  const [items, setItems] = useState([])
  const [cart, setCart] = useState([]) // [{item_id, name, price, qty, stock}]
  const [paymentMode, setPaymentMode] = useState('cash')
  const [customerName, setCustomerName] = useState('Walk-in')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/inventory/').then(setItems).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.item_id === item.id)
      if (existing) {
        if (existing.qty + 1 > item.quantity) return prev
        return prev.map((c) => c.item_id === item.id ? { ...c, qty: c.qty + 1 } : c)
      }
      if (item.quantity < 1) return prev
      return [...prev, { item_id: item.id, name: item.name, price: item.selling_price, qty: 1, stock: item.quantity }]
    })
  }

  const updateQty = (item_id, qty) => {
    setCart((prev) => prev.map((c) => c.item_id === item_id ? { ...c, qty: Math.max(1, Math.min(qty, c.stock)) } : c))
  }

  const removeLine = (item_id) => setCart((prev) => prev.filter((c) => c.item_id !== item_id))

  const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0)

  const checkout = async () => {
    if (cart.length === 0) return
    setBusy(true)
    setError('')
    try {
      const res = await api.post('/sales/checkout', {
        lines: cart.map((c) => ({ item_id: c.item_id, quantity: c.qty })),
        payment_mode: paymentMode,
        customer_name: customerName || 'Walk-in',
      })
      setReceipt(res)
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
      <div className="page-header">
        <h1>Point of Sale</h1>
      </div>

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

        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Cart</h2>
            {cart.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No items added.</div>}
            {cart.map((c) => (
              <div key={c.item_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>TZS {c.price.toLocaleString()} each</div>
                </div>
                <input
                  type="number"
                  min="1"
                  max={c.stock}
                  value={c.qty}
                  onChange={(e) => updateQty(c.item_id, Number(e.target.value))}
                  style={{ width: 60, marginRight: 8 }}
                />
                <button className="btn btn-outline" onClick={() => removeLine(c.item_id)}>✕</button>
              </div>
            ))}

            {cart.length > 0 && (
              <>
                <div className="form-row">
                  <label>Customer name</label>
                  <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Payment Mode</label>
                  <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="credit">Credit (Deni)</option>
                    <option value="mobile_money">Mobile Money</option>
                  </select>
                </div>
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
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Receipt {receipt.receipt_no}</h3>
              {receipt.sales.map((s) => (
                <div key={s.id} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{s.item_name} x{s.quantity}</span>
                  <span>TZS {s.total.toLocaleString()}</span>
                </div>
              ))}
              <div style={{ fontWeight: 700, marginTop: 8, borderTop: '1px solid #eee', paddingTop: 8 }}>
                Total: TZS {receipt.total.toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
