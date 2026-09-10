# Deploying to Cloudflare (GitHub-connected, always-on, no local Docker)

Connects your **private** GitHub repo directly to Cloudflare. Every push to `main` automatically rebuilds and redeploys chat, voice, and the mock GoodScore API as Containers, and the frontend as a Pages site — all running permanently on Cloudflare's own infrastructure, reachable from anywhere, independent of your machine. The container image build happens on **Cloudflare's own CI**, not your laptop, so you do not need Docker installed locally for this path.

Repo stays private the whole time — Cloudflare's GitHub App only needs repo-scoped read access, same as any other CI integration; it doesn't require or cause the repo to become public.

## Order matters

Deploy in this order, because each later piece needs a URL from an earlier one:
1. mock-api (needs nothing)
2. chat (needs mock-api's URL)
3. voice (needs chat's and mock-api's URLs)
4. frontend / Pages (needs chat's and voice's URLs)
5. one final pass back to chat, to add the frontend's URL to CORS

## 1. Deploy the mock GoodScore API

1. Go to the Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** (the "Connect to Git" flow).
2. Authorize the Cloudflare GitHub App, choosing **"Only select repositories"** → pick this repo (stays private).
3. **Root directory**: `backend/chat/cloudflare/mock-api`
4. Build/deploy settings: Cloudflare will detect `wrangler.jsonc` and use `wrangler deploy` automatically — leave the defaults.
5. Deploy. Copy the resulting Worker URL, e.g. `https://goodscore-mock-api.<your-subdomain>.workers.dev`.

## 2. Deploy the chat backend

1. Edit `backend/chat/cloudflare/chat/wrangler.jsonc` in the repo: set `GOODSCORE_STAGE_BASE_URL` to the mock-api URL from step 1. Leave `EXTRA_CORS_ORIGIN` as-is for now. Commit and push.
2. In Cloudflare: **Workers & Pages** → **Create** → **Import a repository** → same repo → **Root directory**: `backend/chat/cloudflare/chat`.
3. Before the first deploy finishes, add the secret: in this Worker's **Settings → Variables and Secrets**, add `ANTHROPIC_API_KEY` (Type: Secret) with your Anthropic API key (same one from `backend/chat/.env`).
4. Deploy (or redeploy if it already ran once before you added the secret). Copy the URL, e.g. `https://goodscore-chat.<your-subdomain>.workers.dev`.
5. Verify: `curl https://goodscore-chat.<your-subdomain>.workers.dev/api/health` → `{"ok":true,...}`. First hit after a deploy can take a few seconds (cold start).

## 3. Deploy the voice backend

1. Edit `backend/voice/cloudflare/wrangler.jsonc`: set `CHATBOT_LOCAL_BASE_URL` to the chat URL from step 2, and `GOODSCORE_API_BASE_URL` to the mock-api URL from step 1. Commit and push.
2. In Cloudflare: **Create** → **Import a repository** → same repo → **Root directory**: `backend/voice/cloudflare`.
3. Add the secret `OPENROUTER_API_KEY` (Settings → Variables and Secrets) with your OpenRouter key (from `backend/voice/.env`).
4. Deploy. Copy the URL, e.g. `https://goodscore-voice.<your-subdomain>.workers.dev`.
5. Verify: `curl https://goodscore-voice.<your-subdomain>.workers.dev/health` → `{"ok":true,"service":"goodscore-voice-service"}`.

## 4. Deploy the frontend to Cloudflare Pages

1. Edit `frontend/local.config.js`, fill in both placeholders:
   ```js
   const DEPLOYED_API_BASE_URL = "https://goodscore-chat.<your-subdomain>.workers.dev";
   const DEPLOYED_VOICE_WS_URL = "wss://goodscore-voice.<your-subdomain>.workers.dev/v1/voice/stream";
   ```
   (`wss://`, not `https://`, for the voice line.) Commit and push.
2. In Cloudflare: **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → same repo.
3. **Root directory**: `frontend`. **Framework preset**: None. **Build command**: (leave empty). **Build output directory**: `/`.
4. Deploy. Copy the `*.pages.dev` URL — that's your public, permanent demo link.

## 5. Close the loop: CORS

1. Edit `backend/chat/cloudflare/chat/wrangler.jsonc` again: set `EXTRA_CORS_ORIGIN` to the `*.pages.dev` URL from step 4. Commit and push — this alone triggers a redeploy of just the chat Worker (Workers Builds watches the whole repo but each Worker only redeploys when its own root directory's files, or files it depends on, change... to be safe, you can also just manually hit "Retry deployment" on the chat Worker in the dashboard after pushing).

## 6. Test it

Open the `*.pages.dev` URL — from any device, any network, no dependency on your machine being on. Same UI, same test users (`demo-user`, `demo-user-risk`, `demo-user-excellent`, `demo-user-newuser`), same 5 test cases from before.

---

### From now on

Every `git push` to `main` automatically rebuilds and redeploys whichever of these 4 Workers/Pages projects had files change in their root directory — that's the whole point of the GitHub connection. No manual `wrangler deploy`, no Docker, nothing to remember to re-run.

### Notes

- **Cold starts**: containers sleep after inactivity (`sleepAfter` in each `src/index.js`) and take a couple seconds to wake on the next request. Normal for this platform.
- **Token usage logs**: voice's `TOKEN_USAGE_LOG_DIR` is `/tmp/...` inside the container — doesn't persist across redeploys/restarts. Fine for a demo.
- **Updating a secret later**: Worker's Settings → Variables and Secrets → edit, or `npx wrangler secret put <NAME>` if you ever want to do it from the CLI instead.
