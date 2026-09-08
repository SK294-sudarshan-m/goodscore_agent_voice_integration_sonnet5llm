"""Local stand-in for the real GoodScore staging API, for testing without
a real staging account.

Serves the same four paths backend/chat/tools.py's existing customer-data
tools call (get_credit_report, get_prefetched_bills, get_subscription_details,
get_transaction_history) — same request shape ({"userId": ...}), same
response shape (including raw Firestore-style timestamps where the real
API uses them, since prompt.py's own business rules expect tools.py's
_firestore_to_ist() to do that conversion, not the API itself).

Only recognises MOCK_USER_ID (see below); every other user_id gets a 404,
matching how the real staging API already behaves for an unknown account
— so every existing test user_id (fake or otherwise) keeps behaving
exactly as it did before this file existed.

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

# The one user_id this mock recognises. Chosen to be obviously fake/local
# rather than reusing a name that could be mistaken for a real account.
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


async def _require_mock_user(request: Request) -> str | None:
    body = await request.json()
    user_id = body.get("userId")
    return user_id if user_id == MOCK_USER_ID else None


@app.post("/subscription/getCreditReportV3")
async def get_credit_report(request: Request):
    if not await _require_mock_user(request):
        return _not_found()

    now = datetime.now(timezone.utc)
    return {
        "status": True,
        "score": 742,
        "bureau": "Equifax",
        # 22 days old — deliberately inside the 30-day refresh-eligibility
        # window (see prompt.py SECTION 3's "Report refresh" rule) so a
        # "can I refresh my score" question exercises that real business
        # logic instead of always saying "not ready yet".
        "lastUpdatedAt": _firestore_timestamp(now - timedelta(days=22)),
        "accounts": [
            {
                "lender": "HDFC Bank",
                "type": "Credit Card",
                "status": "Active",
                "creditLimit": 150000,
                "outstandingBalance": 32000,
            },
            {
                "lender": "Bajaj Finserv",
                "type": "Personal Loan",
                "status": "Active",
                "outstandingBalance": 85000,
            },
            {
                "lender": "ICICI Bank",
                "type": "Auto Loan",
                "status": "Closed",
                "closedDate": _firestore_timestamp(now - timedelta(days=10)),
            },
        ],
    }


@app.post("/subscription/getPreFetchedBillNew")
async def get_prefetched_bills(request: Request):
    if not await _require_mock_user(request):
        return _not_found()

    now = datetime.now(timezone.utc)
    upcoming = now + timedelta(days=6)
    overdue = now - timedelta(days=3)
    return {
        "status": True,
        "bills": [
            {
                "lender": "HDFC Personal Loan",
                "amount": 4500,
                "dueDate": upcoming.strftime("%d %B %Y"),
                "status": "upcoming",
                "paymentLink": "https://pay.example.com/mock/hdfc-personal-loan",
            },
            {
                "lender": "Bajaj Finserv EMI",
                "amount": 1200,
                "dueDate": overdue.strftime("%d %B %Y"),
                "status": "overdue",
                "paymentLink": "https://pay.example.com/mock/bajaj-emi",
            },
        ],
    }


@app.post("/autopay/action/homepage")
async def get_subscription_details(request: Request):
    if not await _require_mock_user(request):
        return _not_found()

    valid_till = datetime.now(timezone.utc) + timedelta(days=45)
    return {
        "status": True,
        "plan": "Premium",
        "validTill": valid_till.strftime("%d %B %Y"),
        "status_text": "active",
        "autopay": True,
    }


@app.post("/subscription/getOverallTransactionHistory")
async def get_transaction_history(request: Request):
    if not await _require_mock_user(request):
        return _not_found()

    # Two identical charges on the same day — a duplicate-charge scenario,
    # so a "was I charged twice" question has something real to find.
    charge_day = datetime.now(timezone.utc) - timedelta(days=6)
    return {
        "transactions": [
            {
                "date": _firestore_timestamp(charge_day),
                "amount": 499,
                "type": "subscription",
                "status": "success",
            },
            {
                "date": _firestore_timestamp(charge_day),
                "amount": 499,
                "type": "subscription",
                "status": "success",
            },
        ]
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("mock_goodscore_api:app", host="127.0.0.1", port=8001, reload=False)
