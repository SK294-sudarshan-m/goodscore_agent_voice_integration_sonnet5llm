"""Tests for the local GoodScore staging API stand-in.

Confirms: the recognised mock user gets realistic data from all four
endpoints, matching the shapes tools.py's real tools already expect
(including raw Firestore-style timestamps where the real API uses them);
any other user_id gets a 404, same as the real staging API would for an
unknown account.
"""
from fastapi.testclient import TestClient

from mock_goodscore_api import MOCK_USER_ID, app

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
