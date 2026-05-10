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
  p1OpenControl: null,
  p2OpenControl: null
};

const controlNames = ["life", "counter", "damage", "speed", "location", "continuous", "maxLife"];
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
    <div class="compact-grid core-grid">
      ${statAccordion(playerId, "life", "Life", `${player.life} / ${player.maxLife}`, lifeControls())}
      ${statAccordion(playerId, "counter", "Counter", player.counter, stepperControls("counter-dec", "counter-inc", "Counter"))}
      ${statAccordion(playerId, "maxLife", "Max", player.maxLife, maxLifeControls(player.maxLife))}
    </div>
    ${isAttacker ? attackerPanel(playerId) : defenderPanel()}
  `;

  playerMounts[playerId].innerHTML = "";
  playerMounts[playerId].appendChild(fragment);
}

function attackerPanel(playerId) {
  return `
    <div class="compact-grid attack-grid">
      ${statAccordion(playerId, "damage", "Damage", getFinalDamage(), stepperControls("base-damage-dec", "base-damage-inc", "Damage"))}
      ${statAccordion(playerId, "location", "Location", locationLabels[state.attack.location], locationControls())}
      ${statAccordion(playerId, "speed", "Speed", getFinalSpeed(), stepperControls("base-speed-dec", "base-speed-inc", "Speed"))}
    </div>
    <div class="compact-grid bonus-grid">
      ${statAccordion(playerId, "continuous", "Continuous", `D ${formatSigned(state.continuous.damageBonus)} / S ${formatSigned(state.continuous.speedBonus)}`, continuousControls())}
    </div>
  `;
}

function defenderPanel() {
  return `
    <div class="compact-grid defender-adjust-grid" aria-label="Defending player attack adjustment controls">
      ${defenderAdjustCard("Attack", getFinalDamage(), "base-damage-dec", "base-damage-inc")}
      ${defenderAdjustCard("Speed", getFinalSpeed(), "base-speed-dec", "base-speed-inc")}
    </div>
    <div class="block-row" aria-label="Defending player block controls">
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

function statAccordion(playerId, controlName, label, value, controlsMarkup) {
  const isOpen = uiState[`${playerId}OpenControl`] === controlName;
  return `
    <div class="stat-accordion ${isOpen ? "open" : ""}" data-control="${controlName}">
      <button class="stat-card" data-action="toggle-control" data-control="${controlName}" aria-expanded="${isOpen}">
        <span>${label}</span>
        <strong>${value}</strong>
      </button>
      <div class="accordion-body" aria-hidden="${!isOpen}">
        <div class="accordion-inner">${controlsMarkup}</div>
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

function maxLifeControls(maxLife) {
  return `
    <div class="control-strip max-life-controls">
      <input class="input input-bordered input-sm max-life-input" type="number" min="1" max="999" inputmode="numeric" value="${maxLife}" aria-label="Max life" />
      <button class="control-btn set-btn" data-action="set-max-life">Set</button>
    </div>
  `;
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
  return `<button class="control-btn location-btn loc-${location} ${active}" data-action="set-location" data-location="${location}">${label}</button>`;
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
function toggleControl(playerId, controlName) {
  if (!playerId || !controlNames.includes(controlName)) return;
  const key = `${playerId}OpenControl`;
  uiState[key] = uiState[key] === controlName ? null : controlName;
  render();
}

function closeAllControls() {
  uiState.p1OpenControl = null;
  uiState.p2OpenControl = null;
}

function closePlayerControls(playerId) {
  if (!playerId) return;
  uiState[`${playerId}OpenControl`] = null;
}

// ---------- Game actions ----------
function handleAction(action, element) {
  const playerId = element.closest(".player-panel")?.dataset.player;

  const actions = {
    "toggle-control": () => toggleControl(playerId, element.dataset.control),
    "choose-image": () => chooseImage(playerId, element),
    "life-inc": () => changePlayerValue(playerId, "life", 1, 0, 999),
    "life-dec": () => changePlayerValue(playerId, "life", -1, 0, 999),
    "counter-inc": () => changePlayerValue(playerId, "counter", 1, -999, 999),
    "counter-dec": () => changePlayerValue(playerId, "counter", -1, -999, 999),
    "set-max-life": () => setMaxLife(playerId, element),
    "base-damage-inc": () => changeAttackValue("baseDamage", 1),
    "base-damage-dec": () => changeAttackValue("baseDamage", -1),
    "base-speed-inc": () => changeAttackValue("baseSpeed", 1),
    "base-speed-dec": () => changeAttackValue("baseSpeed", -1),
    "cont-damage-inc": () => changeContinuousValue("damageBonus", 1),
    "cont-damage-dec": () => changeContinuousValue("damageBonus", -1),
    "cont-speed-inc": () => changeContinuousValue("speedBonus", 1),
    "cont-speed-dec": () => changeContinuousValue("speedBonus", -1),
    "set-location": () => setAttackLocation(element.dataset.location),
    block: () => applyBlock(element.dataset.location),
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

function setMaxLife(playerId, element) {
  if (!playerId) return;
  const input = element.closest(".accordion-inner").querySelector(".max-life-input");
  const maxLife = clampNumber(input.value, 1, 999);

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

function applyBlock(blockLocation) {
  if (!locationLabels[blockLocation]) return;
  const defenderId = getDefenderId();
  const result = getBlockResult(blockLocation);

  pendingHitPlayer = defenderId;
  closePlayerControls(defenderId);

  updateState((nextState) => {
    nextState.players[defenderId].life = Math.max(0, nextState.players[defenderId].life - result.damageTaken);
    nextState.meta.lastDamage = { defenderId, ...result };
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

// ---------- Event delegation ----------
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
});

render();
