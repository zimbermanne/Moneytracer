import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`
const dateStr = (d) => d ? new Date(d).toLocaleDateString() : '—'

const emptyEmployeeForm = () => ({
  employee_number: '', first_name: '', last_name: '', email: '', phone: '',
  address: '', hire_date: '', position: '', department: '', employment_type: 'full_time',
  salary: '', pay_frequency: 'monthly', tax_id: '', bank_name: '', bank_account: '',
})

const emptyPayslipForm = () => ({
  employee_id: '', period_start: '', period_end: '', pay_date: '',
  basic_salary: '', overtime: 0, bonuses: 0, allowances: 0,
  paye_tax: 0, social_security: 0, pension: 0, other_deductions: 0, notes: '',
})

const STATUS_BADGE = { draft: 'badge badge-unpaid', finalized: 'badge badge-partial', paid: 'badge badge-paid' }

export default function Payroll() {
  const api = useApi()
  const [tab, setTab] = useState('employees')

  const [employees, setEmployees] = useState([])
  const [payslips, setPayslips] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [empOpen, setEmpOpen] = useState(false)
  const [editingEmpId, setEditingEmpId] = useState(null)
  const [empForm, setEmpForm] = useState(emptyEmployeeForm())
  const [savingEmp, setSavingEmp] = useState(false)

  const [slipOpen, setSlipOpen] = useState(false)
  const [slipForm, setSlipForm] = useState(emptyPayslipForm())
  const [savingSlip, setSavingSlip] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([api.get('/payroll/employees'), api.get('/payroll/payslips')])
      .then(([e, p]) => { setEmployees(e); setPayslips(p) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const employeeName = (id) => {
    const e = employees.find((x) => x.id === id)
    return e ? `${e.first_name} ${e.last_name}` : `#${id}`
  }

  // ---------- Employees ----------
  const openNewEmployee = () => { setEditingEmpId(null); setEmpForm(emptyEmployeeForm()); setError(''); setEmpOpen(true) }
  const openEditEmployee = (e) => {
    setEditingEmpId(e.id)
    setEmpForm({
      employee_number: e.employee_number, first_name: e.first_name, last_name: e.last_name,
      email: e.email || '', phone: e.phone || '', address: e.address || '',
      hire_date: e.hire_date ? e.hire_date.slice(0, 10) : '', position: e.position || '',
      department: e.department || '', employment_type: e.employment_type || 'full_time',
      salary: e.salary, pay_frequency: e.pay_frequency, tax_id: e.tax_id || '',
      bank_name: e.bank_name || '', bank_account: e.bank_account || '',
    })
    setError(''); setEmpOpen(true)
  }

  const saveEmployee = async () => {
    if (!empForm.first_name.trim() || !empForm.last_name.trim() || !empForm.employee_number.trim()) {
      setError('Employee number, first name, and last name are required.'); return
    }
    setSavingEmp(true); setError('')
    try {
      const payload = {
        ...empForm,
        salary: Number(empForm.salary) || 0,
        hire_date: empForm.hire_date ? new Date(empForm.hire_date).toISOString() : new Date().toISOString(),
      }
      if (editingEmpId) await api.put(`/payroll/employees/${editingEmpId}`, payload)
      else await api.post('/payroll/employees', payload)
      setEmpOpen(false); load()
    } catch (e) { setError(e.message) } finally { setSavingEmp(false) }
  }

  const removeEmployee = async (e) => {
    if (!confirm(`Delete employee "${e.first_name} ${e.last_name}"?`)) return
    try { await api.del(`/payroll/employees/${e.id}`); load() } catch (e) { alert(e.message) }
  }

  // ---------- Payslips ----------
  const openNewPayslip = () => { setSlipForm(emptyPayslipForm()); setError(''); setSlipOpen(true) }

  const saveSlip = async () => {
    if (!slipForm.employee_id || !slipForm.period_start || !slipForm.period_end || !slipForm.pay_date) {
      setError('Employee, period, and pay date are required.'); return
    }
    setSavingSlip(true); setError('')
    try {
      const payload = {
        employee_id: Number(slipForm.employee_id),
        period_start: new Date(slipForm.period_start).toISOString(),
        period_end: new Date(slipForm.period_end).toISOString(),
        pay_date: new Date(slipForm.pay_date).toISOString(),
        basic_salary: Number(slipForm.basic_salary) || 0,
        overtime: Number(slipForm.overtime) || 0,
        bonuses: Number(slipForm.bonuses) || 0,
        allowances: Number(slipForm.allowances) || 0,
        paye_tax: Number(slipForm.paye_tax) || 0,
        social_security: Number(slipForm.social_security) || 0,
        pension: Number(slipForm.pension) || 0,
        other_deductions: Number(slipForm.other_deductions) || 0,
        notes: slipForm.notes || '',
      }
      await api.post('/payroll/payslips', payload)
      setSlipOpen(false); load()
    } catch (e) { setError(e.message) } finally { setSavingSlip(false) }
  }

  const finalizeSlip = async (p) => {
    if (!confirm('Finalize this payslip and post it to the ledger? This cannot be undone.')) return
    try { await api.put(`/payroll/payslips/${p.id}/finalize`); load() } catch (e) { alert(e.message) }
  }

  const markPaid = async (p) => {
    try { await api.put(`/payroll/payslips/${p.id}/mark-paid`); load() } catch (e) { alert(e.message) }
  }

  const employeeColumns = [
    { key: 'employee_number', header: 'No.' },
    { key: 'name', header: 'Name', render: (e) => <strong>{e.first_name} {e.last_name}</strong> },
    { key: 'position', header: 'Position', render: (e) => e.position || '—' },
    { key: 'department', header: 'Department', render: (e) => e.department || '—' },
    { key: 'salary', header: 'Salary', render: (e) => money(e.salary) },
    { key: 'pay_frequency', header: 'Frequency', render: (e) => <span style={{ textTransform: 'capitalize' }}>{e.pay_frequency}</span> },
    { key: 'is_active', header: 'Status', render: (e) => <span className={e.is_active ? 'badge badge-paid' : 'badge badge-unpaid'}>{e.is_active ? 'Active' : 'Inactive'}</span> },
    {
      key: 'actions', header: '', stopRowClick: true,
      render: (e) => (
        <RowActionsMenu items={[
          { label: 'Edit', onClick: () => openEditEmployee(e) },
          { label: 'Delete', onClick: () => removeEmployee(e), danger: true },
        ]} />
      ),
    },
  ]

  const payslipColumns = [
    { key: 'employee', header: 'Employee', render: (p) => employeeName(p.employee_id) },
    { key: 'period', header: 'Period', render: (p) => `${dateStr(p.period_start)} – ${dateStr(p.period_end)}` },
    { key: 'pay_date', header: 'Pay Date', render: (p) => dateStr(p.pay_date) },
    { key: 'gross_pay', header: 'Gross Pay', render: (p) => money(p.gross_pay) },
    { key: 'total_deductions', header: 'Deductions', render: (p) => money(p.total_deductions) },
    { key: 'net_pay', header: 'Net Pay', render: (p) => <strong>{money(p.net_pay)}</strong> },
    { key: 'status', header: 'Status', render: (p) => <span className={STATUS_BADGE[p.status] || 'badge'} style={{ textTransform: 'capitalize' }}>{p.status}</span> },
    {
      key: 'actions', header: '', stopRowClick: true,
      render: (p) => (
        <RowActionsMenu items={[
          ...(p.status === 'draft' ? [{ label: 'Finalize & Post', onClick: () => finalizeSlip(p) }] : []),
          ...(p.status === 'finalized' ? [{ label: 'Mark Paid', onClick: () => markPaid(p) }] : []),
        ]} />
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Payroll</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{employees.length} employee(s) · {payslips.length} payslip(s)</div>
        </div>
        {tab === 'employees'
          ? <button className="btn btn-primary" onClick={openNewEmployee}>+ Add Employee</button>
          : <button className="btn btn-primary" onClick={openNewPayslip}>+ Run Payroll</button>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${tab === 'employees' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('employees')}>Employees</button>
        <button className={`btn ${tab === 'payslips' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('payslips')}>Payslips</button>
      </div>

      {tab === 'employees'
        ? <Table columns={employeeColumns} rows={employees} loading={loading} emptyText="No employees added yet." onRowClick={openEditEmployee} />
        : <Table columns={payslipColumns} rows={payslips} loading={loading} emptyText="No payslips generated yet." />}

      {empOpen && (
        <Modal
          title={editingEmpId ? 'Edit Employee' : 'Add Employee'}
          onClose={() => setEmpOpen(false)}
          wide={true}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setEmpOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEmployee} disabled={savingEmp}>
                {savingEmp ? 'Saving…' : editingEmpId ? 'Save Changes' : 'Save'}
              </button>
            </>
          }
        >
          {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
          <label>Employee Number</label>
          <input value={empForm.employee_number} onChange={(e) => setEmpForm({ ...empForm, employee_number: e.target.value })} />
          <label>First Name</label>
          <input value={empForm.first_name} onChange={(e) => setEmpForm({ ...empForm, first_name: e.target.value })} />
          <label>Last Name</label>
          <input value={empForm.last_name} onChange={(e) => setEmpForm({ ...empForm, last_name: e.target.value })} />
          <label>Email</label>
          <input value={empForm.email} onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })} />
          <label>Phone</label>
          <input value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} />
          <label>Hire Date</label>
          <input type="date" value={empForm.hire_date} onChange={(e) => setEmpForm({ ...empForm, hire_date: e.target.value })} />
          <label>Position</label>
          <input value={empForm.position} onChange={(e) => setEmpForm({ ...empForm, position: e.target.value })} />
          <label>Department</label>
          <input value={empForm.department} onChange={(e) => setEmpForm({ ...empForm, department: e.target.value })} />
          <label>Employment Type</label>
          <select value={empForm.employment_type} onChange={(e) => setEmpForm({ ...empForm, employment_type: e.target.value })}>
            <option value="full_time">Full Time</option>
            <option value="part_time">Part Time</option>
            <option value="contract">Contract</option>
          </select>
          <label>Salary</label>
          <input type="number" value={empForm.salary} onChange={(e) => setEmpForm({ ...empForm, salary: e.target.value })} />
          <label>Pay Frequency</label>
          <select value={empForm.pay_frequency} onChange={(e) => setEmpForm({ ...empForm, pay_frequency: e.target.value })}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
          </select>
          <label>Tax ID</label>
          <input value={empForm.tax_id} onChange={(e) => setEmpForm({ ...empForm, tax_id: e.target.value })} />
          <label>Bank Name</label>
          <input value={empForm.bank_name} onChange={(e) => setEmpForm({ ...empForm, bank_name: e.target.value })} />
          <label>Bank Account</label>
          <input value={empForm.bank_account} onChange={(e) => setEmpForm({ ...empForm, bank_account: e.target.value })} />
        </Modal>
      )}

      {slipOpen && (
        <Modal
          title="Run Payroll — New Payslip"
          onClose={() => setSlipOpen(false)}
          wide={true}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setSlipOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveSlip} disabled={savingSlip}>
                {savingSlip ? 'Saving…' : 'Create Payslip'}
              </button>
            </>
          }
        >
          {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
          <label>Employee</label>
          <select value={slipForm.employee_id} onChange={(e) => setSlipForm({ ...slipForm, employee_id: e.target.value })}>
            <option value="">Select employee…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
          </select>
          <label>Period Start</label>
          <input type="date" value={slipForm.period_start} onChange={(e) => setSlipForm({ ...slipForm, period_start: e.target.value })} />
          <label>Period End</label>
          <input type="date" value={slipForm.period_end} onChange={(e) => setSlipForm({ ...slipForm, period_end: e.target.value })} />
          <label>Pay Date</label>
          <input type="date" value={slipForm.pay_date} onChange={(e) => setSlipForm({ ...slipForm, pay_date: e.target.value })} />
          <label>Basic Salary</label>
          <input type="number" value={slipForm.basic_salary} onChange={(e) => setSlipForm({ ...slipForm, basic_salary: e.target.value })} />
          <label>Overtime</label>
          <input type="number" value={slipForm.overtime} onChange={(e) => setSlipForm({ ...slipForm, overtime: e.target.value })} />
          <label>Bonuses</label>
          <input type="number" value={slipForm.bonuses} onChange={(e) => setSlipForm({ ...slipForm, bonuses: e.target.value })} />
          <label>Allowances</label>
          <input type="number" value={slipForm.allowances} onChange={(e) => setSlipForm({ ...slipForm, allowances: e.target.value })} />
          <label>PAYE Tax</label>
          <input type="number" value={slipForm.paye_tax} onChange={(e) => setSlipForm({ ...slipForm, paye_tax: e.target.value })} />
          <label>Social Security</label>
          <input type="number" value={slipForm.social_security} onChange={(e) => setSlipForm({ ...slipForm, social_security: e.target.value })} />
          <label>Pension</label>
          <input type="number" value={slipForm.pension} onChange={(e) => setSlipForm({ ...slipForm, pension: e.target.value })} />
          <label>Other Deductions</label>
          <input type="number" value={slipForm.other_deductions} onChange={(e) => setSlipForm({ ...slipForm, other_deductions: e.target.value })} />
          <label>Notes</label>
          <input value={slipForm.notes} onChange={(e) => setSlipForm({ ...slipForm, notes: e.target.value })} />
        </Modal>
      )}
    </div>
  )
}
