import { useEffect, useState, Fragment } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { useSearch } from '../hooks/useSearch.js'
import Table from '../components/Table.jsx'
import SearchBar from '../components/SearchBar.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import ThermalReceipt from '../components/ThermalReceipt.jsx'

export default function Sales() {
  const api = useApi()
  const { account } = useAuth()
  const [sales, setSales] = useState([])
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [printReceipt, setPrintReceipt] = useState(null)

  const [shareDoc, setShareDoc] = useState(null)
  const [shareQuery, setShareQuery] = useState('')
  const [shareResults, setShareResults] = useState([])
  const [shareSearching, setShareSearching] = useState(false)

  const load = () => {
    setListLoading(true)
    api.get('/sales/').then(setSales).catch((e) => setError(e.message)).finally(() => setListLoading(false))
    api.get('/sales/stats/summary').then(setStats).catch(() => {})
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (id) => {
    if (!confirm('Delete this sale and restore stock?')) return
    try {
      await api.del(`/sales/${id}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const openReceipt = (r) => {
    // A single checkout can produce several line items sharing one
    // receipt_no — group them back together so the reprint shows the
    // whole original receipt, not just the clicked row's line.
    const grouped = r.receipt_no ? sales.filter((s) => s.receipt_no === r.receipt_no) : [r]
    const total = grouped.reduce((sum, s) => sum + s.total, 0)
    setPrintReceipt({
      receipt_no: r.receipt_no || `SALE-${r.id}`,
      sales: grouped,
      total,
      customer_name: r.customer_name,
      payment_mode: r.payment_mode,
      created_at: r.created_at,
    })
  }

  const searchShare = (q) => {
    setShareQuery(q)
    if (q.length < 3) { setShareResults([]); return }
    setShareSearching(true)
    api.get(`/messages/directory?q=${encodeURIComponent(q)}`)
      .then(setShareResults)
      .catch(() => {})
      .finally(() => setShareSearching(false))
  }

  const doShare = async (business) => {
    try {
      await api.post('/messages/threads', {
        recipient_account_id: business.id,
        subject: `Shared Receipt: ${shareDoc.receipt_no || ('SALE-'+shareDoc.id)}`,
        body: `Hello! I am sharing a receipt with you.`,
        attachment_type: 'receipt',
        attachment_id: shareDoc.id
      })
      alert('Receipt shared successfully!')
      setShareDoc(null)
    } catch (e) {
      setError(e.message)
    }
  }

  const columns = [
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'item_name', header: 'Item' },
    { key: 'quantity', header: 'Qty' },
    { key: 'total', header: 'Total', render: (r) => `TZS ${r.total.toLocaleString()}` },
    { key: 'payment_mode', header: 'Payment' },
    { key: 'customer_name', header: 'Customer' },
    { key: 'receipt_no', header: 'Receipt #' },
    {
      key: 'actions', header: '', stopRowClick: true,
      render: (r) => (
        <RowActionsMenu items={[
          { label: 'Print Receipt', icon: '🖨️', onClick: () => openReceipt(r) },
          { label: 'Share', icon: '✉️', onClick: () => setShareDoc(r) },
          { label: 'Delete', icon: '✕', onClick: () => remove(r.id), danger: true },
        ]} />
      ),
    },
  ]

  const { query, setQuery, filtered } = useSearch(sales, [
    'customer_name',
    'receipt_no',
    'item_name',
    (r) => new Date(r.created_at).toLocaleDateString(),
    (r) => new Date(r.created_at).toLocaleString(),
  ])

  // Group filtered sales by receipt_no
  const grouped = filtered.reduce((acc, s) => {
    const key = s.receipt_no || `SALE-${s.id}`
    if (!acc[key]) {
      acc[key] = {
        receipt_no: key,
        created_at: s.created_at,
        customer_name: s.customer_name,
        payment_mode: s.payment_mode,
        total: 0,
        items: []
      }
    }
    acc[key].total += s.total
    acc[key].items.push(s)
    return acc
  }, {})

  const receipts = Object.values(grouped).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  const [expanded, setExpanded] = useState({}) // { receipt_no: true }

  const toggleExpand = (no) => {
    setExpanded(prev => ({ ...prev, [no]: !prev[no] }))
  }

  return (
    <div className="page">
      <div className="page-header"><h1>Sales History</h1></div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {stats && (
        <div className="card-grid">
          <div className="card metric-card"><div className="label">Total Transactions</div><div className="value">{receipts.length}</div></div>
          <div className="card metric-card"><div className="label">Total Revenue</div><div className="value">TZS {stats.total_revenue.toLocaleString()}</div></div>
          <div className="card metric-card"><div className="label">Average Receipt</div><div className="value">TZS {(stats.total_revenue / receipts.length || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
        </div>
      )}

      <div style={{ display: 'flex', marginBottom: 14 }}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search by customer, date, or receipt #…" />
      </div>

      <div className="card responsive-table" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="pl-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>Date</th>
              <th>Receipt #</th>
              <th>Customer</th>
              <th>Payment</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{listLoading ? 'Loading sales...' : 'No sales found.'}</td></tr>
            ) : receipts.map((r) => (
              <Fragment key={r.receipt_no}>
                <tr onClick={() => toggleExpand(r.receipt_no)} style={{ cursor: 'pointer', background: expanded[r.receipt_no] ? 'var(--surface-sunken)' : 'transparent' }}>
                  <td>{expanded[r.receipt_no] ? '▼' : '▶'}</td>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td><span className="cheque-number">{r.receipt_no}</span></td>
                  <td>{r.customer_name}</td>
                  <td><span className="badge badge-outline">{r.payment_mode}</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>TZS {r.total.toLocaleString()}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <RowActionsMenu items={[
                      { label: 'Print Receipt', icon: '🖨️', onClick: () => setPrintReceipt(r) },
                      { label: 'Share', icon: '✉️', onClick: () => setShareDoc(r) },
                    ]} />
                  </td>
                </tr>
                {expanded[r.receipt_no] && (
                  <tr>
                    <td colSpan={7} style={{ padding: '0 0 12px 40px', background: 'var(--surface-sunken)' }}>
                      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            <th style={{ padding: '8px 0', textAlign: 'left', background: 'transparent', textTransform: 'none', color: 'var(--text-muted)' }}>Item Description</th>
                            <th style={{ padding: '8px 0', textAlign: 'center', background: 'transparent', textTransform: 'none', color: 'var(--text-muted)' }}>Qty</th>
                            <th style={{ padding: '8px 0', textAlign: 'right', background: 'transparent', textTransform: 'none', color: 'var(--text-muted)' }}>Unit Price</th>
                            <th style={{ padding: '8px 0', textAlign: 'right', background: 'transparent', textTransform: 'none', color: 'var(--text-muted)' }}>Amount</th>
                            <th style={{ width: 40 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.items.map((item) => (
                            <tr key={item.id} style={{ borderBottom: '1px dotted var(--border)' }}>
                              <td style={{ padding: '8px 0' }}>{item.item_name}</td>
                              <td style={{ padding: '8px 0', textAlign: 'center' }}>{item.quantity}</td>
                              <td style={{ padding: '8px 0', textAlign: 'right' }}>TZS {item.unit_price.toLocaleString()}</td>
                              <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600 }}>TZS {item.total.toLocaleString()}</td>
                              <td style={{ textAlign: 'right' }}>
                                <button className="btn-icon" style={{ color: 'var(--danger)', fontSize: 12 }} onClick={() => remove(item.id)} title="Delete item & restore stock">✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {printReceipt && (
        <ThermalReceipt
          receipt={printReceipt}
          company={account}
          onClose={() => setPrintReceipt(null)}
        />
      )}

      {shareDoc && (
        <Modal
          title="Share Receipt"
          onClose={() => setShareDoc(null)}
          wide={true}
          isDirty={false}
          footer={(
            <button className="btn btn-outline" onClick={() => setShareDoc(null)}>Cancel</button>
          )}
        >
          <p className="sub">Share receipt <strong>{shareDoc.receipt_no || ('SALE-'+shareDoc.id)}</strong> with another business on Moneytracer.</p>
          <SearchBar value={shareQuery} onChange={searchShare} placeholder="Search business name or email..." autoFocus />

          <div style={{ marginTop: 20, maxHeight: 250, overflowY: 'auto' }}>
            {shareSearching ? <div>Searching...</div> : (
              shareResults.length === 0 && shareQuery.length >= 3 ? <div>No businesses found.</div> :
              shareResults.map(b => (
                <div
                  key={b.id}
                  onClick={() => doShare(b)}
                  style={{ padding: '12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  className="hover-bg"
                >
                  <strong>{b.name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.email}</div>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
