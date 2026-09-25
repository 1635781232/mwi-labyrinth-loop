// ==UserScript==
// @name         Milky Way Idle 测试服迷宫循环
// @namespace    https://github.com/1635781232/mwi-labyrinth-loop
// @version      0.5.3
// @description  手动启用后，使用游戏内置自动化循环进入、开始、结束迷宫，并在测试服补充入场券。
// @author       1635781232
// @license      MIT
// @match        https://test.milkywayidle.com/game*
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/1635781232/mwi-labyrinth-loop/main/mwi-labyrinth-loop.user.js
// @downloadURL  https://raw.githubusercontent.com/1635781232/mwi-labyrinth-loop/main/mwi-labyrinth-loop.user.js
// @supportURL   https://github.com/1635781232/mwi-labyrinth-loop/issues
// @homepageURL  https://github.com/1635781232/mwi-labyrinth-loop
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  "use strict";

  const id = "mwi-labyrinth-loop";
  const CLICK_DELAY_MS = 2000;
  const characterId = new URL(location.href).searchParams.get("characterId");
  if (!characterId) return;
  const key = `${id}:state:${characterId}`;
  const lockKey = `${id}:lock:${characterId}`;
  const logKey = `${id}:debug:${characterId}`;
  const owner = `${Date.now()}-${Math.random()}`;
  const saved = GM_getValue(key, {});
  const state = {
    enabled: saved.enabled === true,
    phase: "idle",
    started: false,
    observed: false,
    before: null,
    entryTickets: null,
    entryAttempts: 0,
    since: Date.now(),
    error: "",
  };
  // Preserve a pending run across refreshes of this version.
  if (saved.version === 8 && saved.enabled) {
    Object.assign(state, saved);
  }
  let lastClick = 0;
  let gameSocket = null;
  let status = state.enabled ? "检查迷宫" : "脚本已停用";
  let logs = Array.isArray(GM_getValue(logKey, [])) ? GM_getValue(logKey, []).slice(-100) : [];
  let panel;
  let timer;

  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const label = (element) => text(element?.innerText || element?.textContent);
  const visible = (element) => {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" &&
      style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };
  const disabled = (element) => element.disabled || element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true";
  const buttons = (root = document) => [...root.querySelectorAll("button, a, [role='button']")];
  const button = (names, root = document, allowDisabled = false) => buttons(root).find((element) =>
    visible(element) && (allowDisabled || !disabled(element)) && names.includes(label(element)));

  function save() {
    GM_setValue(key, { ...state, version: 8 });
    render();
  }

  function note(event, details = {}) {
    logs.push({ time: new Date().toISOString(), event, phase: state.phase, ...details });
    logs = logs.slice(-100);
    GM_setValue(logKey, logs);
    render();
  }

  function phase(next, message) {
    if (state.phase !== next) {
      note("phase", { from: state.phase, to: next });
      state.phase = next;
      state.since = Date.now();
    }
    status = message;
    save();
  }

  function pause(message) {
    state.error = message;
    phase("paused", message);
    note("paused", { message });
  }

  function click(element, action) {
    if (!element || !visible(element) || disabled(element) || Date.now() - lastClick < CLICK_DELAY_MS) return false;
    lastClick = Date.now();
    note("click", { action, target: label(element) });
    element.click();
    return true;
  }

  // HTMLElement.click() did not start the labyrinth in the live page.
  // Capture the game's existing WebSocket as messages arrive.
  const dataDescriptor = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data");
  if (dataDescriptor?.get) {
    Object.defineProperty(MessageEvent.prototype, "data", {
      configurable: true,
      get() {
        const value = dataDescriptor.get.call(this);
        const socket = this.currentTarget;
        if (socket instanceof WebSocket && socket.url.includes("milkywayidle.com/ws")) {
          gameSocket = socket;
        }
        return value;
      },
    });
  }

  function sendGame(type, data, action) {
    if (Date.now() - lastClick < CLICK_DELAY_MS) return false;
    if (!gameSocket || gameSocket.readyState !== WebSocket.OPEN) {
      status = "等待游戏连接，暂不发送操作";
      return false;
    }
    try {
      gameSocket.send(JSON.stringify({ type, ...data, ts: Date.now() }));
      lastClick = Date.now();
      note("request", { action, type });
      return true;
    } catch (error) {
      pause(`游戏请求发送失败：${error?.message || error}`);
      return false;
    }
  }

  function startExplore() {
    return sendGame("new_character_action", {
      newCharacterActionData: {
        actionHrid: "/actions/labyrinth/explore",
        difficultyTier: 0,
        hasMaxCount: false,
        maxCount: 0,
        primaryItemHash: "",
        secondaryItemHash: "",
        enhancingMaxLevel: 0,
        enhancingProtectionMinLevel: 0,
        characterLoadoutId: 0,
        isStartNow: true,
        confirmedActionValueWarning: false,
      },
    }, "开始迷宫");
  }

  function lock() {
    const now = Date.now();
    let current;
    try { current = JSON.parse(localStorage.getItem(lockKey) || "null"); } catch { current = null; }
    if (current && current.owner !== owner && now - current.time < 15000) return false;
    localStorage.setItem(lockKey, JSON.stringify({ owner, time: now }));
    try { return JSON.parse(localStorage.getItem(lockKey)).owner === owner; } catch { return false; }
  }

  function unlock() {
    try {
      if (JSON.parse(localStorage.getItem(lockKey) || "null")?.owner === owner) localStorage.removeItem(lockKey);
    } catch { /* Ignore malformed lock state. */ }
  }

  function navigate(section) {
    const icon = document.querySelector(`svg[aria-label="navigationBar.${section}"]`);
    const target = icon?.closest("button, a, [role='button'], [class*='NavigationBar_navigationLink']") ||
      icon?.parentElement;
    return click(target, `打开${section === "settings" ? "设置" : "迷宫"}`);
  }

  function activeMaze() {
    const end = button(["结束迷宫", "逃出迷宫", "Escape Labyrinth"], document, true);
    if (!end) return null;
    const root = end.closest("[class*='LabyrinthPanel_labyrinthPanel']") || document;
    return {
      end,
      start: button(["立即开始", "开始", "Start Now", "Start"], root),
      stop: button(["停止", "Stop"], root),
      progress: progress(root),
      targetFloor: automationTarget(root),
    };
  }

  function automationTarget(root) {
    const setting = [...root.querySelectorAll("[class*='LabyrinthPanel_settingLabel']")]
      .find((element) => label(element).startsWith("完全自动化到层数"));
    const value = text(setting?.parentElement?.querySelector("[role='combobox']")?.textContent);
    return /^\d+$/.test(value) ? Number(value) : null;
  }

  function progress(root) {
    const floorLabel = root.querySelector("[class*='LabyrinthPanel_buttonsSection'] [class*='LabyrinthPanel_label']");
    const floor = label(floorLabel).match(/第\s*(\d+)\s*层|Floor\s*(\d+)/i);
    const torch = root.querySelector("svg[aria-label*='火把'], svg[aria-label*='torch' i]");
    const count = text(torch?.closest("[class*='Item_itemContainer']")?.querySelector("[class*='Item_count']")?.textContent);
    return {
      floor: floor ? Number(floor[1] || floor[2]) : null,
      torches: /^\d+$/.test(count) ? Number(count) : null,
    };
  }

  function progressed(before, after) {
    return Boolean(before && (
      (before.floor !== null && after.floor !== null && before.floor !== after.floor) ||
      (before.torches !== null && after.torches !== null && after.torches < before.torches)
    ));
  }

  function entries() {
    const match = text(document.body.innerText).match(/入场券\s*[:：]?\s*(\d+)\s*\/\s*(\d+)|(?:Labyrinth\s+)?Entries\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/i);
    return match ? { current: Number(match[1] || match[3]), max: Number(match[2] || match[4]) } : null;
  }

  function unknownDialog() {
    return [...document.querySelectorAll("[role='dialog'], [role='alertdialog'], [aria-modal='true']")]
      .some((dialog) => visible(dialog) && label(dialog));
  }

  function closeWelcomeBack() {
    const title = [...document.querySelectorAll("h1, h2, h3, h4, div, span")]
      .find((element) => visible(element) && /^(欢迎回来[！!]?|Welcome Back[!]?)$/i.test(label(element)));
    if (!title) return false;
    for (let container = title.parentElement, depth = 0; container && depth < 6; container = container.parentElement, depth++) {
      const content = label(container);
      if (!/离线时间|Offline Time/i.test(content)) continue;
      const close = button(["关闭", "Close"], container);
      if (!close) continue;
      if (click(close, "关闭离线回归弹窗")) {
        status = "已关闭离线回归弹窗，继续检查迷宫";
        if (state.phase === "paused" && /未知弹窗/.test(state.error)) {
          state.error = "";
          phase("idle", status);
        }
      } else {
        status = "等待操作间隔后关闭离线回归弹窗";
      }
      return true;
    }
    return false;
  }

  function resetRun() {
    state.started = false;
    state.observed = false;
    state.before = null;
    state.entryTickets = null;
    state.entryAttempts = 0;
    state.error = "";
    phase("idle", "迷宫已结束，准备下一轮");
    note("mazeEnded");
  }

  function runMaze(maze) {
    if (state.phase === "ending") {
      if (Date.now() - state.since > 60000) pause("退出请求发送后 60 秒仍未完成");
      else status = "等待游戏确认退出";
      return;
    }
    if (unknownDialog()) return pause("迷宫出现未知弹窗，请手动处理");
    if (state.phase !== "waiting") phase("waiting", "迷宫已进入，准备开始");
    if (maze.stop) {
      state.started = true;
      state.observed = true;
      status = "游戏内置自动化正在执行";
      save();
      return;
    }
    if (maze.start && maze.targetFloor !== null && maze.progress.floor !== null &&
        maze.progress.floor >= maze.targetFloor) {
      if (sendGame("escape_labyrinth", {}, "到达自动化目标层，结束迷宫"))
        phase("ending", "等待游戏确认退出");
      return;
    }
    if (!state.started) {
      if (maze.start && startExplore()) {
        state.started = true;
        state.before = maze.progress;
        phase("waiting", "已发送开始请求，等待游戏执行");
      } else status = "等待开始按钮";
      return;
    }
    if (!state.observed && progressed(state.before, maze.progress)) {
      state.observed = true;
      note("automationProgress", { before: state.before, after: maze.progress });
      save();
    }
    if (!state.observed || !maze.start) {
      status = "等待游戏内置自动化执行完毕";
      return;
    }
    if (sendGame("escape_labyrinth", {}, "内置自动化结束，退出迷宫"))
      phase("ending", "等待游戏确认退出");
  }

  function refill() {
    if (unknownDialog()) return pause("补充入场券出现弹窗，请手动处理");
    if (state.phase === "refillClicked") {
      if (Date.now() - state.since < 1500) return;
      if (navigate("labyrinth")) phase("refillVerify", "返回迷宫核对入场券");
      return;
    }
    if (state.phase === "refillVerify") {
      const tickets = entries();
      if (tickets?.current > 0) phase("idle", `已补充入场券 ${tickets.current}/${tickets.max}`);
      else if (Date.now() - state.since > 20000) pause("补票后无法确认入场券增加");
      return;
    }
    const refillButton = buttons().find((element) =>
      visible(element) && ["补充入场券", "补充迷宫入场券", "Refill Entries"].includes(label(element)));
    if (refillButton) {
      if (disabled(refillButton)) {
        phase("refill", "补票冷却中，等待按钮可用");
      } else if (sendGame("force_refill_labyrinth_entries", {}, "补充入场券")) {
        phase("refillClicked", "已发送补票请求，等待页面更新");
      }
      return;
    }
    if (navigate("settings")) phase("refill", "打开设置，寻找补票按钮");
    else if (Date.now() - state.since > 20000) pause("找不到补票按钮");
  }

  function tick() {
    mountPanel();
    if (!state.enabled) return;
    if (!lock()) { status = "同角色的另一标签页正在运行"; render(); return; }
    try {
      if (closeWelcomeBack()) return;
      if (state.phase === "paused") return;
      const maze = activeMaze();
      if (maze) return runMaze(maze);
      if (state.phase === "ending") {
        if (button(["进入迷宫", "Enter Labyrinth"])) resetRun();
        else if (Date.now() - state.since > 60000) pause("无法确认迷宫已退出");
        return;
      }
      if (state.phase === "waiting") {
        navigate("labyrinth");
        status = "等待迷宫页面恢复";
        return;
      }
      if (state.phase === "entering") {
        if (unknownDialog()) return pause("入场时出现弹窗，请手动处理");
        const tickets = entries();
        if (state.entryTickets === null && tickets) {
          state.entryTickets = tickets.current;
          state.entryAttempts = 1;
          state.since = Date.now();
          save();
        }
        if (tickets && state.entryTickets !== null && tickets.current < state.entryTickets) {
          status = "入场券已扣除，等待迷宫页面出现";
        } else if (tickets && tickets.current === state.entryTickets &&
                   button(["进入迷宫", "Enter Labyrinth"]) && Date.now() - state.since >= 15000) {
          if (state.entryAttempts < 2 && sendGame("start_labyrinth", { startLabyrinthData: {} }, "重试进入迷宫")) {
            state.entryAttempts++;
            state.since = Date.now();
            save();
          } else if (state.entryAttempts >= 2) pause("入场请求后票数和页面均未变化，请检查游戏连接");
        } else {
          status = "等待游戏创建迷宫";
        }
        if (state.phase === "entering" && Date.now() - state.since > 60000) {
          pause("入场券已扣除但迷宫页面未出现，请检查游戏连接");
        }
        return;
      }
      if (state.phase.startsWith("refill")) return refill();
      if (unknownDialog()) return pause("页面出现未知弹窗，请手动处理");
      const tickets = entries();
      if (!tickets) { navigate("labyrinth"); status = "打开迷宫主界面"; return; }
      if (tickets.current === 0) {
        phase("refill", "入场券为 0，准备打开设置补票");
        return refill();
      }
      const enter = button(["进入迷宫", "Enter Labyrinth"]);
      if (enter && sendGame("start_labyrinth", { startLabyrinthData: {} }, "进入迷宫")) {
        state.entryTickets = tickets.current;
        state.entryAttempts = 1;
        phase("entering", "已发送入场请求，等待迷宫页面");
      }
      else status = "等待进入迷宫按钮";
    } catch (error) {
      console.error(`[${id}]`, error);
      pause(`脚本异常：${error?.message || error}`);
    } finally {
      render();
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(tick, 150);
  }

  function retry() {
    state.error = "";
    const maze = activeMaze();
    if (maze) {
      if (state.phase === "ending") phase("ending", "继续处理退出确认");
      else phase("waiting", "重新检查当前迷宫");
    } else {
      state.entryTickets = null;
      state.entryAttempts = 0;
      phase("idle", "重新检查迷宫入口");
    }
    schedule();
  }

  function toggle() {
    state.enabled = !state.enabled;
    if (!state.enabled) {
      unlock();
      state.started = false;
      state.observed = false;
      state.before = null;
      phase("idle", "脚本已停用");
    } else {
      phase("idle", "脚本已启用");
      schedule();
    }
    note(state.enabled ? "enabled" : "disabled");
  }

  function render() {
    if (!panel) return;
    panel.host.dataset.phase = state.phase;
    panel.host.dataset.status = status;
    panel.toggle.textContent = state.enabled ? "停用" : "启用";
    panel.status.textContent = status;
    panel.status.title = status;
    panel.meta.textContent = `角色 ${characterId} · ${state.phase}`;
    panel.retry.hidden = state.phase !== "paused";
    panel.details.hidden = !panel.detailsOpen && state.phase !== "paused";
    panel.expand.textContent = panel.details.hidden ? "详情" : "收起";
    panel.latest.textContent = logs.slice(-3).map((item) => `${item.time.slice(11, 19)} ${item.event} ${item.action || item.message || ""}`).join("\n");
  }

  function mountPanel() {
    if (!panel) return;
    if (panel.host.parentElement !== document.body && visible(panel.host.parentElement)) {
      panel.host.hidden = false;
      return;
    }
    const names = ["迷宫", "房间", "自动化", "迷宫商店"];
    const matches = [...document.querySelectorAll("button, a, [role='tab'], [role='button'], div, span")]
      .filter((element) => names.includes(label(element)) && visible(element));
    const branch = (element, ancestor) => {
      for (let node = element; node && node !== ancestor; node = node.parentElement) {
        if (node.parentElement === ancestor) return node;
      }
      return null;
    };
    let bar = null;
    for (const mazeTab of matches.filter((element) => label(element) === "迷宫")) {
      for (let ancestor = mazeTab.parentElement, depth = 0; ancestor && depth < 5;
        ancestor = ancestor.parentElement, depth++) {
        const branches = names.map((name) => matches
          .filter((element) => label(element) === name)
          .map((element) => branch(element, ancestor)).find(Boolean));
        if (branches.every(Boolean) && new Set(branches).size === names.length) {
          bar = ancestor;
          break;
        }
      }
      if (bar) break;
    }
    if (!bar) {
      panel.host.hidden = true;
      return;
    }
    if (panel.host.parentElement !== bar) bar.appendChild(panel.host);
    panel.host.hidden = false;
  }

  function createPanel() {
    const host = document.createElement("div");
    host.id = `${id}-host`;
    host.hidden = true;
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { display: inline-flex; align-self: center; margin-left: 8px; font: 11px sans-serif; }
      :host([hidden]), [hidden] { display: none !important; }
      section { display: flex; align-items: center; flex-wrap: wrap; gap: 5px;
        box-sizing: border-box; max-width: 500px; padding: 3px 6px; border-radius: 5px;
        background: #171b24; color: #eef2f8; }
      .status { max-width: 180px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      button { border: 0; border-radius: 4px; padding: 4px 7px; color: white;
        background: #335474; cursor: pointer; font: inherit; }
      .toggle { background: #27804b; }
      .details { flex-basis: 100%; min-width: 265px; }
      .meta, pre { color: #aebccd; font-size: 11px; }
      pre { white-space: pre-wrap; margin: 4px 0 0; }
      .copy, .retry { margin-top: 5px; }
    </style><section><strong>迷宫循环</strong><span class="status"></span>
      <button class="toggle"></button><button class="expand">详情</button>
      <div class="details" hidden><div class="meta"></div><button class="retry">重试</button>
      <button class="copy">复制详细日志</button><pre class="latest"></pre></div></section>`;
    panel = {
      host,
      details: root.querySelector(".details"),
      expand: root.querySelector(".expand"),
      detailsOpen: false,
      toggle: root.querySelector(".toggle"),
      status: root.querySelector(".status"),
      meta: root.querySelector(".meta"),
      retry: root.querySelector(".retry"),
      copy: root.querySelector(".copy"),
      latest: root.querySelector(".latest"),
    };
    panel.toggle.addEventListener("click", toggle);
    panel.expand.addEventListener("click", () => { panel.detailsOpen = !panel.detailsOpen; render(); });
    panel.retry.addEventListener("click", retry);
    panel.copy.addEventListener("click", () => {
      GM_setClipboard(JSON.stringify({ version: "0.5.3", characterId, state, status, logs }, null, 2));
      status = "详细日志已复制";
      render();
    });
    mountPanel();
    render();
  }

  createPanel();
  note("loaded", { version: "0.5.3" });
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(tick, 2000);
  window.addEventListener("beforeunload", unlock);
  schedule();
})();
