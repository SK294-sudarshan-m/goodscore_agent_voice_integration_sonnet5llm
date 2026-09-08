"""Regression test for the additive GOODSCORE_STAGE_BASE_URL override.

Proves the default (env var unset, every existing deployment) is
byte-for-byte the same staging URL that was hardcoded in tools.py before
this override existed.
"""
import importlib

import tools as tools_module


def test_default_stage_base_is_unchanged_when_env_var_unset(monkeypatch):
    monkeypatch.delenv("GOODSCORE_STAGE_BASE_URL", raising=False)
    importlib.reload(tools_module)

    assert tools_module._STAGE_BASE == "https://subscription.stage.goodscore.io"


def test_stage_base_honours_override_when_set(monkeypatch):
    monkeypatch.setenv("GOODSCORE_STAGE_BASE_URL", "http://localhost:8001")
    importlib.reload(tools_module)

    assert tools_module._STAGE_BASE == "http://localhost:8001"

    # Restore the real default for any test that runs after this one in
    # the same process — reload again with the override removed.
    monkeypatch.delenv("GOODSCORE_STAGE_BASE_URL", raising=False)
    importlib.reload(tools_module)
