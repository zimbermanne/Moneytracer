from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Employee, Payslip, User, RoleEnum
from schemas import (
    EmployeeCreate, EmployeeUpdate, EmployeeOut, PayslipCreate, PayslipOut,
    BatchPayrollCreate
)
from auth import get_current_user, require_manager_up
from activity import log_activity_for_user
from ledger import post_journal_entry

router = APIRouter(prefix="/api/payroll", tags=["payroll"])


def get_account_filter(current_user: User):
    """Return account_id filter for queries. Superadmin gets None (no filter)."""
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


# ---------- Employees ----------

@router.get("/employees", response_model=List[EmployeeOut])
def list_employees(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all employees for the account."""
    account_id = get_account_filter(current_user)
    query = db.query(Employee)
    if account_id is not None:
        query = query.filter(Employee.account_id == account_id)
    return query.order_by(Employee.last_name, Employee.first_name).all()


@router.post("/employees", response_model=EmployeeOut)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Create a new employee."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create employees")

    employee = Employee(
        account_id=account_id,
        user_id=payload.user_id,
        employee_number=payload.employee_number,
        first_name=payload.first_name,
        last_name=payload.last_name,
        email=payload.email,
        phone=payload.phone,
        address=payload.address,
        hire_date=payload.hire_date,
        position=payload.position,
        department=payload.department,
        employment_type=payload.employment_type,
        salary=payload.salary,
        pay_frequency=payload.pay_frequency,
        tax_id=payload.tax_id,
        bank_name=payload.bank_name,
        bank_account=payload.bank_account,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    log_activity_for_user(db, current_user, "employee_create", f"Created employee: {payload.first_name} {payload.last_name}")
    return employee


@router.put("/employees/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Update an employee."""
    account_id = get_account_filter(current_user)
    query = db.query(Employee).filter(Employee.id == employee_id)
    if account_id is not None:
        query = query.filter(Employee.account_id == account_id)
    employee = query.first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    if payload.first_name is not None:
        employee.first_name = payload.first_name
    if payload.last_name is not None:
        employee.last_name = payload.last_name
    if payload.email is not None:
        employee.email = payload.email
    if payload.phone is not None:
        employee.phone = payload.phone
    if payload.address is not None:
        employee.address = payload.address
    if payload.position is not None:
        employee.position = payload.position
    if payload.department is not None:
        employee.department = payload.department
    if payload.employment_type is not None:
        employee.employment_type = payload.employment_type
    if payload.is_active is not None:
        employee.is_active = payload.is_active
    if payload.salary is not None:
        employee.salary = payload.salary
    if payload.pay_frequency is not None:
        employee.pay_frequency = payload.pay_frequency
    if payload.tax_id is not None:
        employee.tax_id = payload.tax_id
    if payload.bank_name is not None:
        employee.bank_name = payload.bank_name
    if payload.bank_account is not None:
        employee.bank_account = payload.bank_account

    db.commit()
    db.refresh(employee)
    log_activity_for_user(db, current_user, "employee_update", f"Updated employee: {employee.first_name} {employee.last_name}")
    return employee


@router.delete("/employees/{employee_id}")
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Delete an employee."""
    account_id = get_account_filter(current_user)
    query = db.query(Employee).filter(Employee.id == employee_id)
    if account_id is not None:
        query = query.filter(Employee.account_id == account_id)
    employee = query.first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    db.delete(employee)
    db.commit()
    log_activity_for_user(db, current_user, "employee_delete", f"Deleted employee: {employee.first_name} {employee.last_name}")
    return {"message": "Employee deleted"}


# ---------- Payslips ----------

@router.get("/payslips", response_model=List[PayslipOut])
def list_payslips(
    employee_id: int = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List payslips with optional employee filter."""
    account_id = get_account_filter(current_user)
    query = db.query(Payslip)
    if account_id is not None:
        query = query.filter(Payslip.account_id == account_id)
    if employee_id:
        query = query.filter(Payslip.employee_id == employee_id)
    return query.order_by(Payslip.period_start.desc()).all()


@router.post("/payslips", response_model=PayslipOut)
def create_payslip(
    payload: PayslipCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Create a new payslip and post the payroll journal entry."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create payslips")

    # Verify employee exists and belongs to account
    employee = db.query(Employee).filter(
        Employee.id == payload.employee_id,
        Employee.account_id == account_id
    ).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Calculate totals
    gross_pay = payload.basic_salary + payload.overtime + payload.bonuses + payload.allowances
    total_deductions = payload.paye_tax + payload.social_security + payload.pension + payload.other_deductions
    net_pay = gross_pay - total_deductions

    payslip = Payslip(
        account_id=account_id,
        employee_id=payload.employee_id,
        period_start=payload.period_start,
        period_end=payload.period_end,
        pay_date=payload.pay_date,
        gross_pay=gross_pay,
        basic_salary=payload.basic_salary,
        overtime=payload.overtime,
        bonuses=payload.bonuses,
        allowances=payload.allowances,
        paye_tax=payload.paye_tax,
        social_security=payload.social_security,
        pension=payload.pension,
        other_deductions=payload.other_deductions,
        total_deductions=total_deductions,
        net_pay=net_pay,
        status="draft",
        notes=payload.notes,
        created_by=current_user.username,
    )
    db.add(payslip)
    db.commit()
    db.refresh(payslip)

    log_activity_for_user(db, current_user, "payslip_create", f"Created payslip for employee {payload.employee_id}")
    return payslip


@router.post("/payslips/batch", response_model=List[PayslipOut])
def batch_generate_payslips(
    payload: BatchPayrollCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Automatically generate draft payslips for all active employees based on their salary."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot run payroll")

    active_employees = db.query(Employee).filter(
        Employee.account_id == account_id,
        Employee.is_active == True
    ).all()

    if not active_employees:
        raise HTTPException(status_code=400, detail="No active employees found to generate payslips for.")

    payslips = []
    for emp in active_employees:
        # Check if a payslip already exists for this employee and period
        existing = db.query(Payslip).filter(
            Payslip.employee_id == emp.id,
            Payslip.period_start == payload.period_start,
            Payslip.period_end == payload.period_end
        ).first()

        if existing:
            continue

        # Basic payroll math
        # Gross = Salary (since it's recurring/automated, we assume no one-off OT/bonuses yet)
        # Net = Gross (we assume deductions are handled manually or during finalization for now)
        # Note: In a full-blown system, we'd apply tax formulas here.
        gross_pay = emp.salary
        net_pay = gross_pay

        payslip = Payslip(
            account_id=account_id,
            employee_id=emp.id,
            period_start=payload.period_start,
            period_end=payload.period_end,
            pay_date=payload.pay_date,
            gross_pay=gross_pay,
            basic_salary=emp.salary,
            overtime=0,
            bonuses=0,
            allowances=0,
            paye_tax=0,
            social_security=0,
            pension=0,
            other_deductions=0,
            total_deductions=0,
            net_pay=net_pay,
            status="draft",
            notes=payload.notes,
            created_by=current_user.username,
        )
        db.add(payslip)
        payslips.append(payslip)

    db.commit()
    for p in payslips:
        db.refresh(p)

    log_activity_for_user(db, current_user, "payslip_batch_generate", f"Batch generated {len(payslips)} draft payslip(s)")
    return payslips


@router.put("/payslips/{payslip_id}/finalize")
def finalize_payslip(
    payslip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Finalize a payslip and post the journal entry to the ledger."""
    account_id = get_account_filter(current_user)
    query = db.query(Payslip).filter(Payslip.id == payslip_id)
    if account_id is not None:
        query = query.filter(Payslip.account_id == account_id)
    payslip = query.first()
    if not payslip:
        raise HTTPException(status_code=404, detail="Payslip not found")
    if payslip.status != "draft":
        raise HTTPException(status_code=400, detail="Payslip is not in draft status")

    # Post journal entry for payroll
    # Debit: Salaries & Wages Expense (account code 5300)
    # Credit: Cash (account code 1000) for net pay
    # Credit: PAYE Tax Payable (account code 2300)
    # Credit: Social Security Payable (account code 2310)
    # Credit: Other Payroll Deductions Payable (account code 2320)

    try:
        from ledger import post_journal_entry
        lines = [
            ("5300", payslip.gross_pay, 0),  # Debit Salaries & Wages Expense
            ("1000", 0, payslip.net_pay),  # Credit Cash for net pay
            ("2300", 0, payslip.paye_tax),  # Credit PAYE Payable
            ("2310", 0, payslip.social_security + payslip.pension),  # Credit Social Security Payable
        ]
        if payslip.other_deductions:
            lines.append(("2320", 0, payslip.other_deductions))  # Credit Other Deductions Payable
        post_journal_entry(
            db,
            account_id,
            description=f"Payroll: {payslip.employee_id} for period {payslip.period_start.date()} to {payslip.period_end.date()}",
            lines=lines,
            reference=f"payslip-{payslip.id}",
            created_by=current_user.username,
            date=payslip.pay_date,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to post journal entry: {str(e)}")

    payslip.status = "finalized"
    db.commit()
    db.refresh(payslip)
    
    log_activity_for_user(db, current_user, "payslip_finalize", f"Finalized payslip {payslip_id}")
    return payslip


@router.put("/payslips/{payslip_id}/mark-paid")
def mark_payslip_paid(
    payslip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Mark a finalized payslip as paid."""
    account_id = get_account_filter(current_user)
    query = db.query(Payslip).filter(Payslip.id == payslip_id)
    if account_id is not None:
        query = query.filter(Payslip.account_id == account_id)
    payslip = query.first()
    if not payslip:
        raise HTTPException(status_code=404, detail="Payslip not found")
    if payslip.status != "finalized":
        raise HTTPException(status_code=400, detail="Payslip must be finalized before marking as paid")

    payslip.status = "paid"
    db.commit()
    db.refresh(payslip)
    
    log_activity_for_user(db, current_user, "payslip_paid", f"Marked payslip {payslip_id} as paid")
    return payslip
