import { useEffect, useState } from 'react'
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
          { label: 'Print Receipt', onClick: () => openReceipt(r) },
          { label: 'Delete', onClick: () => remove(r.id), danger: true },
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

  return (
    <div className="page">
      <div className="page-header"><h1>Sales History</h1></div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      {stats && (
        <div className="card-grid">
          <div className="card metric-card"><div className="label">Total Sales</div><div className="value">{stats.total_sales}</div></div>
          <div className="card metric-card"><div className="label">Total Revenue</div><div className="value">TZS {stats.total_revenue.toLocaleString()}</div></div>
          <div className="card metric-card"><div className="label">Average Sale</div><div className="value">TZS {stats.average_sale.toLocaleString()}</div></div>
        </div>
      )}
      {stats && (stats.most_sold_item || stats.top_revenue_item) && (
        <div className="card-grid">
          <div className="card metric-card">
            <div className="label">Most Sold Item</div>
            <div className="value" style={{ fontSize: 16 }}>
              {stats.most_sold_item ? `${stats.most_sold_item.item_name} (${stats.most_sold_item.quantity} sold)` : '—'}
            </div>
          </div>
          <div className="card metric-card">
            <div className="label">Top Revenue Item</div>
            <div className="value" style={{ fontSize: 16 }}>
              {stats.top_revenue_item ? `${stats.top_revenue_item.item_name} (TZS ${stats.top_revenue_item.revenue.toLocaleString()})` : '—'}
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search by customer, date, or receipt #…" />
      </div>
      <Table columns={columns} rows={filtered} loading={listLoading} loadingText="Loading sales…" emptyText={query ? 'No sales match your search.' : 'No sales yet.'} />

      {printReceipt && (
        <ThermalReceipt
          receipt={printReceipt}
          company={account}
          onClose={() => setPrintReceipt(null)}
        />
      )}
    </div>
  )
}
