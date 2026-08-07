from collections import defaultdict
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Sale, User
from auth import get_current_user
from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional
from models import PaymentMode

router = APIRouter(prefix="/api/customers", tags=["customers"])

class CustomerSummary(BaseModel):
    customer_name: str
    total_spent: float
    purchase_count: int
    last_purchase: Optional[datetime]

class CustomerPurchase(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_name: str
    quantity: float
    unit_price: float
    total: float
    payment_mode: PaymentMode
    receipt_no: str
    created_at: datetime

@router.get("/", response_model=List[CustomerSummary])
def list_customers(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    sales = db.query(Sale).order_by(Sale.created_at.desc()).all()
    grouped = defaultdict(list)
    for s in sales:
        grouped[s.customer_name or "Walk-in"].append(s)
    result = []
    for name, rows in grouped.items():
        result.append(CustomerSummary(
            customer_name=name,
            total_spent=round(sum(r.total for r in rows), 2),
            purchase_count=len(rows),
            last_purchase=rows[0].created_at,
        ))
    return sorted(result, key=lambda c: c.last_purchase or datetime.min, reverse=True)

@router.get("/{customer_name}/purchases", response_model=List[CustomerPurchase])
def customer_purchases(customer_name: str, db: Session = Depends(get_db),
                       _: User = Depends(get_current_user)):
    sales = db.query(Sale).filter(Sale.customer_name == customer_name)\
               .order_by(Sale.created_at.desc()).all()
    if not sales:
        raise HTTPException(404, "No purchases found for this customer")
    return sales
