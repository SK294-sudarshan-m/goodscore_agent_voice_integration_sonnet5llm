// local.config.js — environment config for the chat/voice UI.
//
// app.js already supports window.API_BASE_URL as an external override
// (falls back to the production Lambda URL if unset); this just uses
// that existing hook to point the chat UI at backend/chat/server.py's
// dev endpoints (no passcode broker, no AWS) when testing on this
// machine. voice.js reads window.VOICE_WS_URL the same way.
//
// Hostname-aware so the SAME file works both when served locally
// (python -m http.server 3000) and when deployed to Cloudflare Pages —
// on localhost/127.0.0.1 it points at your local backend ports; on any
// other hostname (the deployed Pages domain) it points at the deployed
// Cloudflare Worker URLs below. The `||` fallbacks mean nothing changes
// if something else already set these first.
(function () {
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);

  // Fill these in with the URLs Cloudflare gives the chat and voice
  // Workers once they're deployed (see CLOUDFLARE_DEPLOY.md) —
  // e.g. "https://goodscore-chat.<your-subdomain>.workers.dev".
  const DEPLOYED_API_BASE_URL = "https://REPLACE_WITH_CHAT_WORKER_URL";
  const DEPLOYED_VOICE_WS_URL = "wss://REPLACE_WITH_VOICE_WORKER_URL/v1/voice/stream";

  window.API_BASE_URL = window.API_BASE_URL ||
    (isLocal ? "http://localhost:8000" : DEPLOYED_API_BASE_URL);
  window.VOICE_WS_URL = window.VOICE_WS_URL ||
    (isLocal ? "ws://localhost:8090/v1/voice/stream" : DEPLOYED_VOICE_WS_URL);
})();
