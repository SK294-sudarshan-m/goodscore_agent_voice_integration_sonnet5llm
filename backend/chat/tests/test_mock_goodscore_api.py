"""Tests for the local GoodScore staging API stand-in.

Confirms: each recognised mock user gets realistic, distinguishable data
from all four endpoints, matching the shapes tools.py's real tools already
expect (including raw Firestore-style timestamps where the real API uses
them); any other user_id gets a 404, same as the real staging API would
for an unknown account.
"""
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from mock_goodscore_api import MOCK_USER_ID, MOCK_USER_IDS, app

client = TestClient(app)

ENDPOINTS = [
    "/subscription/getCreditReportV3",
    "/subscription/getPreFetchedBillNew",
    "/autopay/action/homepage",
    "/subscription/getOverallTransactionHistory",
]


def test_unknown_user_id_gets_404_on_every_endpoint():
    for path in ENDPOINTS:
        response = client.post(path, json={"userId": "someone-else"})
        assert response.status_code == 404, path


def test_credit_report_shape_for_mock_user():
    response = client.post("/subscription/getCreditReportV3", json={"userId": MOCK_USER_ID})
    assert response.status_code == 200
    data = response.json()
    assert data["score"] == 742
    assert data["bureau"] == "Equifax"
    assert "_seconds" in data["lastUpdatedAt"]


def test_bills_shape_has_one_upcoming_and_one_overdue():
    response = client.post("/subscription/getPreFetchedBillNew", json={"userId": MOCK_USER_ID})
    assert response.status_code == 200
    statuses = {b["status"] for b in response.json()["bills"]}
    assert statuses == {"upcoming", "overdue"}


def test_subscription_shape_matches_flow_doc_field_names():
    """Field names (plan, validTill, status) match the confirmed example
    in GoodScore_Flow_001 section 7.4, not guessed names.
    """
    response = client.post("/autopay/action/homepage", json={"userId": MOCK_USER_ID})
    assert response.status_code == 200
    data = response.json()
    assert data["plan"] == "Premium"
    assert "validTill" in data


def test_transaction_history_has_duplicate_charge_scenario():
    response = client.post("/subscription/getOverallTransactionHistory", json={"userId": MOCK_USER_ID})
    assert response.status_code == 200
    txns = response.json()["transactions"]
    assert len(txns) == 2
    assert txns[0]["amount"] == txns[1]["amount"] == 499
    assert txns[0]["date"] == txns[1]["date"]  # same-day duplicate


def test_four_distinct_user_profiles_exist():
    assert MOCK_USER_IDS == {
        "demo-user", "demo-user-excellent", "demo-user-risk", "demo-user-newuser",
    }


def test_every_profile_returns_200_on_every_endpoint():
    for user_id in MOCK_USER_IDS:
        for path in ENDPOINTS:
            response = client.post(path, json={"userId": user_id})
            assert response.status_code == 200, (user_id, path)


def test_excellent_user_has_no_bills_and_no_failed_or_duplicate_charges():
    bills = client.post(
        "/subscription/getPreFetchedBillNew", json={"userId": "demo-user-excellent"}
    ).json()["bills"]
    assert bills == []

    txns = client.post(
        "/subscription/getOverallTransactionHistory", json={"userId": "demo-user-excellent"}
    ).json()["transactions"]
    assert all(t["status"] == "success" for t in txns)
    assert len({t["date"]["_seconds"] for t in txns}) == len(txns)  # no same-day duplicates


def test_risk_user_has_only_overdue_bills_and_is_refresh_eligible():
    bills = client.post(
        "/subscription/getPreFetchedBillNew", json={"userId": "demo-user-risk"}
    ).json()["bills"]
    assert bills  # at least one bill
    assert {b["status"] for b in bills} == {"overdue"}

    report = client.post(
        "/subscription/getCreditReportV3", json={"userId": "demo-user-risk"}
    ).json()
    # >=30 days old, unlike demo-user's 22 — the opposite refresh-eligibility case.
    age_days = (datetime.now(timezone.utc).timestamp() - report["lastUpdatedAt"]["_seconds"]) / 86400
    assert age_days >= 30

    subscription = client.post(
        "/autopay/action/homepage", json={"userId": "demo-user-risk"}
    ).json()
    assert subscription["status_text"] == "payment_failed"
    assert subscription["autopay"] is False


def test_newuser_has_thin_file_and_no_history():
    report = client.post(
        "/subscription/getCreditReportV3", json={"userId": "demo-user-newuser"}
    ).json()
    assert len(report["accounts"]) == 1

    bills = client.post(
        "/subscription/getPreFetchedBillNew", json={"userId": "demo-user-newuser"}
    ).json()["bills"]
    assert bills == []

    txns = client.post(
        "/subscription/getOverallTransactionHistory", json={"userId": "demo-user-newuser"}
    ).json()["transactions"]
    assert txns == []
