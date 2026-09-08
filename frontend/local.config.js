// local.config.js — local development overrides only.
//
// app.js already supports window.API_BASE_URL as an external override
// (falls back to the production Lambda URL if unset); this just uses
// that existing hook to point the chat UI at backend/chat/server.py's
// dev endpoints (no passcode broker, no AWS) when testing on this
// machine. voice.js reads window.VOICE_WS_URL the same way.
//
// Not meant for production — a real deployment sets these via its own
// build/config process, and the `||` fallbacks mean this file changes
// nothing once that happens.
window.API_BASE_URL = window.API_BASE_URL || "http://localhost:8000";
window.VOICE_WS_URL = window.VOICE_WS_URL || "ws://localhost:8090/v1/voice/stream";
