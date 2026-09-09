"""Local stand-in for the real GoodScore staging API, for testing without
a real staging account.

Serves the same four paths backend/chat/tools.py's existing customer-data
tools call (get_credit_report, get_prefetched_bills, get_subscription_details,
get_transaction_history) — same request shape ({"userId": ...}), same
response shape (including raw Firestore-style timestamps where the real
API uses them, since prompt.py's own business rules expect tools.py's
_firestore_to_ist() to do that conversion, not the API itself).

Recognises the user_ids in MOCK_USER_IDS below, each a distinct realistic
profile so multi-user testing actually exercises different business-logic
paths (see the table above each profile). Every other user_id gets a 404,
matching how the real staging API already behaves for an unknown account
— so every existing test user_id (fake or otherwise) keeps behaving
exactly as it did before this file existed. MOCK_USER_ID is kept as the
original single "default" id for backward compatibility with anything
that imported it before multiple profiles existed.

This does not touch tools.py's four tool functions at all — it's a
different server tools.py can optionally be pointed at (see
GOODSCORE_STAGE_BASE_URL in tools.py), not a change to how those tools
work. Run standalone:

    python -m mock_goodscore_api

Then set GOODSCORE_STAGE_BASE_URL=http://localhost:8001 in backend/chat/.env
and restart the chat server.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# The original single user_id this mock recognised, kept for backward
# compatibility with any existing import of MOCK_USER_ID. New code should
# prefer MOCK_USER_IDS (below) to see every available test profile.
MOCK_USER_ID = "demo-user"

app = FastAPI(title="GoodScore Staging API (local mock)")


def _firestore_timestamp(dt: datetime) -> dict:
    """Build the {"_seconds": ..., "_nanoseconds": ...} shape the real
    Firestore-backed staging API returns — matches what tools.py's
    _firestore_to_ist() already expects to convert.
    """
    return {"_seconds": int(dt.timestamp()), "_nanoseconds": 0}


def _not_found() -> JSONResponse:
    # Matches the shape tools.py's _fetch_stage_api() already handles for
    # a 4xx client error — see its CLIENT_ERROR branch.
    return JSONResponse(status_code=404, content={"message": "User not found"})


# ---------------------------------------------------------------------------
# Small builders — turn relative day-offsets into the absolute Firestore
# timestamps / formatted date strings the real staging API returns, so each
# user profile below only has to state offsets ("due in 6 days", "closed 10
# days ago") rather than hardcoded dates that would go stale.
# ---------------------------------------------------------------------------

def _account(lender: str, type_: str, status: str, *, credit_limit: int | None = None,
             outstanding: int | None = None, closed_days_ago: int | None = None) -> dict:
    account = {"lender": lender, "type": type_, "status": status}
    if credit_limit is not None:
        account["creditLimit"] = credit_limit
    if outstanding is not None:
        account["outstandingBalance"] = outstanding
    if closed_days_ago is not None:
        account["closedDate"] = _firestore_timestamp(datetime.now(timezone.utc) - timedelta(days=closed_days_ago))
    return account


def _bill(lender: str, amount: int, due_offset_days: int, status: str, payment_link: str) -> dict:
    due_date = datetime.now(timezone.utc) + timedelta(days=due_offset_days)
    return {
        "lender": lender,
        "amount": amount,
        "dueDate": due_date.strftime("%d %B %Y"),
        "status": status,
        "paymentLink": payment_link,
    }


def _subscription(plan: str, status_text: str, autopay: bool, valid_till_offset_days: int) -> dict:
    valid_till = datetime.now(timezone.utc) + timedelta(days=valid_till_offset_days)
    return {
        "status": True,
        "plan": plan,
        "validTill": valid_till.strftime("%d %B %Y"),
        "status_text": status_text,
        "autopay": autopay,
    }


def _transaction(amount: int, type_: str, status: str, day_offset: int) -> dict:
    day = datetime.now(timezone.utc) - timedelta(days=day_offset)
    return {"date": _firestore_timestamp(day), "amount": amount, "type": type_, "status": status}


# ---------------------------------------------------------------------------
# User profiles — one entry per mock user_id per endpoint. Each is a
# zero-arg callable (not a plain dict) so every date/timestamp is computed
# fresh relative to "now" on each request, same as the original single-user
# version did.
#
# | user_id               | tests...                                          |
# |-----------------------|----------------------------------------------------|
# | demo-user              | the default "typical" mixed profile (unchanged)   |
# | demo-user-excellent    | clean profile — no bills, no failed/dup charges   |
# | demo-user-risk         | overdue bills, lapsed subscription, refresh-ready |
# | demo-user-newuser      | thin file — one account, no bills, no history     |
# ---------------------------------------------------------------------------

_CREDIT_REPORTS = {
    "demo-user": lambda: {
        "status": True,
        "score": 742,
        "bureau": "Equifax",
        # 22 days old — deliberately inside the 30-day refresh-eligibility
        # window (see prompt.py SECTION 3's "Report refresh" rule) so a
        # "can I refresh my score" question exercises the "not ready yet"
        # business logic.
        "lastUpdatedAt": _firestore_timestamp(datetime.now(timezone.utc) - timedelta(days=22)),
        "accounts": [
            _account("HDFC Bank", "Credit Card", "Active", credit_limit=150000, outstanding=32000),
            _account("Bajaj Finserv", "Personal Loan", "Active", outstanding=85000),
            _account("ICICI Bank", "Auto Loan", "Closed", closed_days_ago=10),
        ],
    },
    "demo-user-excellent": lambda: {
        "status": True,
        "score": 812,
        "bureau": "CIBIL",
        "lastUpdatedAt": _firestore_timestamp(datetime.now(timezone.utc) - timedelta(days=12)),
        "accounts": [
            _account("SBI Card", "Credit Card", "Active", credit_limit=300000, outstanding=8000),
            _account("HDFC Bank", "Home Loan", "Active", outstanding=1200000),
        ],
    },
    "demo-user-risk": lambda: {
        "status": True,
        "score": 561,
        "bureau": "CIBIL",
        # 40 days old — past the 30-day refresh-eligibility window, the
        # opposite case from demo-user, so "can I refresh" should say yes.
        "lastUpdatedAt": _firestore_timestamp(datetime.now(timezone.utc) - timedelta(days=40)),
        "accounts": [
            _account("ICICI Bank", "Credit Card", "Active", credit_limit=50000, outstanding=46000),
            _account("Bajaj Finserv", "Personal Loan", "Active", outstanding=120000),
            _account("HDFC Bank", "Personal Loan", "Written Off", closed_days_ago=5),
        ],
    },
    "demo-user-newuser": lambda: {
        "status": True,
        "score": 650,
        "bureau": "Experian",
        "lastUpdatedAt": _firestore_timestamp(datetime.now(timezone.utc) - timedelta(days=3)),
        "accounts": [
            _account("SBI Card", "Credit Card", "Active", credit_limit=25000, outstanding=1200),
        ],
    },
}

_BILLS = {
    "demo-user": lambda: [
        _bill("HDFC Personal Loan", 4500, 6, "upcoming", "https://pay.example.com/mock/hdfc-personal-loan"),
        _bill("Bajaj Finserv EMI", 1200, -3, "overdue", "https://pay.example.com/mock/bajaj-emi"),
    ],
    "demo-user-excellent": lambda: [],
    "demo-user-risk": lambda: [
        _bill("ICICI Credit Card", 15400, -12, "overdue", "https://pay.example.com/mock/icici-cc"),
        _bill("Bajaj Finserv EMI", 8200, -2, "overdue", "https://pay.example.com/mock/bajaj-emi-2"),
    ],
    "demo-user-newuser": lambda: [],
}

_SUBSCRIPTIONS = {
    "demo-user": lambda: _subscription("Premium", "active", True, 45),
    "demo-user-excellent": lambda: _subscription("Premium", "active", True, 60),
    # Lapsed 5 days ago after a failed autopay charge — autopay off.
    "demo-user-risk": lambda: _subscription("Premium", "payment_failed", False, -5),
    "demo-user-newuser": lambda: _subscription("Basic", "active", False, 20),
}

_TRANSACTIONS = {
    "demo-user": lambda: [
        # Two identical charges on the same day — a duplicate-charge
        # scenario, so a "was I charged twice" question has something
        # real to find.
        _transaction(499, "subscription", "success", 6),
        _transaction(499, "subscription", "success", 6),
    ],
    "demo-user-excellent": lambda: [
        _transaction(699, "subscription", "success", 15),
    ],
    "demo-user-risk": lambda: [
        _transaction(699, "subscription", "failed", 5),
    ],
    "demo-user-newuser": lambda: [],
}

MOCK_USER_IDS = frozenset(_CREDIT_REPORTS)


@app.post("/subscription/getCreditReportV3")
async def get_credit_report(request: Request):
    body = await request.json()
    builder = _CREDIT_REPORTS.get(body.get("userId"))
    if builder is None:
        return _not_found()
    return builder()


@app.post("/subscription/getPreFetchedBillNew")
async def get_prefetched_bills(request: Request):
    body = await request.json()
    builder = _BILLS.get(body.get("userId"))
    if builder is None:
        return _not_found()
    return {"status": True, "bills": builder()}


@app.post("/autopay/action/homepage")
async def get_subscription_details(request: Request):
    body = await request.json()
    builder = _SUBSCRIPTIONS.get(body.get("userId"))
    if builder is None:
        return _not_found()
    return builder()


@app.post("/subscription/getOverallTransactionHistory")
async def get_transaction_history(request: Request):
    body = await request.json()
    builder = _TRANSACTIONS.get(body.get("userId"))
    if builder is None:
        return _not_found()
    return {"transactions": builder()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("mock_goodscore_api:app", host="127.0.0.1", port=8001, reload=False)
