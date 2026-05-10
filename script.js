const STORAGE_KEY = "universus-companion-state-v1";

const defaultState = {
  players: {
    p1: { name: "Player 1", life: 30, maxLife: 30, counter: 0, image: null },
    p2: { name: "Player 2", life: 30, maxLife: 30, counter: 0, image: null }
  },
  turnPlayer: "p1",
  attack: { baseDamage: 0, baseSpeed: 0, location: "mid" },
  continuous: { damageBonus: 0, speedBonus: 0 },
  meta: { lastDamage: null, lastHitPlayer: null, healthDefaultVersion: 30 }
};

const uiState = {
  expandedRowId: null,
  pendingBlock: null,
  maxLifePlayerId: null,
  lifePressTimer: null,
  suppressNextLifeClick: false,
  lastLifeTap: { playerId: null, time: 0 }
};

const controlNames = ["life", "counter", "damage", "speed", "location", "continuous"];
const locationLabels = { high: "High", mid: "Mid", low: "Low" };
const blockTable = {
  high: { high: "full", mid: "half", low: "none" },
  mid: { high: "half", mid: "full", low: "half" },
  low: { high: "none", mid: "half", low: "full" }
};

let state = loadState();
let pendingHitPlayer = null;

const playerTemplate = document.querySelector("#player-template");
const playerMounts = {
  p1: document.querySelector("#player-p1"),
  p2: document.querySelector("#player-p2")
};

const hud = {
  combatBar: document.querySelector("#combat-bar"),
  damageReadouts: document.querySelectorAll('[data-attack-field="damage"]'),
  speedReadouts: document.querySelectorAll('[data-attack-field="speed"]'),
  speedChips: document.querySelectorAll("[data-speed-chip]"),
  turnIndicator: document.querySelector("#turn-indicator"),
  lastDamage: document.querySelector("#last-damage")
};

const blockModal = document.querySelector("#block-modal");

// ---------- State and persistence ----------
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return sanitizeState({ ...structuredClone(defaultState), ...saved });
  } catch {
    return structuredClone(defaultState);
  }
}

function sanitizeState(nextState) {
  const merged = structuredClone(defaultState);

  if (nextState?.players) {
    ["p1", "p2"].forEach((playerId) => {
      merged.players[playerId] = {
        ...merged.players[playerId],
        ...(nextState.players[playerId] || {})
      };
    });
  }

  merged.turnPlayer = nextState?.turnPlayer === "p2" ? "p2" : "p1";
  merged.attack = { ...merged.attack, ...(nextState?.attack || {}) };
  merged.continuous = { ...merged.continuous, ...(nextState?.continuous || {}) };
  merged.meta = { ...merged.meta, ...(nextState?.meta || {}) };

  ["p1", "p2"].forEach((playerId) => {
    const player = merged.players[playerId];
    if (nextState?.meta?.healthDefaultVersion !== 30 && player.maxLife === 35 && player.life === 35) {
      player.maxLife = 30;
      player.life = 30;
    }
    player.maxLife = clampNumber(player.maxLife, 1, 999);
    player.life = clampNumber(player.life, 0, 999);
    player.counter = clampNumber(player.counter, -999, 999);
    player.name = String(player.name || defaultState.players[playerId].name).slice(0, 24);
    player.image = typeof player.image === "string" && player.image.startsWith("data:image/") ? player.image : null;
  });

  merged.attack.baseDamage = clampNumber(merged.attack.baseDamage, -99, 999);
  merged.attack.baseSpeed = clampNumber(merged.attack.baseSpeed, -99, 999);
  merged.attack.location = locationLabels[merged.attack.location] ? merged.attack.location : "mid";
  merged.continuous.damageBonus = clampNumber(merged.continuous.damageBonus, -99, 999);
  merged.continuous.speedBonus = clampNumber(merged.continuous.speedBonus, -99, 999);

  return merged;
}

function updateState(mutator) {
  mutator(state);
  state = sanitizeState(state);
  saveState();
  render();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------- Derived game values ----------
function getFinalDamage() {
  return Math.max(0, state.attack.baseDamage + state.continuous.damageBonus);
}

function getFinalSpeed() {
  return Math.max(0, state.attack.baseSpeed + state.continuous.speedBonus);
}

function getDefenderId() {
  return state.turnPlayer === "p1" ? "p2" : "p1";
}

function getBlockResult(blockLocation) {
  const finalDamage = getFinalDamage();
  const blockQuality = blockTable[state.attack.location][blockLocation];
  const blockedAmount = blockQuality === "full" ? finalDamage : blockQuality === "half" ? Math.floor(finalDamage / 2) : 0;

  return {
    blockQuality,
    blockedAmount,
    damageTaken: Math.max(0, finalDamage - blockedAmount)
  };
}

function resetAttackValues(nextState) {
  nextState.attack.baseDamage = 0;
  nextState.attack.baseSpeed = 0;
  nextState.attack.location = "mid";
}

// ---------- Rendering ----------
function render() {
  renderHud();
  renderPlayer("p2");
  renderPlayer("p1");
  renderBlockModal();
  animatePendingHit();
}

function renderHud() {
  const finalDamage = getFinalDamage();
  const finalSpeed = getFinalSpeed();
  const location = state.attack.location;
  const attacker = state.players[state.turnPlayer];

  hud.combatBar.classList.toggle("attacker-p2", state.turnPlayer === "p2");
  hud.combatBar.classList.toggle("attacker-p1", state.turnPlayer === "p1");
  hud.damageReadouts.forEach((readout) => {
    readout.textContent = finalDamage;
  });
  hud.speedReadouts.forEach((readout) => {
    readout.textContent = finalSpeed;
  });
  hud.speedChips.forEach((chip) => {
    chip.className = `combat-chip speed-chip attack-icon-${location}`;
    chip.setAttribute("aria-label", `Speed ${finalSpeed}, ${locationLabels[location]} attack`);
  });
  hud.turnIndicator.textContent = `${attacker.name} attacking`;

  if (state.meta.lastDamage) {
    const target = state.players[state.meta.lastDamage.defenderId]?.name || "Defender";
    hud.lastDamage.textContent = `${target}: ${state.meta.lastDamage.damageTaken} dmg • ${state.meta.lastDamage.blockedAmount} blocked`;
  } else {
    hud.lastDamage.textContent = "No damage yet";
  }
}

function renderPlayer(playerId) {
  const player = state.players[playerId];
  const isAttacker = state.turnPlayer === playerId;
  const fragment = playerTemplate.content.cloneNode(true);
  const panel = fragment.querySelector(".player-panel");
  const playerName = fragment.querySelector(".player-name");
  const avatarThumb = fragment.querySelector(".avatar-thumb");
  const roleBadge = fragment.querySelector(".role-badge");
  const content = fragment.querySelector(".player-content");

  panel.dataset.player = playerId;
  panel.classList.toggle("is-attacker", isAttacker);
  panel.classList.toggle("has-image", Boolean(player.image));
  if (player.image) {
    panel.style.setProperty("--player-image", `url("${player.image}")`);
    avatarThumb.style.backgroundImage = `url("${player.image}")`;
  } else {
    panel.style.removeProperty("--player-image");
    avatarThumb.style.backgroundImage = "";
  }
  playerName.value = player.name;
  roleBadge.textContent = isAttacker ? "Attacking" : "Defending";
  roleBadge.classList.toggle("defending", !isAttacker);

  content.innerHTML = `
    <div class="controls-stack">
      ${statAccordion(playerId, "life", "Life", `${player.life} / ${player.maxLife}`, lifeControls(), "Hold or double-tap Life to set max health")}
      ${statAccordion(playerId, "counter", "Counter", player.counter, stepperControls("counter-dec", "counter-inc", "Counter"))}
      ${isAttacker ? attackerPanel(playerId) : defenderPanel()}
    </div>
  `;

  playerMounts[playerId].innerHTML = "";
  playerMounts[playerId].appendChild(fragment);
}

function attackerPanel(playerId) {
  return `
    ${statAccordion(playerId, "damage", "Damage", getFinalDamage(), stepperControls("base-damage-dec", "base-damage-inc", "Damage"))}
    ${statAccordion(playerId, "location", "Location", locationLabels[state.attack.location], locationControls())}
    ${statAccordion(playerId, "speed", "Speed", getFinalSpeed(), stepperControls("base-speed-dec", "base-speed-inc", "Speed"))}
    ${statAccordion(playerId, "continuous", "Continuous", `D ${formatSigned(state.continuous.damageBonus)} / S ${formatSigned(state.continuous.speedBonus)}`, continuousControls())}
  `;
}

function defenderPanel() {
  return `
    <div class="control-row defender-adjust-grid" aria-label="Defending player attack adjustment controls">
      ${defenderAdjustCard("Attack", getFinalDamage(), "base-damage-dec", "base-damage-inc")}
      ${defenderAdjustCard("Speed", getFinalSpeed(), "base-speed-dec", "base-speed-inc")}
    </div>
    <div class="control-row block-row" aria-label="Defending player block controls">
      <button class="block-btn block-icon-high loc-high" data-action="block" data-location="high" aria-label="High Block"><span>High Block</span></button>
      <button class="block-btn block-icon-mid loc-mid" data-action="block" data-location="mid" aria-label="Mid Block"><span>Mid Block</span></button>
      <button class="block-btn block-icon-low loc-low" data-action="block" data-location="low" aria-label="Low Block"><span>Low Block</span></button>
    </div>
  `;
}

function defenderAdjustCard(label, value, decAction, incAction) {
  return `
    <div class="defender-adjust-card">
      <div class="defender-adjust-readout"><span>${label}</span><strong>${value}</strong></div>
      <button class="control-btn" data-action="${decAction}" aria-label="Decrease ${label}">−</button>
      <button class="control-btn" data-action="${incAction}" aria-label="Increase ${label}">+</button>
    </div>
  `;
}

function statAccordion(playerId, controlName, label, value, controlsMarkup, hint = "") {
  const rowId = getRowId(playerId, controlName);
  const isOpen = uiState.expandedRowId === rowId;
  return `
    <div class="control-row stat-accordion ${isOpen ? "open expanded" : ""}" data-control="${controlName}" data-row-id="${rowId}">
      <button class="stat-card" data-action="toggle-control" data-control="${controlName}" aria-expanded="${isOpen}">
        <span>${label}</span>
        <strong>${value}</strong>
        ${hint ? `<small>${hint}</small>` : ""}
      </button>
      <div class="accordion-body" aria-hidden="${!isOpen}">
        <div class="accordion-inner">${isOpen ? controlsMarkup : ""}</div>
      </div>
    </div>
  `;
}

function stepperControls(decAction, incAction, label) {
  return `
    <div class="control-strip two-up">
      <button class="control-btn" data-action="${decAction}" aria-label="Decrease ${label}">−1</button>
      <button class="control-btn" data-action="${incAction}" aria-label="Increase ${label}">+1</button>
    </div>
  `;
}

function lifeControls() {
  return stepperControls("life-dec", "life-inc", "Life");
}

function continuousControls() {
  return `
    <div class="control-strip four-up">
      <button class="control-btn" data-action="cont-damage-dec">D−</button>
      <button class="control-btn" data-action="cont-damage-inc">D+</button>
      <button class="control-btn" data-action="cont-speed-dec">S−</button>
      <button class="control-btn" data-action="cont-speed-inc">S+</button>
    </div>
  `;
}

function locationControls() {
  return `
    <div class="control-strip three-up">
      ${locationButton("high", "High")}
      ${locationButton("mid", "Mid")}
      ${locationButton("low", "Low")}
    </div>
  `;
}

function locationButton(location, label) {
  const active = state.attack.location === location ? "active" : "";
  return `<button class="control-btn location-btn attack-icon-${location} loc-${location} ${active}" data-action="set-location" data-location="${location}" aria-label="${label} attack location" title="${label} attack location"></button>`;
}

function renderMaxLifeModal() {
  const playerId = uiState.maxLifePlayerId;
  const player = state.players[playerId];

  if (!player) return false;

  blockModal.classList.remove("hidden");
  blockModal.classList.toggle("max-life-p2", playerId === "p2");
  blockModal.classList.toggle("max-life-p1", playerId === "p1");
  blockModal.classList.remove("defender-p1", "defender-p2");
  blockModal.innerHTML = `
    <div class="block-modal-backdrop" data-action="close-max-life-modal"></div>
    <div class="block-modal-card max-life-modal-card glass-card" role="dialog" aria-modal="true" aria-label="Set ${player.name} max health">
      <header class="block-modal-header">
        <span>${player.name} Max Health</span>
        <button class="btn btn-xs btn-ghost" data-action="close-max-life-modal" aria-label="Cancel max health">✕</button>
      </header>
      <p class="block-modal-copy">Current life: ${player.life} / ${player.maxLife}</p>
      <div class="control-strip max-life-controls max-life-popup-controls">
        <input class="input input-bordered input-sm max-life-input" type="number" min="1" max="999" inputmode="numeric" value="${player.maxLife}" aria-label="Max life" />
        <button class="control-btn set-btn" data-action="set-max-life-popup" data-player="${playerId}">Set</button>
      </div>
    </div>
  `;

  requestAnimationFrame(() => {
    const input = blockModal.querySelector(".max-life-input");
    input?.focus();
    input?.select();
  });

  return true;
}

function renderBlockModal() {
  if (renderMaxLifeModal()) return;

  blockModal.classList.toggle("defender-p2", getDefenderId() === "p2");
  blockModal.classList.toggle("defender-p1", getDefenderId() === "p1");
  blockModal.classList.remove("max-life-p1", "max-life-p2");

  if (!uiState.pendingBlock) {
    blockModal.classList.add("hidden");
    blockModal.innerHTML = "";
    return;
  }

  const { blockLocation, bonus, difficulty } = uiState.pendingBlock;
  const blockLabel = locationLabels[blockLocation];
  blockModal.classList.remove("hidden");

  if (bonus === null) {
    blockModal.innerHTML = `
      <div class="block-modal-backdrop" data-action="close-block-modal"></div>
      <div class="block-modal-card glass-card" role="dialog" aria-modal="true" aria-label="Choose ${blockLabel} block bonus">
        <header class="block-modal-header">
          <span>${blockLabel} Block</span>
          <button class="btn btn-xs btn-ghost" data-action="close-block-modal" aria-label="Cancel block">✕</button>
        </header>
        <p class="block-modal-copy">Choose block modifier</p>
        <div class="block-bonus-grid">
          ${[0, 1, 2, 3, 4, 5, 6].map((value) => blockBonusButton(blockLocation, value)).join("")}
        </div>
      </div>
    `;
    return;
  }

  blockModal.innerHTML = `
    <div class="block-modal-backdrop" data-action="close-block-modal"></div>
    <div class="block-modal-card glass-card" role="dialog" aria-modal="true" aria-label="${blockLabel} block result">
      <header class="block-modal-header">
        <span>${blockLabel} Block ${formatSigned(bonus)}</span>
        <button class="btn btn-xs btn-ghost" data-action="close-block-modal" aria-label="Cancel block">✕</button>
      </header>
      <div class="difficulty-readout block-icon-${blockLocation}">
        <span>Difficulty</span>
        <strong>${difficulty}</strong>
        <small>${formatSigned(bonus)} block + ${getFinalSpeed()} speed</small>
      </div>
      <div class="block-result-actions">
        <button class="btn btn-success" data-action="block-success">Success</button>
        <button class="btn btn-error" data-action="block-fail">Fail</button>
      </div>
    </div>
  `;
}

function blockBonusButton(blockLocation, value) {
  const blockLabel = locationLabels[blockLocation];
  return `
    <button class="block-bonus-btn block-icon-${blockLocation}" data-action="block-bonus" data-bonus="${value}" aria-label="${blockLabel} block ${formatSigned(value)}">
      <span>${formatSigned(value)}</span>
    </button>
  `;
}

function animatePendingHit() {
  if (!pendingHitPlayer) return;
  const panel = playerMounts[pendingHitPlayer]?.querySelector(".player-panel");
  if (panel) {
    panel.classList.remove("hit-flash");
    requestAnimationFrame(() => panel.classList.add("hit-flash"));
  }
  pendingHitPlayer = null;
}

// ---------- UI accordion actions ----------
function getRowId(playerId, controlName) {
  return `${playerId}:${controlName}`;
}

function hasExpandedRow(playerId) {
  return typeof uiState.expandedRowId === "string" && uiState.expandedRowId.startsWith(`${playerId}:`);
}

function toggleControl(playerId, controlName) {
  if (!playerId || !controlNames.includes(controlName)) return;
  const rowId = getRowId(playerId, controlName);
  uiState.expandedRowId = uiState.expandedRowId === rowId ? null : rowId;
  render();
}

function closeAllControls() {
  uiState.expandedRowId = null;
  uiState.pendingBlock = null;
  uiState.maxLifePlayerId = null;
}

function closePlayerControls(playerId) {
  if (!playerId || !hasExpandedRow(playerId)) return;
  uiState.expandedRowId = null;
}

// ---------- Game actions ----------
function handleAction(action, element) {
  const playerId = element.closest(".player-panel")?.dataset.player;

  if (action === "toggle-control" && element.dataset.control === "life") {
    if (uiState.suppressNextLifeClick) {
      uiState.suppressNextLifeClick = false;
      return;
    }

    const now = Date.now();
    if (uiState.lastLifeTap.playerId === playerId && now - uiState.lastLifeTap.time < 360) {
      uiState.lastLifeTap = { playerId: null, time: 0 };
      openMaxLifeModal(playerId);
      return;
    }
    uiState.lastLifeTap = { playerId, time: now };
  }

  const actions = {
    "toggle-control": () => toggleControl(playerId, element.dataset.control),
    "choose-image": () => chooseImage(playerId, element),
    "life-inc": () => changePlayerValue(playerId, "life", 1, 0, 999),
    "life-dec": () => changePlayerValue(playerId, "life", -1, 0, 999),
    "counter-inc": () => changePlayerValue(playerId, "counter", 1, -999, 999),
    "counter-dec": () => changePlayerValue(playerId, "counter", -1, -999, 999),
    "set-max-life-popup": () => setMaxLifeFromPopup(element.dataset.player, element),
    "base-damage-inc": () => changeAttackValue("baseDamage", 1),
    "base-damage-dec": () => changeAttackValue("baseDamage", -1),
    "base-speed-inc": () => changeAttackValue("baseSpeed", 1),
    "base-speed-dec": () => changeAttackValue("baseSpeed", -1),
    "cont-damage-inc": () => changeContinuousValue("damageBonus", 1),
    "cont-damage-dec": () => changeContinuousValue("damageBonus", -1),
    "cont-speed-inc": () => changeContinuousValue("speedBonus", 1),
    "cont-speed-dec": () => changeContinuousValue("speedBonus", -1),
    "set-location": () => setAttackLocation(element.dataset.location),
    block: () => openBlockBonusPicker(element.dataset.location),
    "block-bonus": () => chooseBlockBonus(element.dataset.bonus),
    "block-success": () => resolvePendingBlock(true),
    "block-fail": () => resolvePendingBlock(false),
    "close-block-modal": closeBlockModal,
    "close-max-life-modal": closeMaxLifeModal,
    "end-turn": endTurn,
    "reset-game": resetGame
  };

  actions[action]?.();
}

function changePlayerValue(playerId, key, delta, min, max) {
  if (!playerId) return;
  updateState((nextState) => {
    nextState.players[playerId][key] = clampNumber(nextState.players[playerId][key] + delta, min, max);
  });
}

function setMaxLifeFromPopup(playerId, element) {
  if (!playerId) return;
  const input = element.closest(".max-life-modal-card").querySelector(".max-life-input");
  const maxLife = clampNumber(input.value, 1, 999);

  uiState.maxLifePlayerId = null;
  updateState((nextState) => {
    nextState.players[playerId].maxLife = maxLife;
    nextState.players[playerId].life = maxLife;
  });
}

function changeAttackValue(key, delta) {
  updateState((nextState) => {
    nextState.attack[key] = clampNumber(nextState.attack[key] + delta, -99, 999);
  });
}

function changeContinuousValue(key, delta) {
  updateState((nextState) => {
    nextState.continuous[key] = clampNumber(nextState.continuous[key] + delta, -99, 999);
  });
}

function setAttackLocation(location) {
  if (!locationLabels[location]) return;
  updateState((nextState) => {
    nextState.attack.location = location;
  });
}

function openBlockBonusPicker(blockLocation) {
  if (!locationLabels[blockLocation]) return;
  uiState.pendingBlock = { blockLocation, bonus: null, difficulty: null };
  render();
}

function chooseBlockBonus(rawBonus) {
  if (!uiState.pendingBlock) return;
  const bonus = clampNumber(rawBonus, 0, 6);
  uiState.pendingBlock = {
    ...uiState.pendingBlock,
    bonus,
    difficulty: bonus + getFinalSpeed()
  };
  renderBlockModal();
}

function closeBlockModal() {
  uiState.pendingBlock = null;
  renderBlockModal();
}

function openMaxLifeModal(playerId) {
  if (!state.players[playerId]) return;
  closeAllControls();
  uiState.maxLifePlayerId = playerId;
  renderBlockModal();
}

function closeMaxLifeModal() {
  uiState.maxLifePlayerId = null;
  renderBlockModal();
}

function resolvePendingBlock(success) {
  if (!uiState.pendingBlock) return;
  const { blockLocation, bonus, difficulty } = uiState.pendingBlock;
  if (!locationLabels[blockLocation] || bonus === null) return;

  const defenderId = getDefenderId();
  const result = success
    ? getBlockResult(blockLocation)
    : { blockQuality: "failed", blockedAmount: 0, damageTaken: getFinalDamage() };

  pendingHitPlayer = defenderId;
  closePlayerControls(defenderId);
  uiState.pendingBlock = null;

  updateState((nextState) => {
    nextState.players[defenderId].life = Math.max(0, nextState.players[defenderId].life - result.damageTaken);
    nextState.meta.lastDamage = { defenderId, blockLocation, bonus, difficulty, success, ...result };
    nextState.meta.lastHitPlayer = defenderId;
    resetAttackValues(nextState);
  });

  vibrateOnHit(result.damageTaken);
}

function endTurn() {
  closeAllControls();
  updateState((nextState) => {
    resetAttackValues(nextState);
    nextState.continuous.damageBonus = 0;
    nextState.continuous.speedBonus = 0;
    nextState.turnPlayer = nextState.turnPlayer === "p1" ? "p2" : "p1";
    nextState.meta.lastDamage = null;
  });
}

function resetGame() {
  closeAllControls();
  updateState((nextState) => {
    ["p1", "p2"].forEach((playerId) => {
      nextState.players[playerId].life = nextState.players[playerId].maxLife;
      nextState.players[playerId].counter = 0;
    });
    resetAttackValues(nextState);
    nextState.continuous.damageBonus = 0;
    nextState.continuous.speedBonus = 0;
    nextState.turnPlayer = "p1";
    nextState.meta.lastDamage = null;
    nextState.meta.lastHitPlayer = null;
  });
}

function chooseImage(playerId, element) {
  if (!playerId) return;
  const input = element.closest(".player-panel").querySelector(".image-input");
  input?.click();
}

function setPlayerImage(playerId, imageDataUrl) {
  if (!playerId) return;
  updateState((nextState) => {
    nextState.players[playerId].image = imageDataUrl;
  });
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 900;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function vibrateOnHit(damageTaken) {
  if (damageTaken > 0 && "vibrate" in navigator) {
    navigator.vibrate([18, 24, 18]);
  }
}

function clampNumber(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function formatSigned(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function getLifeCardPlayerId(element) {
  return element.closest(".player-panel")?.dataset.player;
}

function clearLifePressTimer() {
  if (!uiState.lifePressTimer) return;
  clearTimeout(uiState.lifePressTimer);
  uiState.lifePressTimer = null;
}

// ---------- Event delegation ----------
document.addEventListener("pointerdown", (event) => {
  const lifeCard = event.target.closest('.stat-card[data-control="life"]');
  if (!lifeCard) return;
  const playerId = getLifeCardPlayerId(lifeCard);
  if (!playerId) return;

  clearLifePressTimer();
  uiState.lifePressTimer = setTimeout(() => {
    uiState.lifePressTimer = null;
    uiState.suppressNextLifeClick = true;
    openMaxLifeModal(playerId);
  }, 1000);
});

document.addEventListener("pointerup", clearLifePressTimer);
document.addEventListener("pointercancel", clearLifePressTimer);
document.addEventListener("pointerleave", clearLifePressTimer);

document.addEventListener("dblclick", (event) => {
  const lifeCard = event.target.closest('.stat-card[data-control="life"]');
  if (!lifeCard) return;
  event.preventDefault();
  openMaxLifeModal(getLifeCardPlayerId(lifeCard));
});

document.addEventListener("click", (event) => {
  const actionable = event.target.closest("[data-action]");
  if (!actionable) return;
  handleAction(actionable.dataset.action, actionable);
});

document.addEventListener("input", (event) => {
  if (!event.target.matches(".player-name")) return;
  const playerId = event.target.closest(".player-panel")?.dataset.player;
  if (!playerId) return;

  state.players[playerId].name = event.target.value.slice(0, 24);
  saveState();
  renderHud();
});


document.addEventListener("change", async (event) => {
  if (!event.target.matches(".image-input")) return;
  const playerId = event.target.closest(".player-panel")?.dataset.player;
  const file = event.target.files?.[0];
  if (!playerId || !file) return;

  const imageDataUrl = await resizeImage(file);
  setPlayerImage(playerId, imageDataUrl);
  event.target.value = "";
});

document.addEventListener("change", (event) => {
  if (!event.target.matches(".player-name")) return;
  const playerId = event.target.closest(".player-panel")?.dataset.player;
  if (!playerId) return;

  updateState((nextState) => {
    nextState.players[playerId].name = event.target.value.trim() || defaultState.players[playerId].name;
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches(".player-name")) {
    event.target.blur();
  }

  if (event.key === "Enter" && event.target.matches(".max-life-modal-card .max-life-input")) {
    const button = event.target.closest(".max-life-modal-card")?.querySelector('[data-action="set-max-life-popup"]');
    button?.click();
  }

  if (event.key === "Escape" && uiState.maxLifePlayerId) {
    closeMaxLifeModal();
  }
});

render();
