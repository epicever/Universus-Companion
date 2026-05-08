const STORAGE_KEY = "universus-companion-state-v1";

const defaultState = {
  players: {
    p1: {
      name: "Player 1",
      life: 35,
      maxLife: 35,
      counter: 0
    },
    p2: {
      name: "Player 2",
      life: 35,
      maxLife: 35,
      counter: 0
    }
  },
  turnPlayer: "p1",
  attack: {
    baseDamage: 0,
    baseSpeed: 0,
    location: "mid"
  },
  continuous: {
    damageBonus: 0,
    speedBonus: 0
  },
  meta: {
    lastDamage: null,
    lastHitPlayer: null
  }
};

const locationLabels = {
  high: "High",
  mid: "Mid",
  low: "Low"
};

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
  finalDamage: document.querySelector("#final-damage"),
  finalSpeed: document.querySelector("#final-speed"),
  damageFormula: document.querySelector("#damage-formula"),
  speedFormula: document.querySelector("#speed-formula"),
  attackLocation: document.querySelector("#attack-location"),
  locationCore: document.querySelector("#location-core"),
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
    player.maxLife = clampNumber(player.maxLife, 1, 999);
    player.life = clampNumber(player.life, 0, 999);
    player.counter = clampNumber(player.counter, -999, 999);
    player.name = String(player.name || defaultState.players[playerId].name).slice(0, 24);
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
  const attacker = state.players[state.turnPlayer];
  const location = state.attack.location;

  hud.finalDamage.textContent = finalDamage;
  hud.finalSpeed.textContent = finalSpeed;
  hud.damageFormula.textContent = `${state.attack.baseDamage} + ${state.continuous.damageBonus}`;
  hud.speedFormula.textContent = `${state.attack.baseSpeed} + ${state.continuous.speedBonus}`;
  hud.attackLocation.textContent = locationLabels[location];
  hud.locationCore.className = `location-core ${location}`;
  hud.turnIndicator.textContent = `${attacker.name} attacking`;

  if (state.meta.lastDamage) {
    const target = state.players[state.meta.lastDamage.defenderId]?.name || "Defender";
    hud.lastDamage.textContent = `${target} took ${state.meta.lastDamage.damageTaken} (${state.meta.lastDamage.blockQuality} block, ${state.meta.lastDamage.blockedAmount} blocked)`;
  } else {
    hud.lastDamage.textContent = "No damage dealt yet";
  }
}

function renderPlayer(playerId) {
  const mount = playerMounts[playerId];
  mount.innerHTML = "";

  const fragment = playerTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".player-card");
  const player = state.players[playerId];
  const isAttacker = state.turnPlayer === playerId;

  card.dataset.player = playerId;
  fragment.querySelector(".player-name").value = player.name;
  fragment.querySelector(".role-badge").textContent = isAttacker ? "Attacking" : "Defending";
  fragment.querySelector(".role-badge").classList.toggle("defending", !isAttacker);
  fragment.querySelector(".life-value").textContent = player.life;
  fragment.querySelector(".max-life-readout").textContent = `/ ${player.maxLife}`;
  fragment.querySelector(".counter-value").textContent = player.counter;
  fragment.querySelector(".max-life-input").value = player.maxLife;

  const rolePanel = fragment.querySelector(".role-panel");
  rolePanel.innerHTML = isAttacker ? getAttackerControls() : getDefenderControls();

  mount.appendChild(fragment);
}

function getAttackerControls() {
  return `
    <section class="attack-controls" aria-label="Attacking player controls">
      ${controlCard("Base Damage", state.attack.baseDamage, "base-damage-dec", "base-damage-inc")}
      ${controlCard("Base Speed", state.attack.baseSpeed, "base-speed-dec", "base-speed-inc")}
      <div class="location-card">
        <header><h3>Attack Location</h3><span class="control-value">${locationLabels[state.attack.location]}</span></header>
        <div class="location-grid">
          ${locationButton("high", "High")}
          ${locationButton("mid", "Mid")}
          ${locationButton("low", "Low")}
        </div>
      </div>
      ${controlCard("Continuous Damage", state.continuous.damageBonus, "cont-damage-dec", "cont-damage-inc")}
      ${controlCard("Continuous Speed", state.continuous.speedBonus, "cont-speed-dec", "cont-speed-inc")}
    </section>
  `;
}

function controlCard(label, value, decAction, incAction) {
  return `
    <div class="control-card">
      <header><h3>${label}</h3><span class="control-value">${value}</span></header>
      <div class="control-stepper">
        <button class="control-btn" data-action="${decAction}" aria-label="Decrease ${label}">−</button>
        <button class="control-btn" data-action="${incAction}" aria-label="Increase ${label}">+</button>
      </div>
    </div>
  `;
}

function locationButton(location, label) {
  const active = state.attack.location === location ? "active" : "";
  return `<button class="control-btn location-btn loc-${location} ${active}" data-action="set-location" data-location="${location}">${label}</button>`;
}

function getDefenderControls() {
  return `
    <section class="block-controls" aria-label="Defending player block controls">
      <button class="block-btn loc-high" data-action="block" data-location="high">High Block</button>
      <button class="block-btn loc-mid" data-action="block" data-location="mid">Mid Block</button>
      <button class="block-btn loc-low" data-action="block" data-location="low">Low Block</button>
    </section>
  `;
}

function animatePendingHit() {
  if (!pendingHitPlayer) return;
  const card = playerMounts[pendingHitPlayer]?.querySelector(".player-card");
  if (card) {
    card.classList.remove("hit-flash");
    requestAnimationFrame(() => card.classList.add("hit-flash"));
  }
  pendingHitPlayer = null;
}

// ---------- Actions ----------
function handleAction(action, button) {
  const playerId = button.closest(".player-card")?.dataset.player;

  const actions = {
    "life-inc": () => changePlayerValue(playerId, "life", 1, 0, 999),
    "life-dec": () => changePlayerValue(playerId, "life", -1, 0, 999),
    "counter-inc": () => changePlayerValue(playerId, "counter", 1, -999, 999),
    "counter-dec": () => changePlayerValue(playerId, "counter", -1, -999, 999),
    "set-max-life": () => setMaxLife(playerId, button),
    "base-damage-inc": () => changeAttackValue("baseDamage", 1),
    "base-damage-dec": () => changeAttackValue("baseDamage", -1),
    "base-speed-inc": () => changeAttackValue("baseSpeed", 1),
    "base-speed-dec": () => changeAttackValue("baseSpeed", -1),
    "cont-damage-inc": () => changeContinuousValue("damageBonus", 1),
    "cont-damage-dec": () => changeContinuousValue("damageBonus", -1),
    "cont-speed-inc": () => changeContinuousValue("speedBonus", 1),
    "cont-speed-dec": () => changeContinuousValue("speedBonus", -1),
    "set-location": () => setAttackLocation(button.dataset.location),
    block: () => applyBlock(button.dataset.location),
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

function setMaxLife(playerId, button) {
  if (!playerId) return;
  const input = button.closest(".max-life-row").querySelector(".max-life-input");
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

  updateState((nextState) => {
    nextState.players[defenderId].life = Math.max(0, nextState.players[defenderId].life - result.damageTaken);
    nextState.meta.lastDamage = { defenderId, ...result };
    nextState.meta.lastHitPlayer = defenderId;
    resetAttackValues(nextState);
  });

  vibrateOnHit(result.damageTaken);
}

function endTurn() {
  updateState((nextState) => {
    resetAttackValues(nextState);
    nextState.continuous.damageBonus = 0;
    nextState.continuous.speedBonus = 0;
    nextState.turnPlayer = nextState.turnPlayer === "p1" ? "p2" : "p1";
    nextState.meta.lastDamage = null;
  });
}

function resetGame() {
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

// ---------- Event delegation ----------
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  handleAction(button.dataset.action, button);
});


document.addEventListener("input", (event) => {
  if (!event.target.matches(".player-name")) return;
  const playerId = event.target.closest(".player-card")?.dataset.player;
  if (!playerId) return;

  state.players[playerId].name = event.target.value.slice(0, 24);
  saveState();
  renderHud();
});

document.addEventListener("change", (event) => {
  if (event.target.matches(".player-name")) {
    const playerId = event.target.closest(".player-card")?.dataset.player;
    if (!playerId) return;
    updateState((nextState) => {
      nextState.players[playerId].name = event.target.value.trim() || defaultState.players[playerId].name;
    });
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches(".player-name")) {
    event.target.blur();
  }
});

render();
