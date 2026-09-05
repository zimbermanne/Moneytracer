from datetime import datetime, timedelta

def add_months(d: datetime, months: int) -> datetime:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    # Day 28 is safe for all months
    day = min(d.day, 28)
    return d.replace(year=year, month=month, day=day)

def calculate_next_date(current: datetime, frequency: str, interval: int) -> datetime:
    if frequency == "weekly":
        return current + timedelta(weeks=interval)
    if frequency == "biweekly":
        return current + timedelta(weeks=2 * interval)
    if frequency == "monthly":
        return add_months(current, interval)
    if frequency == "quarterly":
        return add_months(current, 3 * interval)
    if frequency == "yearly":
        return add_months(current, 12 * interval)
    return current + timedelta(days=30)
