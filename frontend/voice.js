// voice.js — GoodScore "Talk to Expert" voice entry point.
//
// Additive, self-contained script: injects its own toggle button and
// call panel into the existing phone frame at runtime, reusing the
// already-rendered #userIdInput / #passcodeInput fields app.js manages.
// Does not read or modify any app.js internal variable, and does not
// change app.js/index.html/styles.css — see backend/voice/README.md for
// the WebSocket protocol this talks to.
//
// Per <language_requirements> no live transcript is shown — only call
// status (connecting / listening / thinking / speaking).

(function () {
  const VOICE_WS_URL = window.VOICE_WS_URL || "ws://localhost:8090/v1/voice/stream";

  const phoneTop = document.querySelector(".phone-top");
  const phone = document.querySelector(".phone");
  const chatEl = document.getElementById("chat");
  const suggestedEl = document.getElementById("suggested");
  const composerEl = document.querySelector(".composer");
  const userIdInput = document.getElementById("userIdInput");
  const passcodeInput = document.getElementById("passcodeInput");

  // Defensive — if the existing chat DOM ever changes shape, fail quiet
  // rather than throw and break the (protected) chat page around us.
  if (!phoneTop || !phone || !chatEl || !composerEl || !userIdInput) return;

  // Step 1: inject the Chat/Talk toggle into the existing phone header.
  const toggleWrap = document.createElement("div");
  toggleWrap.className = "voice-toggle-wrap";
  toggleWrap.innerHTML =
    '<button type="button" id="chatModeBtn" class="mode-btn active">💬 Chat</button>' +
    '<button type="button" id="voiceModeBtn" class="mode-btn">🎙️ Talk to Expert</button>';
  phoneTop.appendChild(toggleWrap);
  const chatModeBtn = document.getElementById("chatModeBtn");
  const voiceModeBtn = document.getElementById("voiceModeBtn");

  // Step 2: inject the call panel (hidden until "Talk to Expert" is picked).
  const panel = document.createElement("div");
  panel.id = "voicePanel";
  panel.className = "voice-panel";
  panel.style.display = "none";
  panel.innerHTML =
    '<div class="voice-status" id="voiceStatus">Tap the mic to connect</div>' +
    '<button type="button" id="voiceMicBtn" class="voice-mic-btn" title="Hold to talk">' +
    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>' +
    '<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>' +
    '<line x1="12" y1="19" x2="12" y2="23"></line>' +
    '<line x1="8" y1="23" x2="16" y2="23"></line>' +
    "</svg></button>" +
    '<div class="voice-hint" id="voiceHint">Hold the mic and speak, then release</div>' +
    '<div class="voice-captions" id="voiceCaptions"></div>' +
    '<div class="voice-call-id" id="voiceCallId"></div>' +
    '<audio id="voicePlayer" style="display:none"></audio>';
  phone.insertBefore(panel, composerEl);

  const statusEl = document.getElementById("voiceStatus");
  const hintEl = document.getElementById("voiceHint");
  const micBtn = document.getElementById("voiceMicBtn");
  const callIdEl = document.getElementById("voiceCallId");
  const player = document.getElementById("voicePlayer");
  const captionsEl = document.getElementById("voiceCaptions");

  // Captions are optional, off by the original "no live transcript"
  // spec — shown here per an explicit later request. They render once,
  // after the turn completes (see turn_done in the WebSocket protocol),
  // not word-by-word as the turn happens.
  function renderCaptions(transcript, answerText) {
    captionsEl.innerHTML = "";
    if (transcript) {
      const you = document.createElement("div");
      you.className = "voice-caption you";
      you.textContent = transcript;
      captionsEl.appendChild(you);
    }
    if (answerText) {
      const bot = document.createElement("div");
      bot.className = "voice-caption bot";
      bot.textContent = answerText;
      captionsEl.appendChild(bot);
    }
  }

  function clearCaptions() {
    captionsEl.innerHTML = "";
  }

  // --- mode toggle -----------------------------------------------------
  function showChatMode() {
    chatEl.style.display = "";
    if (suggestedEl) suggestedEl.style.display = "";
    composerEl.style.display = "";
    panel.style.display = "none";
    chatModeBtn.classList.add("active");
    voiceModeBtn.classList.remove("active");
  }

  function showVoiceMode() {
    chatEl.style.display = "none";
    if (suggestedEl) suggestedEl.style.display = "none";
    composerEl.style.display = "none";
    panel.style.display = "flex";
    chatModeBtn.classList.remove("active");
    voiceModeBtn.classList.add("active");
    ensureConnected();
  }

  chatModeBtn.onclick = showChatMode;
  voiceModeBtn.onclick = showVoiceMode;

  // --- call state --------------------------------------------------------
  let ws = null;
  let wsReady = false;
  let mediaRecorder = null;
  let recordedChunks = [];
  let audioChunks = [];
  let turnCounter = 0;
  let isSpeaking = false;

  function newTurnId() {
    turnCounter += 1;
    return "turn-" + turnCounter + "-" + Date.now();
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", !!isError);
  }

  function requireUserId() {
    const userId = userIdInput.value.trim();
    if (!userId) {
      userIdInput.focus();
      userIdInput.style.borderColor = "#f87171";
      setTimeout(() => { userIdInput.style.borderColor = ""; }, 1500);
      setStatus("Set a User ID first (top of screen)", true);
      return null;
    }
    return userId;
  }

  function ensureConnected() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const userId = requireUserId();
    if (!userId) return;

    setStatus("Connecting…");
    micBtn.disabled = true;

    ws = new WebSocket(VOICE_WS_URL);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      const authToken = (passcodeInput && passcodeInput.value.trim()) || window.APP_PASSCODE || "dev-token";
      ws.send(JSON.stringify({ type: "hello", user_id: userId, auth_token: authToken }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        handleControlMessage(JSON.parse(event.data));
      } else {
        audioChunks.push(event.data);
      }
    };

    ws.onerror = () => {
      setStatus("Connection error — is the voice service running?", true);
    };

    ws.onclose = () => {
      wsReady = false;
      micBtn.disabled = true;
      setStatus("Disconnected — switch tabs to reconnect", true);
    };
  }

  function handleControlMessage(msg) {
    switch (msg.type) {
      case "ready":
        wsReady = true;
        micBtn.disabled = false;
        callIdEl.textContent = msg.call_id || "";
        setStatus("Ready — hold the mic and speak");
        break;
      case "turn_started":
        audioChunks = [];
        setStatus("Thinking…");
        break;
      case "turn_done":
        renderCaptions(msg.transcript, msg.answer_text);
        playAccumulatedAudio();
        break;
      case "turn_cancelled":
        audioChunks = [];
        stopPlayback();
        setStatus("Ready — hold the mic and speak");
        break;
      case "error":
        setStatus(msg.message || "Something went wrong", true);
        break;
    }
  }

  function stopPlayback() {
    isSpeaking = false;
    micBtn.classList.remove("speaking");
    try { player.pause(); } catch (_) { /* no-op */ }
  }

  function playAccumulatedAudio() {
    if (audioChunks.length === 0) {
      setStatus("Ready — hold the mic and speak");
      return;
    }
    const blob = new Blob(audioChunks, { type: "audio/mpeg" });
    audioChunks = [];
    player.src = URL.createObjectURL(blob);
    isSpeaking = true;
    micBtn.classList.add("speaking");
    setStatus("Speaking…");
    player.play().catch(() => setStatus("Tap the mic to hear the reply", true));
    player.onended = () => {
      stopPlayback();
      setStatus("Ready — hold the mic and speak");
    };
  }

  // --- push-to-talk recording -------------------------------------------
  async function startRecording() {
    if (!wsReady || !ws || ws.readyState !== WebSocket.OPEN) {
      ensureConnected();
      return;
    }

    // Barge-in: if the bot is still speaking, interrupt it before
    // capturing the new turn — mirrors the WebSocket protocol's
    // barge_in message (see backend/voice/app.py).
    if (isSpeaking) {
      ws.send(JSON.stringify({ type: "barge_in", turn_id: newTurnId() }));
      stopPlayback();
    }
    clearCaptions();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.start();
      micBtn.classList.add("recording");
      hintEl.textContent = "Release to send";
      setStatus("Listening…");
    } catch (e) {
      setStatus("Microphone access denied", true);
    }
  }

  async function stopRecordingAndSend() {
    if (!mediaRecorder || mediaRecorder.state !== "recording") return;
    const stopped = new Promise((resolve) => { mediaRecorder.onstop = resolve; });
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    await stopped;
    micBtn.classList.remove("recording");
    hintEl.textContent = "Hold the mic and speak, then release";

    const blob = new Blob(recordedChunks, { type: "audio/webm" });
    const arrayBuffer = await blob.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      setStatus("Ready — hold the mic and speak");
      return;
    }

    const turnId = newTurnId();
    ws.send(arrayBuffer);
    ws.send(JSON.stringify({ type: "turn_end", turn_id: turnId }));
  }

  micBtn.addEventListener("mousedown", startRecording);
  micBtn.addEventListener("mouseup", stopRecordingAndSend);
  micBtn.addEventListener("mouseleave", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") stopRecordingAndSend();
  });
  micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); });
  micBtn.addEventListener("touchend", (e) => { e.preventDefault(); stopRecordingAndSend(); });
})();
