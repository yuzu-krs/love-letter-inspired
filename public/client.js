const socket = io();

const elements = {
  joinPanel: document.querySelector("#joinPanel"),
  gamePanel: document.querySelector("#gamePanel"),
  joinForm: document.querySelector("#joinForm"),
  createRoomButton: document.querySelector("#createRoomButton"),
  playerName: document.querySelector("#playerName"),
  roomCode: document.querySelector("#roomCode"),
  roomPassword: document.querySelector("#roomPassword"),
  roomList: document.querySelector("#roomList"),
  formError: document.querySelector("#formError"),
  installButton: document.querySelector("#installButton"),
  installGameButton: document.querySelector("#installGameButton"),
  roomCodeLabel: document.querySelector("#roomCodeLabel"),
  phaseTitle: document.querySelector("#phaseTitle"),
  scoreTrack: document.querySelector("#scoreTrack"),
  playersPanel: document.querySelector("#playersPanel"),
  roundBanner: document.querySelector("#roundBanner"),
  deckCount: document.querySelector("#deckCount"),
  turnCard: document.querySelector("#turnCard"),
  insightBox: document.querySelector("#insightBox"),
  logBox: document.querySelector("#logBox"),
  handPanel: document.querySelector("#handPanel"),
  actionPanel: document.querySelector("#actionPanel"),
  soundToggleButton: document.querySelector("#soundToggleButton"),
  inviteButton: document.querySelector("#inviteButton"),
  cinematicLayer: document.querySelector("#cinematicLayer"),
  toastStack: document.querySelector("#toastStack"),
  networkStatus: document.querySelector("#networkStatus"),
  copyCodeButton: document.querySelector("#copyCodeButton"),
  leaveButton: document.querySelector("#leaveButton"),
};

const phaseLabels = {
  lobby: "ロビー",
  playing: "対戦中",
  roundOver: "ラウンド終了",
  gameOver: "ゲーム終了",
};

const roomPhaseLabels = {
  lobby: "募集中",
  playing: "対戦中",
  roundOver: "ラウンド終了",
  gameOver: "ゲーム終了",
};

const CARD_BACK_IMAGE = "/assets/card-back.svg";

let state = null;
let roomSummaries = [];
let selectedCardUid = "";
let isRulebookOpen = true;
let soundEnabled = localStorage.getItem("secret-letter-sound") !== "off";
let audioContext = null;
let musicTimerId = 0;
let musicStep = 0;
let cinematicQueue = [];
let isCinematicPlaying = false;
let installPromptEvent = null;
let serviceWorkerRegistration = null;
let activeViewTransition = null;
const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);
const BACKGROUND_MUSIC_PATTERN = [
  { bass: 196, harmony: 392, lead: 523.25 },
  { lead: 587.33 },
  { lead: 659.25 },
  { lead: 587.33 },
  { bass: 174.61, harmony: 349.23, lead: 440 },
  { lead: 523.25 },
  { lead: 493.88 },
  { lead: 440 },
  { bass: 164.81, harmony: 329.63, lead: 392 },
  { lead: 493.88 },
  { lead: 523.25 },
  { lead: 493.88 },
  { bass: 146.83, harmony: 293.66, lead: 349.23 },
  { lead: 392 },
  { lead: 440 },
  { lead: 493.88 },
];

updateSoundButton();
updateNetworkStatus();
registerServiceWorker();

document.addEventListener("pointerdown", () => {
  unlockAudio();
  syncBackgroundMusic();
});

elements.cinematicLayer?.addEventListener("click", () => {
  dismissCinematic();
});

elements.cinematicLayer?.addEventListener("keydown", (event) => {
  if (["Escape", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    dismissCinematic();
  }
});

elements.playerName.value = localStorage.getItem("secret-letter-name") || "";
elements.roomCode.value = localStorage.getItem("secret-letter-room") || "";

elements.createRoomButton.addEventListener("click", () => {
  unlockAudio();
  playSound("tap");
  vibrate(8);
  const name = elements.playerName.value.trim();
  const password = elements.roomPassword.value.trim();
  setError("");
  socket.emit("createRoom", { name, password }, handleJoinReply);
});

elements.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  unlockAudio();
  playSound("tap");
  vibrate(8);
  const name = elements.playerName.value.trim();
  const roomCode = elements.roomCode.value.trim();
  const password = elements.roomPassword.value.trim();
  setError("");
  socket.emit("joinRoom", { name, roomCode, password }, handleJoinReply);
});

elements.soundToggleButton?.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem("secret-letter-sound", soundEnabled ? "on" : "off");
  updateSoundButton();
  if (soundEnabled) {
    unlockAudio();
    playSound("success");
    syncBackgroundMusic();
  } else {
    stopBackgroundMusic();
  }
});

[elements.installButton, elements.installGameButton].forEach((button) => {
  button?.addEventListener("click", () => {
    promptInstall();
  });
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPromptEvent = event;
  updateInstallButtons();
});

window.addEventListener("appinstalled", () => {
  installPromptEvent = null;
  updateInstallButtons();
  showToast("インストール完了", "ホーム画面からすぐ開けます。", "success");
});

window.addEventListener("online", () => {
  updateNetworkStatus();
  showToast("オンラインに復帰", "リアルタイム対戦を再開できます。", "success");
});

window.addEventListener("offline", () => {
  updateNetworkStatus();
  showToast("オフライン", "画面はキャッシュから確認できます。", "error");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopBackgroundMusic();
  } else {
    syncBackgroundMusic();
  }
});

document.addEventListener("keydown", (event) => {
  if (isCinematicPlaying && ["Escape", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    dismissCinematic();
  }
});

elements.inviteButton?.addEventListener("click", () => {
  playSound("tap");
  shareRoom();
});

elements.copyCodeButton.addEventListener("click", async () => {
  if (!state?.roomCode) {
    return;
  }
  unlockAudio();
  playSound("tap");
  vibrate(5);
  await navigator.clipboard?.writeText(state.roomCode);
  elements.copyCodeButton.textContent = "コピー済み";
  window.setTimeout(() => {
    elements.copyCodeButton.textContent = "コードをコピー";
  }, 1200);
});

elements.leaveButton.addEventListener("click", () => {
  playSound("tap");
  vibrate(8);
  socket.emit("leaveRoom", {}, () => {
    state = null;
    selectedCardUid = "";
    stopBackgroundMusic();
    withViewTransition(() => {
      elements.joinPanel.classList.remove("hidden");
      elements.gamePanel.classList.add("hidden");
      renderRoomList();
    });
  });
});

socket.on("stateUpdate", (nextState) => {
  const previousState = state;
  state = nextState;
  selectedCardUid = keepSelectedCard(nextState) ? selectedCardUid : "";
  localStorage.setItem("secret-letter-room", nextState.roomCode);
  localStorage.setItem(
    "secret-letter-name",
    nextState.you?.name || elements.playerName.value.trim(),
  );
  withViewTransition(() => {
    elements.joinPanel.classList.add("hidden");
    elements.gamePanel.classList.remove("hidden");
    render();
  });
  reactToStateChange(previousState, nextState);
  syncBackgroundMusic();
});

socket.on("connect_error", () => {
  setError("サーバーに接続できません。");
});

socket.on("roomListUpdate", (rooms) => {
  roomSummaries = Array.isArray(rooms) ? rooms : [];
  withViewTransition(() => renderRoomList());
});

requestRoomList();

function handleJoinReply(reply) {
  if (!reply?.ok) {
    setError(reply?.error || "参加できませんでした。");
    return;
  }
  elements.roomCode.value = reply.roomCode || "";
}

function requestRoomList() {
  socket.emit("listRooms", (reply) => {
    if (!reply?.ok) {
      return;
    }
    roomSummaries = reply.rooms || [];
    renderRoomList();
  });
}

function renderRoomList() {
  if (!elements.roomList) {
    return;
  }

  if (roomSummaries.length === 0) {
    elements.roomList.innerHTML =
      '<p class="empty-room-list">募集中の部屋はまだありません。</p>';
    return;
  }

  elements.roomList.innerHTML = roomSummaries
    .map((room) => renderRoomCard(room))
    .join("");
  elements.roomList.querySelectorAll("[data-room-code]").forEach((button) => {
    button.addEventListener("click", () => {
      const code = button.dataset.roomCode;
      const locked = button.dataset.locked === "true";
      elements.roomCode.value = code;
      playSound("select");
      vibrate(6);

      if (locked) {
        elements.roomPassword.focus();
        setError("鍵付き部屋です。合言葉を入力して参加してください。", "info");
      } else {
        elements.playerName.focus();
        setError(
          "部屋を選択しました。名前を確認して参加してください。",
          "info",
        );
      }
    });
  });
}

function renderRoomCard(room) {
  const status = roomPhaseLabels[room.phase] || room.phase;
  const disabled = !room.joinable ? "disabled" : "";
  const lockedLabel = room.locked ? "鍵付き" : "公開";

  return `
    <button class="room-card ${room.locked ? "locked" : ""}" type="button" data-room-code="${escapeHtml(room.code)}" data-locked="${room.locked}" ${disabled}>
      <span class="room-card-main">
        <strong>${escapeHtml(room.code)}</strong>
        <small>${escapeHtml(room.hostName)} の部屋</small>
      </span>
      <span class="room-card-meta">
        <span>${room.playerCount} / ${room.maxPlayers}</span>
        <span>${status}</span>
        <span class="lock-badge">${lockedLabel}</span>
      </span>
    </button>
  `;
}

function withViewTransition(update) {
  if (
    !document.startViewTransition ||
    prefersReducedMotion.matches ||
    activeViewTransition
  ) {
    update();
    return;
  }

  try {
    const transition = document.startViewTransition(update);
    activeViewTransition = transition;

    transition.ready?.catch(() => {});
    transition.updateCallbackDone?.catch(() => {});
    transition.finished
      ?.catch(() => {})
      .finally(() => {
        if (activeViewTransition === transition) {
          activeViewTransition = null;
        }
      });
  } catch (error) {
    activeViewTransition = null;
    update();
  }
}

async function shareRoom() {
  if (!state?.roomCode) {
    return;
  }

  const invitation = `Secret Letter Table の部屋 ${state.roomCode} で待っています。`;
  const url = window.location.origin;

  try {
    if (navigator.share) {
      await navigator.share({
        title: "Secret Letter Table",
        text: invitation,
        url,
      });
      showToast("招待を開きました", "共有先を選んでください。", "success");
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }
  }

  await navigator.clipboard?.writeText(`${invitation}\n${url}`);
  showToast("招待文をコピーしました", state.roomCode, "success");
}

function vibrate(pattern) {
  if ("vibrate" in navigator && !prefersReducedMotion.matches) {
    navigator.vibrate(pattern);
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      serviceWorkerRegistration = await navigator.serviceWorker.register("/service-worker.js");
      showToast("オフライン準備OK", "カード画像と画面をキャッシュしました。", "success");
    } catch (error) {
      console.warn("Service Worker registration failed", error);
    }
  });
}

function updateInstallButtons() {
  const shouldShow = Boolean(installPromptEvent);
  [elements.installButton, elements.installGameButton].forEach((button) => {
    button?.classList.toggle("hidden", !shouldShow);
  });
}

async function promptInstall() {
  if (!installPromptEvent) {
    showToast("インストール準備中", "ブラウザ条件が整うと表示されます。", "card");
    return;
  }

  playSound("success");
  installPromptEvent.prompt();
  const choice = await installPromptEvent.userChoice;
  if (choice.outcome === "accepted") {
    showToast("インストールを開始", "完了まで少し待ってください。", "success");
  }
  installPromptEvent = null;
  updateInstallButtons();
}

async function refreshOfflineCache() {
  if (!serviceWorkerRegistration) {
    return;
  }

  await serviceWorkerRegistration.update();
  showToast("キャッシュ更新", "オフライン用データを更新しました。", "success");
}

function updateNetworkStatus() {
  if (!elements.networkStatus) {
    return;
  }

  const online = navigator.onLine;
  elements.networkStatus.textContent = online ? "ONLINE" : "OFFLINE";
  elements.networkStatus.classList.toggle("offline", !online);
}

function render() {
  if (!state) {
    return;
  }

  elements.roomCodeLabel.textContent = state.roomCode;
  elements.phaseTitle.textContent = phaseLabels[state.phase] || "ロビー";
  elements.deckCount.textContent = state.deckCount;

  renderScores();
  renderPlayers();
  renderTable();
  renderHand();
  renderActions();
}

function renderScores() {
  elements.scoreTrack.innerHTML = state.players
    .map((player) => {
      const dots = Array.from({ length: state.targetScore }, (_, index) => {
        return `<span class="score-dot ${index < player.score ? "filled" : ""}"></span>`;
      }).join("");

      return `
        <div class="score-pill ${state.roundWinnerIds.includes(player.id) ? "winner" : ""}">
          <strong>${escapeHtml(player.name)}</strong>
          <span class="score-dots" aria-label="${player.score}点">${dots}</span>
          <span class="score-number">${player.score} / ${state.targetScore}</span>
        </div>
      `;
    })
    .join("");
}

function renderPlayers() {
  elements.playersPanel.innerHTML = state.players
    .map((player) => {
      const tags = [];
      if (player.isHost) tags.push('<span class="tag">部屋主</span>');
      if (player.id === state.currentPlayerId && state.phase === "playing")
        tags.push('<span class="tag turn">手番</span>');
      if (player.protected) tags.push('<span class="tag safe">護り</span>');
      if (player.eliminated) tags.push('<span class="tag">脱落</span>');
      if (!player.connected) tags.push('<span class="tag">切断</span>');

      const discard = player.discard
        .map(
          (card) => `
            <img class="mini-card-art" src="${getCardImage(card)}" alt="${escapeHtml(card.name)}" title="${escapeHtml(card.name)}" loading="lazy" />
          `,
        )
        .join("");

      const revealedHand = player.hand
        .map(
          (card) => `
            <img class="revealed-card-art" src="${getCardImage(card)}" alt="${escapeHtml(card.name)}" title="${escapeHtml(card.name)}" loading="lazy" />
          `,
        )
        .join("");

      return `
        <article class="player-card ${player.id === state.currentPlayerId ? "active" : ""} ${player.eliminated ? "eliminated" : ""}">
          <div class="player-name-row">
            <strong>${escapeHtml(player.name)}</strong>
            <span>${player.handCount} 枚</span>
          </div>
          <div class="tag-row">${tags.join("")}</div>
          <div class="mini-discard">${discard || '<span class="discard-empty">捨て札なし</span>'}</div>
          ${revealedHand ? `<div class="revealed-hand">${revealedHand}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderTable() {
  const currentPlayer = state.players.find(
    (player) => player.id === state.currentPlayerId,
  );
  const winnerNames = state.players
    .filter((player) => state.roundWinnerIds.includes(player.id))
    .map((player) => player.name)
    .join("、");

  let statusTitle = "";
  let statusText = "";

  if (state.phase === "lobby") {
    elements.roundBanner.textContent = `${state.players.length} / 4 人`;
    statusTitle = "参加待ち";
    statusText = "2人以上で開始できます。";
  } else if (state.phase === "playing") {
    elements.roundBanner.textContent = `Round ${state.round}`;
    statusTitle = escapeHtml(currentPlayer?.name || "");
    statusText = "現在の手番";
  } else {
    elements.roundBanner.textContent = `Round ${state.round}`;
    statusTitle = escapeHtml(winnerNames || "勝者なし");
    statusText = phaseLabels[state.phase];
  }

  elements.turnCard.innerHTML = `
    <div class="turn-status">
      <strong>${statusTitle}</strong>
      <span>${statusText}</span>
    </div>
    ${state.lastPlayed ? renderPlayedPreview(state.lastPlayed) : '<div class="played-placeholder">捨て札置き場</div>'}
  `;

  if (state.you?.insight) {
    elements.insightBox.innerHTML = renderInsight(state.you.insight);
    elements.insightBox.classList.remove("hidden");
  } else {
    elements.insightBox.classList.add("hidden");
  }

  elements.logBox.innerHTML = renderTimeline();
}

function renderHand() {
  const hand = state.you?.hand || [];
  const canPlay = isMyTurn();

  elements.handPanel.innerHTML = `
    <div class="hand-title-row">
      <h3>手札</h3>
      <span class="status-text">${getHandStatusText()}</span>
    </div>
    <div class="hand-cards">
      ${hand.map((card) => renderCard(card, canPlay)).join("") || '<p class="status-text">手札はありません。</p>'}
    </div>
  `;

  elements.handPanel.querySelectorAll("[data-card-uid]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!canPlay) {
        return;
      }
      selectedCardUid = button.dataset.cardUid;
      playSound("select");
      renderHand();
      renderActions();
    });
  });
}

function renderCard(card, selectable) {
  const type = getCardType(card.value);
  return `
    <button class="game-card tone-${card.tone} ${selectable ? "selectable" : ""} ${selectedCardUid === card.uid ? "selected" : ""}" type="button" data-card-uid="${card.uid}" aria-label="${card.value} ${escapeHtml(card.name)}">
      <img class="card-art" src="${getCardImage(card)}" alt="" draggable="false" />
      <span class="card-meta">
        <strong>${card.value} ${escapeHtml(card.name)}</strong>
        <small>${escapeHtml(type?.shortEffect || "")}</small>
      </span>
    </button>
  `;
}

function renderActions() {
  const selectedCard = state.you?.hand.find(
    (card) => card.uid === selectedCardUid,
  );
  const isHost = state.you?.id === state.hostId;

  if (state.phase === "lobby") {
    elements.actionPanel.innerHTML = `
      <div class="lobby-action-row">
        <div>
          <div class="action-title-row"><h3>開始</h3></div>
          <p class="status-text">${isHost ? "部屋主がゲームを開始できます。" : "部屋主の開始を待っています。"}</p>
        </div>
        <button class="primary-button" id="startButton" type="button" ${isHost && state.players.length >= 2 ? "" : "disabled"}>ゲーム開始</button>
      </div>
      ${renderRulesPanel("open")}
    `;
    elements.actionPanel
      .querySelector("#startButton")
      ?.addEventListener("click", () => {
        playSound("tap");
        emitSimple("startGame");
      });
    bindRulebookState();
    return;
  }

  if (state.phase === "roundOver" || state.phase === "gameOver") {
    elements.actionPanel.innerHTML = `
      <div class="lobby-action-row">
        <div>
          <div class="action-title-row"><h3>${state.phase === "gameOver" ? "新しいゲーム" : "次のラウンド"}</h3></div>
          <p class="status-text">公開された手札と捨て札を確認できます。</p>
        </div>
        <button class="primary-button" id="nextRoundButton" type="button" ${isHost ? "" : "disabled"}>${state.phase === "gameOver" ? "最初から始める" : "次へ"}</button>
      </div>
      ${renderRulesPanel("open")}
    `;
    elements.actionPanel
      .querySelector("#nextRoundButton")
      ?.addEventListener("click", () => {
        playSound("tap");
        emitSimple("nextRound");
      });
    bindRulebookState();
    return;
  }

  if (!isMyTurn()) {
    elements.actionPanel.innerHTML = `
      <div class="action-wait-panel">
        <div class="action-title-row"><h3>観察</h3></div>
        <p class="status-text">${getActionWaitText()}</p>
      </div>
      ${renderRulesPanel("open")}
    `;
    bindRulebookState();
    return;
  }

  const selectedType = selectedCard ? getCardType(selectedCard.value) : null;
  const targetOptions = selectedType ? getTargetOptions(selectedType) : [];
  const needsTarget = selectedType && selectedType.targetMode !== "none";
  const needsGuess = Boolean(selectedType?.needsGuess);

  elements.actionPanel.innerHTML = `
    <div class="action-title-row">
      <h3>カードを出す</h3>
      <span class="status-text">${selectedCard ? escapeHtml(selectedCard.name) : "カードを選択"}</span>
    </div>
    ${selectedCard ? renderSelectedSummary(selectedCard) : '<p class="status-text">手札からカードを選ぶと対象と宣言を指定できます。</p>'}
    <div class="action-controls">
      <label class="${needsTarget ? "" : "hidden"}">
        対象
        <select id="targetSelect">
          ${
            targetOptions.length > 0
              ? targetOptions
                  .map(
                    (player) =>
                      `<option value="${player.id}">${escapeHtml(player.name)}</option>`,
                  )
                  .join("")
              : '<option value="">有効な対象なし</option>'
          }
        </select>
      </label>
      <label class="${needsGuess ? "" : "hidden"}">
        宣言
        <select id="guessSelect">
          ${state.cardTypes
            .filter((card) => card.value !== 1)
            .map(
              (card) =>
                `<option value="${card.value}">${card.value} ${escapeHtml(card.name)}</option>`,
            )
            .join("")}
        </select>
      </label>
      <button class="primary-button" id="playButton" type="button" ${selectedCard ? "" : "disabled"}>出す</button>
    </div>
    ${renderRulesPanel("open")}
  `;

  elements.actionPanel
    .querySelector("#playButton")
    ?.addEventListener("click", () => {
      playSound("play");
      socket.emit(
        "playCard",
        {
          roomCode: state.roomCode,
          cardUid: selectedCardUid,
          targetId:
            elements.actionPanel.querySelector("#targetSelect")?.value || "",
          guessValue:
            elements.actionPanel.querySelector("#guessSelect")?.value || "",
        },
        (reply) => {
          if (!reply?.ok) {
            playSound("error");
            setActionError(reply?.error || "カードを出せませんでした。");
          } else {
            selectedCardUid = "";
          }
        },
      );
    });
  bindRulebookState();
}

function renderPlayedPreview(action) {
  const card = action.card;
  if (!card) {
    return '<div class="played-placeholder">捨て札置き場</div>';
  }

  return `
    <div class="played-preview">
      <img src="${getCardImage(card)}" alt="${escapeHtml(card.name)}" loading="lazy" />
      <div>
        <span>直近のカード</span>
        <strong>${escapeHtml(action.playerName)}</strong>
        <small>${card.value} ${escapeHtml(card.name)}</small>
      </div>
    </div>
  `;
}

function renderSelectedSummary(card) {
  const type = getCardType(card.value);
  return `
    <div class="selected-summary">
      <img src="${getCardImage(card)}" alt="${escapeHtml(card.name)}" />
      <div>
        <strong>${card.value} ${escapeHtml(card.name)}</strong>
        <p>${escapeHtml(type?.effect || "")}</p>
      </div>
    </div>
  `;
}

function renderCardReference() {
  return `
    <div class="card-reference" aria-label="カード一覧">
      ${state.cardTypes
        .map(
          (card) => `
            <figure class="reference-card tone-${card.tone}">
              <img src="${getCardImage(card)}" alt="${card.value} ${escapeHtml(card.name)}" loading="lazy" />
              <figcaption>${card.value} ${escapeHtml(card.name)} x${card.count}</figcaption>
            </figure>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderRulesPanel() {
  const rules = state.rules || {};
  const totalCards =
    rules.totalCards ||
    state.cardTypes.reduce((total, card) => total + (card.count || 0), 0);
  const deckInfo =
    state.phase === "playing"
      ? `山札 ${state.deckCount} 枚`
      : "山札は開始時に作成";
  const openAttribute = isRulebookOpen ? "open" : "";

  return `
    <details class="rulebook" ${openAttribute}>
      <summary>
        <span>ルールブック</span>
        <strong>${totalCards}枚構成</strong>
      </summary>
      <div class="rulebook-body">
        <div class="rule-overview">
          <article>
            <h4>ラウンド</h4>
            ${renderRuleList(rules.setup)}
          </article>
          <article>
            <h4>手番</h4>
            ${renderRuleList(rules.turn)}
          </article>
          <article>
            <h4>勝利</h4>
            ${renderRuleList(rules.winning)}
          </article>
          <article>
            <h4>注意</h4>
            ${renderRuleList(rules.notes)}
          </article>
        </div>
        <div class="deck-composition">
          <div class="composition-header">
            <div>
              <h4>カード構成</h4>
              <p>${deckInfo} / 非公開除外 1 枚</p>
            </div>
            <span>${totalCards}枚</span>
          </div>
          <div class="manual-grid">
            ${state.cardTypes.map((card) => renderManualCard(card)).join("")}
          </div>
        </div>
      </div>
    </details>
  `;
}

function bindRulebookState() {
  const rulebook = elements.actionPanel.querySelector(".rulebook");
  if (!rulebook) {
    return;
  }

  rulebook.addEventListener("toggle", () => {
    isRulebookOpen = rulebook.open;
  });
}

function renderRuleList(items = []) {
  return `
    <ol>
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ol>
  `;
}

function renderManualCard(card) {
  return `
    <article class="manual-card tone-${card.tone}">
      <img src="${getCardImage(card)}" alt="${card.value} ${escapeHtml(card.name)}" loading="lazy" />
      <div>
        <div class="manual-card-title">
          <strong>${card.value} ${escapeHtml(card.name)}</strong>
          <span>${card.count}枚</span>
        </div>
        <p>${escapeHtml(card.effect)}</p>
      </div>
    </article>
  `;
}

function getTargetOptions(cardType) {
  return state.players.filter((player) => {
    if (player.eliminated || !player.connected) {
      return false;
    }
    if (player.protected && player.id !== state.you.id) {
      return false;
    }
    if (cardType.targetMode === "opponent") {
      return player.id !== state.you.id;
    }
    return true;
  });
}

function emitSimple(eventName) {
  socket.emit(eventName, { roomCode: state.roomCode }, (reply) => {
    if (!reply?.ok) {
      setActionError(reply?.error || "操作できませんでした。");
    }
  });
}

function setActionError(message) {
  const status = elements.actionPanel.querySelector(".status-text");
  if (status) {
    status.textContent = message;
  }
}

function setError(message, tone = "error") {
  elements.formError.classList.toggle("info", tone === "info");
  elements.formError.textContent = message;
}

function isMyTurn() {
  const me = state.players.find((player) => player.id === state.you?.id);
  return (
    state.phase === "playing" &&
    state.currentPlayerId === state.you?.id &&
    !me?.eliminated
  );
}

function getHandStatusText() {
  if (state.phase !== "playing") {
    return "公開中";
  }
  if (isMyTurn()) {
    return "あなたの番";
  }
  return "待機中";
}

function getActionWaitText() {
  const me = state.players.find((player) => player.id === state.you?.id);
  if (me?.eliminated) {
    return "このラウンドは脱落しています。";
  }
  const current = state.players.find(
    (player) => player.id === state.currentPlayerId,
  );
  return `${current?.name || "相手"} の手番です。`;
}

function getCardType(value) {
  return state?.cardTypes?.find((card) => card.value === value) || null;
}

function getCardImage(card) {
  return card?.image || CARD_BACK_IMAGE;
}

function keepSelectedCard(nextState) {
  return Boolean(
    nextState.you?.hand.some((card) => card.uid === selectedCardUid),
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInsight(insight) {
  if (typeof insight === "string") {
    return `
      <article class="insight-card">
        <div class="insight-copy">
          <span>秘密メモ</span>
          <strong>${escapeHtml(insight)}</strong>
        </div>
      </article>
    `;
  }

  if (insight?.type === "peek" && insight.card) {
    const cardType = getCardType(insight.card.value);
    return `
      <article class="insight-card reveal">
        <img src="${getCardImage(insight.card)}" alt="${escapeHtml(insight.card.name)}" />
        <div class="insight-copy">
          <span>占い結果</span>
          <strong>${escapeHtml(insight.targetName)} は ${insight.card.value} ${escapeHtml(insight.card.name)}</strong>
          <p>${escapeHtml(cardType?.shortEffect || cardType?.effect || "")}</p>
        </div>
      </article>
    `;
  }

  return "";
}

function renderTimeline() {
  return state.log
    .slice(-8)
    .reverse()
    .map((line, index) => {
      return `
        <article class="timeline-item ${index === 0 ? "latest" : ""}">
          <span class="timeline-icon">${getLogIcon(line)}</span>
          <p>${escapeHtml(line)}</p>
        </article>
      `;
    })
    .join("");
}

function getLogIcon(line) {
  if (line.includes("脱落")) return "×";
  if (line.includes("勝者") || line.includes("勝利")) return "★";
  if (line.includes("確認")) return "◇";
  if (line.includes("守られ")) return "◆";
  if (line.includes("交換")) return "⇄";
  if (line.includes("宣言")) return "!";
  return "•";
}

function reactToStateChange(previousState, nextState) {
  if (!previousState) {
    return;
  }

  const previousLastCardUid = previousState.lastPlayed?.card?.uid || "";
  const nextLastCardUid = nextState.lastPlayed?.card?.uid || "";
  const previousInsight = JSON.stringify(previousState.you?.insight || null);
  const nextInsight = JSON.stringify(nextState.you?.insight || null);
  const newEliminations = getNewEliminations(previousState, nextState);
  const previousEffectId = previousState.lastEffect?.id || "";
  const nextEffectId = nextState.lastEffect?.id || "";

  if (previousInsight !== nextInsight && nextState.you?.insight) {
    playSound("reveal");
    vibrate([8, 24, 8]);
    showToast("占い結果を確認しました", "ポップアップに表示しています。", "reveal");
    showPeekCinematic(nextState.you.insight);
  }

  if (previousLastCardUid !== nextLastCardUid && nextState.lastPlayed) {
    playSound("card");
    vibrate(10);
    if (nextState.lastPlayed.card.key === "duel") {
      showToast(
        `${nextState.lastPlayed.playerName} が ${nextState.lastPlayed.card.name}`,
        "決闘を開始します。",
        "card",
      );
    } else {
      showToast(
        `${nextState.lastPlayed.playerName} が ${nextState.lastPlayed.card.name}`,
        "カードを解決中。",
        "card",
      );
      showCardSpotlight(nextState.lastPlayed);
    }
  }

  if (previousEffectId !== nextEffectId && nextState.lastEffect) {
    reactToEffectEvent(nextState.lastEffect);
  }

  newEliminations.forEach((player) => {
    playSound("eliminate");
    vibrate([20, 30, 35]);
    showToast(
      `${player.name} が脱落`,
      "このラウンドから離脱しました。",
      "eliminate",
    );
    showEliminationCinematic(player);
  });

  if (previousState.phase !== nextState.phase) {
    if (nextState.phase === "playing") {
      playSound("start");
      vibrate(12);
      showToast("ラウンド開始", "手札を確認しましょう。", "start");
    } else if (
      nextState.phase === "roundOver" ||
      nextState.phase === "gameOver"
    ) {
      playSound(nextState.phase === "gameOver" ? "gameWinner" : "winner");
      vibrate([12, 32, 12, 32, 18]);
      showToast(
        phaseLabels[nextState.phase],
        getWinnerText(nextState),
        "finish",
      );
      showWinnerCinematic(nextState);
    }
  }
}

function getNewEliminations(previousState, nextState) {
  const previousPlayers = new Map(
    previousState.players.map((player) => [player.id, player]),
  );
  return nextState.players.filter(
    (player) =>
      player.eliminated && !previousPlayers.get(player.id)?.eliminated,
  );
}

function reactToEffectEvent(effect) {
  if (effect.type === "duel") {
    playSound("duel");
    vibrate([14, 18, 18, 18, 26]);
    showToast(
      `${effect.playerName} vs ${effect.targetName}`,
      effect.winnerName === "引き分け"
        ? "同じ強さでした。"
        : `${effect.winnerName} が勝ちました。`,
      "duel",
    );
    showDuelCinematic(effect);
    return;
  }

  if (effect.type === "discard") {
    playSound("discard");
    vibrate([10, 20, 10]);
    showToast(
      `${effect.targetName} が ${effect.discarded.name} を捨てました`,
      "捨て札を確認できます。",
      "card",
    );
    showDiscardCinematic(effect);
    return;
  }

  if (effect.type === "exchange") {
    playSound("exchange");
    vibrate([8, 18, 8, 18, 12]);
    showToast(
      `${effect.playerName} と ${effect.targetName} が交換`,
      "手札が入れ替わりました。",
      "card",
    );
    showExchangeCinematic(effect);
    return;
  }

  if (effect.type === "guard") {
    playSound("guard");
    vibrate(14);
    showToast(
      `${effect.playerName} が護られました`,
      `${effect.sourcePlayerName || "相手"} の効果を防ぎました。`,
      "guard",
    );
    showGuardCinematic(effect);
  }
}

function getWinnerText(nextState) {
  const names = nextState.players
    .filter((player) => nextState.roundWinnerIds.includes(player.id))
    .map((player) => player.name)
    .join("、");
  return names ? `${names} が勝利しました。` : "結果を確認してください。";
}

function showToast(title, message, type = "") {
  if (!elements.toastStack) {
    return;
  }

  const toast = document.createElement("article");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(message)}</span>
  `;
  elements.toastStack.append(toast);

  window.setTimeout(() => {
    toast.classList.add("leaving");
    window.setTimeout(() => toast.remove(), 260);
  }, 2600);
}

function showDuelCinematic(effect) {
  if (!effect?.playerCard || !effect?.targetCard) {
    return;
  }

  enqueueCinematic(
    `
      <article class="cinematic-duel">
        <div class="duel-card left tone-${effect.playerCard.tone}">
          <span>${escapeHtml(effect.playerName)}</span>
          <img src="${getCardImage(effect.playerCard)}" alt="${escapeHtml(effect.playerCard.name)}" />
          <strong>${effect.playerCard.value} ${escapeHtml(effect.playerCard.name)}</strong>
        </div>
        <div class="duel-center">
          <span>VS</span>
          <strong>${escapeHtml(effect.winnerName === "引き分け" ? "DRAW" : `${effect.winnerName} WIN`)}</strong>
        </div>
        <div class="duel-card right tone-${effect.targetCard.tone}">
          <span>${escapeHtml(effect.targetName)}</span>
          <img src="${getCardImage(effect.targetCard)}" alt="${escapeHtml(effect.targetCard.name)}" />
          <strong>${effect.targetCard.value} ${escapeHtml(effect.targetCard.name)}</strong>
        </div>
      </article>
    `,
    "duel",
  );
}

function showPeekCinematic(insight) {
  if (!insight?.card) {
    return;
  }

  enqueueCinematic(
    `
      <article class="cinematic-peek tone-${insight.card.tone}">
        <img src="${getCardImage(insight.card)}" alt="${escapeHtml(insight.card.name)}" />
        <div class="cinematic-copy">
          <span>PEEK RESULT</span>
          <strong>${escapeHtml(insight.targetName)} は ${insight.card.value} ${escapeHtml(insight.card.name)} でした</strong>
          <p>${escapeHtml(getCardType(insight.card.value)?.effect || "")}</p>
        </div>
      </article>
    `,
    "peek",
  );
}

function showDiscardCinematic(effect) {
  if (!effect?.discarded) {
    return;
  }

  enqueueCinematic(
    `
      <article class="cinematic-discard tone-${effect.discarded.tone}">
        <div class="cinematic-ribbon">DISCARD</div>
        <img src="${getCardImage(effect.discarded)}" alt="${escapeHtml(effect.discarded.name)}" />
        <div class="cinematic-copy">
          <span>${escapeHtml(effect.playerName)} の効果</span>
          <strong>${escapeHtml(effect.targetName)} は ${effect.discarded.value} ${escapeHtml(effect.discarded.name)} を捨てました</strong>
          <p>${escapeHtml(getCardType(effect.discarded.value)?.effect || "")}</p>
        </div>
      </article>
    `,
    "discard",
  );
}

function showGuardCinematic(effect) {
  enqueueCinematic(
    `
      <article class="cinematic-guard">
        <div class="guard-orbit"><span></span></div>
        <div class="cinematic-copy">
          <span>PROTECTED</span>
          <strong>${escapeHtml(effect.playerName)} は護られました</strong>
          <p>${escapeHtml(effect.sourcePlayerName || "相手")} の ${escapeHtml(effect.card?.name || "効果")} を封じました。</p>
        </div>
      </article>
    `,
    "guard",
  );
}

function showExchangeCinematic(effect) {
  enqueueCinematic(
    `
      <article class="cinematic-exchange">
        <div class="exchange-player left">
          <span>${escapeHtml(effect.playerName)}</span>
          <img src="${CARD_BACK_IMAGE}" alt="${escapeHtml(effect.playerName)} の手札" />
        </div>
        <div class="exchange-center">
          <span>SWAP</span>
          <strong>手札を交換</strong>
        </div>
        <div class="exchange-player right">
          <span>${escapeHtml(effect.targetName)}</span>
          <img src="${CARD_BACK_IMAGE}" alt="${escapeHtml(effect.targetName)} の手札" />
        </div>
      </article>
    `,
    "exchange",
  );
}

function showCardSpotlight(action) {
  const card = action.card;
  if (!card) {
    return;
  }

  enqueueCinematic(
    `
      <article class="cinematic-card-use tone-${card.tone}">
        <div class="cinematic-ribbon">CARD PLAY</div>
        <img src="${getCardImage(card)}" alt="${escapeHtml(card.name)}" />
        <div class="cinematic-copy">
          <span>${escapeHtml(action.playerName)} が使用</span>
          <strong>${card.value} ${escapeHtml(card.name)}</strong>
          <p>${escapeHtml(getCardType(card.value)?.effect || "")}</p>
        </div>
      </article>
    `,
    "card-use",
  );
}

function showEliminationCinematic(player) {
  enqueueCinematic(
    `
      <article class="cinematic-elimination">
        <div class="slash-mark">×</div>
        <div>
          <span>ELIMINATED</span>
          <strong>${escapeHtml(player.name)}</strong>
          <p>このラウンドから脱落しました。</p>
        </div>
      </article>
    `,
    "elimination",
  );
}

function showWinnerCinematic(nextState) {
  const winners = nextState.players.filter((player) =>
    nextState.roundWinnerIds.includes(player.id),
  );
  const title = nextState.phase === "gameOver" ? "GAME WINNER" : "ROUND WINNER";
  const names = winners.map((player) => player.name).join("、") || "勝者なし";

  enqueueCinematic(
    `
      <article class="cinematic-winner">
        <div class="winner-rays"></div>
        <span>${title}</span>
        <strong>${escapeHtml(names)}</strong>
        <p>${nextState.phase === "gameOver" ? "ゲームに勝利しました。" : "ラウンドを制しました。"}</p>
      </article>
    `,
    "winner",
  );
}

function enqueueCinematic(markup, type) {
  cinematicQueue.push({ markup, type });
  playNextCinematic();
}

function playNextCinematic() {
  if (
    isCinematicPlaying ||
    !elements.cinematicLayer ||
    cinematicQueue.length === 0
  ) {
    return;
  }

  const item = cinematicQueue.shift();
  isCinematicPlaying = true;
  elements.cinematicLayer.className = `cinematic-layer show ${item.type}`;
  elements.cinematicLayer.innerHTML = `
    <div class="cinematic-stage">
      ${item.markup}
      <button class="cinematic-dismiss" type="button">クリック / Enter でスキップ</button>
    </div>
  `;
  elements.cinematicLayer.tabIndex = -1;
  elements.cinematicLayer.focus({ preventScroll: true });
  elements.cinematicLayer
    .querySelector(".cinematic-dismiss")
    ?.addEventListener("click", (event) => {
      event.stopPropagation();
      dismissCinematic();
    });
  window.setTimeout(() => {
    if (isCinematicPlaying) {
      dismissCinematic();
    }
  }, getCinematicDuration(item.type));
}

function getCinematicDuration(type) {
  if (type === "winner") return 4200;
  if (type === "duel") return 3900;
  if (["discard", "peek", "guard", "exchange"].includes(type)) return 3600;
  return 3200;
}

function dismissCinematic() {
  if (!isCinematicPlaying || !elements.cinematicLayer) {
    return;
  }

  elements.cinematicLayer.classList.add("leaving");
  window.setTimeout(() => {
    elements.cinematicLayer.className = "cinematic-layer";
    elements.cinematicLayer.innerHTML = "";
    isCinematicPlaying = false;
    playNextCinematic();
  }, 260);
}

function updateSoundButton() {
  if (!elements.soundToggleButton) {
    return;
  }

  elements.soundToggleButton.textContent = soundEnabled
    ? "音/BGM ON"
    : "音/BGM OFF";
  elements.soundToggleButton.setAttribute("aria-pressed", String(soundEnabled));
}

function unlockAudio() {
  if (!soundEnabled) {
    return;
  }

  if (audioContext) {
    if (audioContext.state === "suspended") {
      audioContext.resume().then(syncBackgroundMusic).catch(() => {});
    }
    return;
  }

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    return;
  }

  audioContext = new AudioContext();
}

function syncBackgroundMusic() {
  if (!soundEnabled || !state?.roomCode || document.hidden) {
    stopBackgroundMusic();
    return;
  }

  startBackgroundMusic();
}

function startBackgroundMusic() {
  if (musicTimerId) {
    return;
  }

  unlockAudio();
  if (!audioContext || audioContext.state === "suspended") {
    return;
  }

  scheduleBackgroundMusicStep();
  musicTimerId = window.setInterval(scheduleBackgroundMusicStep, 480);
}

function stopBackgroundMusic() {
  if (!musicTimerId) {
    return;
  }

  window.clearInterval(musicTimerId);
  musicTimerId = 0;
  musicStep = 0;
}

function scheduleBackgroundMusicStep() {
  if (!soundEnabled || !state?.roomCode || !audioContext) {
    stopBackgroundMusic();
    return;
  }

  if (audioContext.state === "suspended") {
    return;
  }

  const note =
    BACKGROUND_MUSIC_PATTERN[musicStep % BACKGROUND_MUSIC_PATTERN.length];
  if (note.bass) {
    playTone(note.bass, 0.44, "sine", 0, 0.012);
  }
  if (note.harmony) {
    playTone(note.harmony, 0.34, "sine", 0.02, 0.007);
  }
  if (note.lead) {
    playTone(note.lead, 0.18, "triangle", 0.04, 0.014);
  }
  musicStep += 1;
}

function playSound(type) {
  if (!soundEnabled) {
    return;
  }

  unlockAudio();
  if (!audioContext || audioContext.state === "suspended") {
    return;
  }

  const patterns = {
    tap: [[420, 0.035, "sine", 0]],
    select: [
      [520, 0.045, "triangle", 0],
      [720, 0.05, "triangle", 0.045],
    ],
    play: [
      [260, 0.05, "triangle", 0],
      [520, 0.07, "triangle", 0.04],
    ],
    card: [
      [340, 0.045, "sine", 0],
      [460, 0.05, "sine", 0.04],
    ],
    reveal: [
      [620, 0.07, "sine", 0],
      [920, 0.1, "triangle", 0.06],
    ],
    duel: [
      [220, 0.05, "sawtooth", 0],
      [330, 0.06, "triangle", 0.08],
      [180, 0.07, "sawtooth", 0.18],
      [620, 0.09, "triangle", 0.3],
    ],
    discard: [
      [290, 0.06, "triangle", 0],
      [220, 0.08, "sine", 0.07],
    ],
    guard: [
      [420, 0.08, "sine", 0],
      [630, 0.1, "triangle", 0.08],
      [840, 0.12, "sine", 0.18],
    ],
    exchange: [
      [480, 0.06, "triangle", 0, 0.07],
      [620, 0.08, "triangle", 0.08, 0.075],
      [360, 0.06, "sine", 0.18, 0.06],
      [720, 0.1, "triangle", 0.26, 0.07],
    ],
    start: [
      [330, 0.07, "triangle", 0],
      [495, 0.08, "triangle", 0.07],
      [660, 0.1, "triangle", 0.14],
    ],
    finish: [
      [660, 0.09, "sine", 0],
      [880, 0.11, "triangle", 0.08],
      [990, 0.14, "sine", 0.18],
    ],
    eliminate: [
      [220, 0.08, "sawtooth", 0],
      [150, 0.12, "sawtooth", 0.09],
      [90, 0.16, "triangle", 0.18],
    ],
    winner: [
      [523, 0.16, "triangle", 0, 0.09],
      [659, 0.16, "triangle", 0.02, 0.08],
      [784, 0.18, "triangle", 0.16, 0.09],
      [1046, 0.28, "sine", 0.34, 0.1],
      [1318, 0.18, "sine", 0.62, 0.055],
      [1568, 0.2, "triangle", 0.78, 0.045],
    ],
    gameWinner: [
      [392, 0.18, "triangle", 0, 0.09],
      [523, 0.2, "triangle", 0.1, 0.09],
      [659, 0.24, "triangle", 0.22, 0.095],
      [784, 0.28, "triangle", 0.38, 0.1],
      [1046, 0.32, "sine", 0.58, 0.11],
      [1318, 0.22, "sine", 0.9, 0.06],
      [1568, 0.24, "triangle", 1.08, 0.05],
      [2093, 0.28, "sine", 1.28, 0.045],
    ],
    success: [
      [540, 0.07, "sine", 0],
      [760, 0.08, "triangle", 0.07],
    ],
    error: [
      [180, 0.08, "sawtooth", 0],
      [120, 0.1, "sawtooth", 0.08],
    ],
  };

  (patterns[type] || patterns.tap).forEach(
    ([frequency, duration, wave, delay, volume]) => {
      playTone(frequency, duration, wave, delay, volume);
    },
  );
}

function playTone(frequency, duration, wave, delay = 0, volume = 0.08) {
  const startAt = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}
