// GoodScore support-agent demo — frontend.
// Streams the agent loop over SSE, renders the chat, and mirrors every tool
// call into the "Behind the scenes" trace so the architecture is visible.

function normalizeApiUrl(url) {
  if (url.includes("/runtimes/arn:aws:")) {
    const match = url.match(/\/runtimes\/(arn:aws:.*?)\/invocations/);
    if (match && match[1]) {
      const rawArn = match[1];
      const encodedArn = encodeURIComponent(rawArn);
      return url.replace(`/runtimes/${rawArn}/invocations`, `/runtimes/${encodedArn}/invocations`);
    }
  }
  return url;
}

const RAW_API_BASE_URL = window.API_BASE_URL || "https://srxy5honffizpzdqjrfme4uxeu0qsegp.lambda-url.ap-south-1.on.aws/";
const API_BASE_URL = normalizeApiUrl(RAW_API_BASE_URL);
const isAgentCore = API_BASE_URL.includes("/invocations") || API_BASE_URL.includes("lambda-url");

const $ = (id) => document.getElementById(id);
const chat = $("chat");
const traceLog = $("traceLog");
const input = $("input");
const sendBtn = $("send");
const passcodeInput = $("passcodeInput");
const togglePasscodeBtn = $("togglePasscodeBtn");

if (togglePasscodeBtn && passcodeInput) {
  togglePasscodeBtn.addEventListener("click", () => {
    const isPassword = passcodeInput.type === "password";
    passcodeInput.type = isPassword ? "text" : "password";
    togglePasscodeBtn.classList.toggle("active", isPassword);
    togglePasscodeBtn.title = isPassword ? "Hide Passcode" : "Show Passcode";
  });
}

const userIdInput = $("userIdInput");
const setUserBtn = $("setUserBtn");

if (userIdInput && setUserBtn) {
  userIdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setUserBtn.click();
    }
  });
}

if (passcodeInput && setUserBtn) {
  passcodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setUserBtn.click();
    }
  });
}

let currentUser = null;
let busy = false;


function checkServedOverHttp() {
  if (location.protocol === "file:") {
    document.body.innerHTML = `
      <div style="max-width:560px;margin:14vh auto;font-family:Inter,sans-serif;
                  background:#fff;border:1px solid #e2e9f2;border-radius:16px;
                  padding:32px 36px;box-shadow:0 20px 50px rgba(15,27,45,0.12);color:#0f1b2d">
        <div style="font-size:20px;font-weight:800;margin-bottom:10px">Open the demo through the server</div>
        <p style="color:#5b6b82;font-size:14px;line-height:1.6;margin-bottom:16px">
          This page is being opened directly from a file, so it can't reach the
          backend. Start the server, then open the URL below.</p>
        <div style="background:#0a0c10;color:#5eead4;font-family:'JetBrains Mono',monospace;
                    font-size:13px;border-radius:10px;padding:14px 16px;margin-bottom:14px">
          cd goodscore-demo &amp;&amp; ./run.sh</div>
        <a href="http://127.0.0.1:8080" style="display:inline-block;background:#00b386;color:#fff;
                  text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px">
          Open http://127.0.0.1:8080</a>
      </div>`;
    return false;
  }
  return true;
}

// --- tool categorisation ---
const TOOL_CAT = {
  get_credit_report: "read",
  get_prefetched_bills: "read",
  get_subscription_details: "read",
  search_knowledge_base: "kb",
  get_user_account: "read",
  get_order_status: "read",
  get_flow_content: "read",
  check_eligibility: "gate",
  create_ticket: "act",
  send_chip_response: "pres",
  get_deeplinks: "pres",
  localise_content: "pres",
};
const CAT_LABEL = { read: "READ", kb: "KB", gate: "BINDING GATE", act: "ACTION", pres: "PRESENT" };
const PRESENTATION_TOOLS = new Set(["send_chip_response", "get_deeplinks"]);

// === User Management =======================================================
function setUser() {
  const userId = userIdInput.value.trim();
  const passcodeVal = passcodeInput ? passcodeInput.value.trim() : "";

  if (!userId) {
    userIdInput.focus();
    userIdInput.style.borderColor = "#f87171";
    setTimeout(() => { userIdInput.style.borderColor = ""; }, 1500);
    return;
  }

  if (!passcodeVal) {
    if (passcodeInput) {
      passcodeInput.focus();
      passcodeInput.style.borderColor = "#f87171";
      passcodeInput.placeholder = "Required";
      setTimeout(() => { passcodeInput.style.borderColor = ""; }, 1500);
    }
    return;
  }

  currentUser = userId;
  window.APP_PASSCODE = passcodeVal;
  chat.innerHTML = "";
  traceLog.innerHTML = `<div class="trace-empty">Send a message to watch Claude decide, call tools, and respond.</div>`;
  $("currentUserId").textContent = userId;


  setUserBtn.textContent = "✓ Set";
  setUserBtn.style.background = "#059669";
  setTimeout(() => {
    setUserBtn.textContent = "Set User";
    setUserBtn.style.background = "";
  }, 1500);

  $("suggested").innerHTML = "";
  seedSuggestions();
}

async function loadConfig() {
  if (isAgentCore) {
    $("archModel") && ($("archModel").textContent = "global.anthropic.claude-sonnet-4-6");
    $("regionTag") && ($("regionTag").textContent = "ap-south-1 · Mumbai");
    return;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/health`);
    const data = await res.json();
    $("archModel") && ($("archModel").textContent = data.model || "global.anthropic.claude-sonnet-4-6");
    $("regionTag") && ($("regionTag").textContent = (data.region || "ap-south-1") + (data.region === "ap-south-1" ? " · Mumbai" : ""));
  } catch (e) {
    console.error("Failed to load config:", e);
  }
}

function seedSuggestions() {
  const wrap = $("suggested");
  wrap.innerHTML = "";
  const suggestions = [
    "What is my credit score?",
    "How can I improve my score?",
    "Show me my pending bills",
    "Why did my score drop?",
    "Show me my score trend",
  ];
  suggestions.forEach((s) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = s;
    b.onclick = () => { if (!busy && currentUser) send(s); };
    wrap.appendChild(b);
  });
}

setUserBtn.onclick = setUser;
userIdInput.onkeydown = (e) => { if (e.key === "Enter") setUser(); };

$("resetBtn").onclick = async () => {
  if (!currentUser) { alert("Please set a user ID first"); return; }
  if (isAgentCore) {
    // Tell the backend to reset — Lambda signs and forwards action:reset
    // Backend calls _new_session(user_id) which evicts the old Agent and creates a fresh session.
    const passcodeVal = (passcodeInput && passcodeInput.value.trim()) || window.APP_PASSCODE || "";
    try {
      await fetch(API_BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", user_id: currentUser, passcode: passcodeVal })
      });
    } catch (_) { }
  } else {
    try {
      await fetch(`${API_BASE_URL}/api/reset`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: currentUser }),
      });
    } catch (_) { }
  }
  chat.innerHTML = "";
  traceLog.innerHTML = `<div class="trace-empty">Send a message to watch Claude decide, call tools, and respond.</div>`;
  seedSuggestions();
};

// === Chat rendering =======================================================
function addMsg(text, who) {
  const el = document.createElement("div");
  el.className = "msg " + who;
  el.innerHTML = who === "bot" ? mdLite(text) : escapeHtml(text);
  chat.appendChild(el);
  scrollChat();
  return el;
}
function scrollChat() { chat.scrollTop = chat.scrollHeight; }
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function mdLite(s) {
  // Process block-level elements on the full string first (before escaping)
  // Split into lines to detect lists, tables, and headings
  const lines = s.split("\n");
  const outputParts = [];
  let i = 0;

  const formatLineText = (text) => inlineFormat(escapeHtml(text));

  while (i < lines.length) {
    const line = lines[i];

    // --- Markdown table detection ---
    // A table starts with a | line, followed by a |---| separator line
    if (
      line.trim().startsWith("|") &&
      i + 1 < lines.length &&
      /^\|[\s\-:|]+\|/.test(lines[i + 1].trim())
    ) {
      // Collect all consecutive | lines as the table
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      outputParts.push(renderTable(tableLines));
      continue;
    }

    // --- Heading detection (### ## #) ---
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length + 2; // h3-h5 range
      const text = formatLineText(headingMatch[2]);
      outputParts.push(`<h${level} style="margin:8px 0 4px;font-size:${16 - headingMatch[1].length}px">${text}</h${level}>`);
      i++;
      continue;
    }

    // --- Horizontal rule ---
    if (/^[-*_]{3,}$/.test(line.trim())) {
      outputParts.push('<hr style="border:none;border-top:1px solid #e2e9f2;margin:8px 0">');
      i++;
      continue;
    }

    // --- List item detection ---
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)/);
    if (listMatch) {
      const listLines = [];
      while (i < lines.length) {
        const match = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)/);
        if (match) {
          listLines.push({
            indent: match[1].length,
            marker: match[2],
            content: match[3],
          });
          i++;
        } else if (lines[i].trim() === "") {
          if (i + 1 < lines.length && lines[i + 1].match(/^(\s*)([-*+]|\d+\.)\s+(.*)/)) {
            // Empty line inside lists is treated as a list spacer
            i++;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      outputParts.push(renderList(listLines));
      continue;
    }

    // --- Normal line ---
    if (line.trim() === "") {
      outputParts.push("<br>");
    } else {
      let content = formatLineText(line);
      let needsBreak = true;
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (
          nextLine === "" ||
          nextLine.startsWith("|") ||
          /^(#{1,3})\s+/.test(nextLine) ||
          /^[-*_]{3,}$/.test(nextLine) ||
          /^([-*+]|\d+\.)\s+/.test(nextLine)
        ) {
          needsBreak = false;
        }
      } else {
        needsBreak = false;
      }
      outputParts.push(content + (needsBreak ? "<br>" : ""));
    }
    i++;
  }

  // Join parts without any raw newline characters, avoiding pre-wrap rendering issues in the browser
  return outputParts.join("");
}

function renderList(listLines) {
  const stack = []; // elements represent { type: 'ul'|'ol', indent: number }
  let html = "";

  listLines.forEach(item => {
    const isOrdered = /^\d+\.$/.test(item.marker);
    const type = isOrdered ? "ol" : "ul";
    const indent = item.indent;

    if (stack.length === 0) {
      stack.push({ type, indent });
      html += `<${type}>`;
    } else {
      let top = stack[stack.length - 1];
      if (indent > top.indent) {
        stack.push({ type, indent });
        html += `<${type}>`;
      } else {
        while (stack.length > 0 && indent < stack[stack.length - 1].indent) {
          const popped = stack.pop();
          html += `</${popped.type}>`;
        }
        if (stack.length > 0) {
          top = stack[stack.length - 1];
          if (top.type !== type) {
            stack.pop();
            html += `</${top.type}><${type}>`;
            stack.push({ type, indent });
          }
        } else {
          stack.push({ type, indent });
          html += `<${type}>`;
        }
      }
    }

    const formattedContent = inlineFormat(escapeHtml(item.content));
    html += `<li>${formattedContent}</li>`;
  });

  while (stack.length > 0) {
    const popped = stack.pop();
    html += `</${popped.type}>`;
  }

  return html;
}

function inlineFormat(t) {
  // Bold
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  t = t.replace(/\*([^*]+?)\*/g, "<em>$1</em>");
  // Inline code
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  return t;
}

// Cheap renderer used during streaming — no table parsing, just bold + linebreaks.
// Keeps every text_delta update fast regardless of response length.
function streamingRender(s) {
  let t = escapeHtml(s);
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  return t.replace(/\n/g, "<br>");
}

function renderTable(lines) {
  // lines[0] = header row, lines[1] = separator, lines[2..] = data rows
  const parseRow = (line) =>
    line.split("|")
      .slice(1, -1)  // drop empty first/last from leading/trailing |
      .map(cell => inlineFormat(escapeHtml(cell.trim())));

  const headers = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);

  const thHtml = headers
    .map(h => `<th style="padding:6px 12px;text-align:left;border-bottom:2px solid #e2e9f2;font-weight:600;white-space:nowrap">${h}</th>`)
    .join("");

  const trHtml = rows.map((cells, ri) => {
    const tdHtml = cells
      .map(c => `<td style="padding:6px 12px;border-bottom:1px solid #f0f4f8;vertical-align:top">${c}</td>`)
      .join("");
    const bg = ri % 2 === 0 ? "" : 'style="background:#f8fafc"';
    return `<tr ${bg}>${tdHtml}</tr>`;
  }).join("");

  return `<div style="overflow-x:auto;margin:6px 0"><table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #e2e9f2;border-radius:6px;overflow:hidden"><thead><tr style="background:#f1f5f9">${thHtml}</tr></thead><tbody>${trHtml}</tbody></table></div>`;
}

function showTyping() {
  const el = document.createElement("div");
  el.className = "typing"; el.id = "typing";
  el.innerHTML = "<span></span><span></span><span></span>";
  chat.appendChild(el); scrollChat();
}
function hideTyping() { const t = $("typing"); if (t) t.remove(); }

function showToolInline(name) {
  hideToolInline();
  const el = document.createElement("div");
  el.className = "tool-inline"; el.id = "toolinline";
  el.innerHTML = `<span class="spin"></span> calling <b style="margin-left:3px">${escapeHtml(name)}()</b>`;
  chat.appendChild(el); scrollChat();
}
function hideToolInline() { const t = $("toolinline"); if (t) t.remove(); }

function renderChips(chips, deeplinks) {
  if (!chips || !chips.length) return;
  const wrap = document.createElement("div");
  wrap.className = "chips";
  chips.forEach((c) => {
    const b = document.createElement("button");
    const isDeep = deeplinks && deeplinks[c];
    b.className = "chip" + (isDeep ? " deeplink" : "");
    b.textContent = c;
    b.onclick = () => {
      if (busy) return;
      if (isDeep) flashDeeplink(deeplinks[c]);
      else send(c);
    };
    wrap.appendChild(b);
  });
  chat.appendChild(wrap); scrollChat();
}
function flashDeeplink(url) {
  // tel: links → open directly (mobile dialer)
  // https: links → open in new tab
  if (url.startsWith("tel:")) {
    window.location.href = url;
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// === Trace rendering ======================================================
function clearTraceEmpty() { const e = traceLog.querySelector(".trace-empty"); if (e) e.remove(); }
function trim(s, n) { return s.length > n ? s.slice(0, n) + "\n…" : s; }

/**
 * Compact JSON — single-line for small objects, pretty for larger ones.
 * Matches the image: no wrapping labels, just raw JSON text blocks.
 */
function fmtJson(obj) {
  const s = JSON.stringify(obj);
  // Use compact single-line for small payloads, pretty for larger
  return s.length <= 120 ? s : JSON.stringify(obj, null, 2);
}

/**
 * Add a tool card to the trace panel.
 * Layout matches the target image:
 *   [tool_name()]              [BADGE]
 *   {input json — compact}
 *
 *   {output json — teal, with running… spinner until resolved}
 */
function traceTool(toolUseId, name, args) {
  clearTraceEmpty();
  const cat = TOOL_CAT[name] || "read";
  const el = document.createElement("div");
  el.className = "te " + cat;
  el.dataset.toolUseId = toolUseId;
  el.dataset.toolName = name;

  // Input block — only render if there are args
  const hasArgs = args && Object.keys(args).length > 0;
  const inputHtml = hasArgs
    ? `<div class="te-input">${escapeHtml(fmtJson(args))}</div>`
    : "";

  el.innerHTML = `
    <div class="te-head">
      <span class="te-fn">${escapeHtml(name)}()</span>
      <span class="te-badge ${cat}">${(CAT_LABEL[cat] || cat).toUpperCase()}</span>
    </div>
    ${inputHtml}
    <div class="te-output te-running">
      <span class="spin-sm"></span>&nbsp;running…
    </div>`;

  traceLog.appendChild(el);
  traceLog.scrollTop = traceLog.scrollHeight;
  return el;
}

/**
 * Fill in the output block of a trace card.
 */
function traceResult(el, name, output) {
  const out = el.querySelector(".te-output");
  if (!out) return;
  out.classList.remove("te-running");

  if (name === "check_eligibility" && output && typeof output.offer_allowed === "boolean") {
    const allow = output.offer_allowed;
    if (!allow) el.classList.add("blocked");
    out.innerHTML =
      `<span class="verdict ${allow ? "allow" : "deny"}">${allow ? "offer_allowed ✓" : "offer_allowed ✗"}</span>` +
      `<div style="margin-top:4px;font-size:10.5px">segment: ${escapeHtml(String(output.segment))} · crof_eligible: ${output.crof_eligible}` +
      (output.crof_exclusion_reason ? `<br>reason: ${escapeHtml(output.crof_exclusion_reason)}` : "") +
      `</div>`;
  } else {
    out.textContent = trim(fmtJson(output), 600);
  }
  traceLog.scrollTop = traceLog.scrollHeight;
}

/**
 * Fallback: resolve any still-running presentation cards by name.
 */
function resolvePresCards(pendingTools, chips, deeplinks) {
  for (const [key, card] of Object.entries(pendingTools)) {
    if (!PRESENTATION_TOOLS.has(card.dataset.toolName)) continue;
    const out = card.querySelector(".te-output");
    if (!out || !out.classList.contains("te-running")) continue;
    const payload = card.dataset.toolName === "send_chip_response"
      ? { chips, deeplinks }
      : { deeplinks };
    traceResult(card, card.dataset.toolName, payload);
    delete pendingTools[key];
  }
}

function traceGuardrail(msg) {
  clearTraceEmpty();
  const el = document.createElement("div");
  el.className = "te guard";
  el.innerHTML = `
    <div class="te-head"><span class="te-fn">⛔ guardrail enforced</span></div>
    <div class="te-input" style="color:#fca5a5">${escapeHtml(msg)}</div>`;
  traceLog.appendChild(el);
  traceLog.scrollTop = traceLog.scrollHeight;
}

// === Send / stream ========================================================
async function send(message) {
  if (busy || !message.trim()) return;
  if (!currentUser) {
    userIdInput.focus();
    userIdInput.style.borderColor = "#f87171";
    userIdInput.placeholder = "Set a User ID first ↑";
    setTimeout(() => {
      userIdInput.style.borderColor = "";
      userIdInput.placeholder = "Enter user ID";
    }, 2000);
    return;
  }

  busy = true; sendBtn.disabled = true; input.value = "";
  $("suggested").innerHTML = "";
  addMsg(message, "user");
  showTyping();

  let botEl = null;
  let acc = "";
  let pendingChips = null;
  let renderThrottleTimer = null;
  const pendingTools = {}; // toolUseId -> card element

  try {
    const passcodeVal = (passcodeInput && passcodeInput.value.trim()) || window.APP_PASSCODE || "";
    window.APP_PASSCODE = passcodeVal;

    // -----------------------------------------------------------------------
    // Step 1: Send Passcode & Prompt to Lambda to generate SigV4 Signature
    // -----------------------------------------------------------------------
    let targetFetchUrl = API_BASE_URL;
    let reqHeaders = { "Content-Type": "application/json" };
    let bodyStr = JSON.stringify({ prompt: message, user_id: currentUser, passcode: passcodeVal });

    if (isAgentCore) {
      console.debug("[STEP 1: SIGNING] Requesting SigV4 signature for prompt payload...");
      const signRes = await fetch(API_BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: passcodeVal, prompt: message, user_id: currentUser })
      });

      if (!signRes.ok) {
        hideTyping();
        addMsg("⚠️ Type a correct passcode.", "bot");
        return;
      }

      let signData = await signRes.json();
      if (signData && signData.body) {
        try {
          signData = typeof signData.body === "string" ? JSON.parse(signData.body) : signData.body;
        } catch (_) { }
      }

      if (signData && signData.authenticated && (signData.target_url || signData.presigned_url)) {
        targetFetchUrl = signData.target_url || signData.presigned_url;
        if (signData.headers) reqHeaders = signData.headers;
        if (signData.raw_body) {
          bodyStr = signData.raw_body;
        } else if (signData.payload) {
          bodyStr = JSON.stringify(signData.payload);
        }
        console.debug("✅ [STEP 1 SUCCESS] Header SigV4 calculated by Lambda:", targetFetchUrl, reqHeaders);
      } else {
        hideTyping();
        addMsg("⚠️ Type a correct passcode.", "bot");
        return;
      }
    } else {
      // Local dev server (backend/chat/server.py's /api/chat) — no Lambda
      // signing, matches its ChatRequest model: {user_id, message}.
      targetFetchUrl = `${API_BASE_URL}/api/chat`;
      bodyStr = JSON.stringify({ user_id: currentUser, message: message });
    }

    // -----------------------------------------------------------------------
    // Step 2: Send Prompt Payload DIRECTLY from Browser to Bedrock AgentCore
    // (Lambda performs ZERO response proxying — browser streams directly!)
    // -----------------------------------------------------------------------
    console.debug("[STEP 2: DIRECT STREAM] Sending prompt payload directly to backend:", targetFetchUrl);
    const res = await fetch(targetFetchUrl, {
      method: "POST",
      headers: reqHeaders,
      body: bodyStr,
    });

    if (!res.ok) {
      const errText = await res.text();
      let errDetail = errText;
      try {
        const parsedErr = JSON.parse(errText);
        errDetail = parsedErr.message || parsedErr.error || parsedErr.details || errText;
      } catch (_) { }
      hideTyping();
      addMsg("⚠️ Server Error (" + res.status + "): " + errDetail, "bot");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = ""; // Accumulates incoming chunks into complete lines

    function processSingleBlob(parsed) {
      if (!parsed || typeof parsed !== "object") return false;
      // Unwrap Lambda proxy envelope if present
      if (parsed.body) {
        let bodyContent = parsed.body;
        // Try JSON parse first (normal JSON body)
        try {
          const inner = typeof bodyContent === "string" ? JSON.parse(bodyContent) : bodyContent;
          if (inner && typeof inner === "object") {
            parsed = inner;
            bodyContent = null; // successfully unwrapped
          }
        } catch (_) {
          // body is NOT JSON — check if it's raw SSE text (data: {...}\n\n format)
          if (typeof bodyContent === "string" && bodyContent.includes("data:")) {
            console.debug("[SSE BLOB] Parsing raw SSE body from Lambda envelope");
            const sseLines = bodyContent.split(/\r?\n/);
            for (const rawLine of sseLines) {
              const line = rawLine.replace(/^data:\s*/, "").trim();
              if (!line || !line.startsWith("{")) continue;
              try {
                const ev = JSON.parse(line);
                handleEvent(ev);
              } catch (_2) { }
            }
            return true; // handled!
          }
        }
      }
      if (!parsed.type && (parsed.text || parsed.message || parsed.chips || parsed.trace)) {
        if (Array.isArray(parsed.trace)) {
          for (const t of parsed.trace) handleEvent(t);
        }
        const text = parsed.text || parsed.message || parsed.response || "";
        if (text) {
          handleEvent({ type: "text_delta", text: text });
        }
        const chips = parsed.chips || [];
        const deeplinks = parsed.deeplinks || {};
        if (chips.length) {
          handleEvent({ type: "chips", chips, deeplinks, pres_tool_ids: {} });
        }
        handleEvent({ type: "done", text: "" });
        return true;
      }
      return false;
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });

      // Process every complete line immediately as it arrives
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop(); // Keep remaining incomplete tail in buffer

      for (const rawLine of lines) {
        const line = rawLine.replace(/^data:\s*/, "").trim();
        if (!line) continue;

        console.debug("[SSE RAW]", line.substring(0, 120)); // DEBUG

        if (line.startsWith("{")) {
          try {
            const parsed = JSON.parse(line);
            console.debug("[SSE EVENT]", parsed.type, parsed.text ? parsed.text.substring(0, 40) : ""); // DEBUG
            if (processSingleBlob(parsed)) continue;
            handleEvent(parsed);
            continue;
          } catch (parseErr) {
            console.warn("[SSE PARSE ERR]", parseErr.message, line.substring(0, 80));
          }
        }

        const ev = parseEventPayload(line);
        if (ev) handleEvent(ev);
      }
    }

    lineBuffer += decoder.decode(); // final flush of decoder
    if (lineBuffer.trim()) {
      const line = lineBuffer.replace(/^data:\s*/, "").trim();
      if (line) {
        let parsed = null;
        if (line.startsWith("{")) {
          try { parsed = JSON.parse(line); } catch (_) { }
        }
        if (!parsed) parsed = parseEventPayload(line);

        if (parsed) {
          if (!processSingleBlob(parsed)) {
            handleEvent(parsed);
          }
        }
      }
    }
  } catch (e) {
    hideTyping();
    addMsg("⚠️ Connection error: " + e.message, "bot");
  } finally {
    busy = false; sendBtn.disabled = false; input.focus();
  }

  function parseEventPayload(raw) {
    if (!raw) return null;
    let cleaned = typeof raw === "string" ? raw.replace(/^data:\s*/, "").trim() : raw;
    if (!cleaned) return null;

    if (typeof cleaned === "string" && (cleaned.startsWith('"') || cleaned.startsWith('{'))) {
      try {
        let p = JSON.parse(cleaned);
        if (typeof p === "string") {
          p = p.replace(/^data:\s*/, "").trim();
          try { p = JSON.parse(p); } catch (_) { }
        }
        cleaned = p;
      } catch (_) { }
    }

    let parsed = null;
    if (typeof cleaned === "object" && cleaned !== null) {
      parsed = cleaned;
    } else if (typeof cleaned === "string") {
      try {
        parsed = JSON.parse(cleaned);
      } catch (_) {
        // Plain string text chunk -> treat as text_delta for live streaming
        return { type: "text_delta", text: cleaned };
      }
    }

    if (parsed && typeof parsed === "object") {
      // Unwrap Lambda Proxy Response format: { statusCode: 200, body: "..." }
      if (parsed.body) {
        let innerBody = parsed.body;
        if (typeof innerBody === "string") {
          try { innerBody = JSON.parse(innerBody); } catch (_) { }
        }
        if (innerBody && typeof innerBody === "object") {
          parsed = innerBody;
        } else if (typeof innerBody === "string") {
          return { type: "text_delta", text: innerBody };
        }
      }

      // Check for error payloads
      if (parsed.error || parsed.details) {
        const errMsg = (parsed.error || "") + (parsed.details ? `: ${parsed.details}` : "");
        return { type: "error", message: errMsg };
      }

      // If no event type is present, extract text as text_delta for live streaming
      if (!parsed.type) {
        // Do not extract tool_result output objects as text
        if (parsed.tool_use_id || parsed.tool_call_id || parsed.name) {
          return parsed;
        }
        let textVal = parsed.text || parsed.message || parsed.data || parsed.response || parsed.result || parsed.completion;
        if (typeof textVal === "object" && textVal !== null) {
          textVal = textVal.text || textVal.message || JSON.stringify(textVal);
        }
        if (textVal) {
          return { type: "text_delta", text: String(textVal) };
        }
      }
      return parsed;
    }
    return null;
  }

  function handleEvent(ev) {
    switch (ev.type) {

      case "text_delta":
        hideTyping(); hideToolInline();
        if (!botEl) botEl = addMsg("", "bot");
        acc += ev.text;
        botEl.innerHTML = mdLite(acc);
        scrollChat();
        break;

      case "tool_call": {
        hideTyping();
        const uid = ev.tool_use_id || (ev.name + "-" + Date.now());
        if (!PRESENTATION_TOOLS.has(ev.name)) showToolInline(ev.name);
        const card = traceTool(uid, ev.name, ev.input);
        pendingTools[uid] = card;
        // Only reset the bot bubble for DATA tools (credit report, bills, etc.)
        // Presentation tools (send_chip_response, get_deeplinks) fire AFTER the
        // text is done — resetting here would create a duplicate bubble if the
        // model emits any trailing text after the tool call.
        if (!PRESENTATION_TOOLS.has(ev.name)) {
          botEl = null; acc = "";
        }
        break;
      }

      case "tool_result": {
        hideToolInline();
        const uid = ev.tool_use_id || ev.name;
        const card = pendingTools[uid]
          || Object.values(pendingTools).reverse().find(c => c.dataset.toolName === ev.name);
        if (card) {
          traceResult(card, ev.name, ev.output);
          delete pendingTools[card.dataset.toolUseId];
        }
        break;
      }

      case "chips": {
        const presIds = ev.pres_tool_ids || {};

        const chipUid = presIds["send_chip_response"];
        if (chipUid && pendingTools[chipUid]) {
          traceResult(pendingTools[chipUid], "send_chip_response", { chips: ev.chips, deeplinks: ev.deeplinks });
          delete pendingTools[chipUid];
        }

        const dlUid = presIds["get_deeplinks"];
        if (dlUid && pendingTools[dlUid]) {
          traceResult(pendingTools[dlUid], "get_deeplinks", { deeplinks: ev.deeplinks });
          delete pendingTools[dlUid];
        }

        resolvePresCards(pendingTools, ev.chips, ev.deeplinks);
        // Only render chips after a bot bubble exists — if chips arrive before
        // any text (agent called send_chip_response before streaming text),
        // defer rendering until the done event so chips appear below the text.
        if (botEl) {
          renderChips(ev.chips, ev.deeplinks);
        } else {
          // Store for deferred rendering after done applies mdLite
          pendingChips = { chips: ev.chips, deeplinks: ev.deeplinks };
        }
        break;
      }

      case "guardrail":
        traceGuardrail(ev.message);
        break;

      case "done":
        hideTyping(); hideToolInline();
        renderThrottleTimer = null;
        if (ev.text && ev.text.trim()) {
          if (!botEl) botEl = addMsg("", "bot");
          botEl.innerHTML = mdLite(ev.text);
          scrollChat();
        } else if (botEl && acc) {
          botEl.innerHTML = mdLite(acc);
          scrollChat();
        }
        // Flush any chips that arrived before the text bubble was created
        if (pendingChips) {
          renderChips(pendingChips.chips, pendingChips.deeplinks);
          pendingChips = null;
        }
        for (const card of Object.values(pendingTools)) {
          const out = card.querySelector(".te-output");
          if (out && out.classList.contains("te-running")) {
            out.classList.remove("te-running");
            out.textContent = "✓ done";
          }
        }
        break;

      case "error":
        hideTyping(); hideToolInline();
        if (ev.message && (ev.message.includes("EventLoopException") || ev.message.includes("output"))) {
          console.warn("Suppressed non-critical agent warning:", ev.message);
        } else {
          addMsg("⚠️ " + ev.message, "bot");
        }
        break;
    }
  }
}

sendBtn.onclick = () => send(input.value);
input.onkeydown = (e) => { if (e.key === "Enter") send(input.value); };

if (checkServedOverHttp()) loadConfig();