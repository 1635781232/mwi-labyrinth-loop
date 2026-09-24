// ==UserScript==
// @name         Milky Way Idle 测试服迷宫循环
// @namespace    https://github.com/1635781232/mwi-labyrinth-loop
// @version      0.3.3
// @description  使用游戏内置自动化循环进入、开始和结束迷宫，并在测试服自动补充入场券。
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
// @grant        GM_addValueChangeListener
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_ID = "mwi-labyrinth-loop";
  const SCRIPT_VERSION = "0.3.3";
  const STATE_VERSION = 4;
  const TICK_MS = 2000;
  const MUTATION_DEBOUNCE_MS = 150;
  const ACTION_TIMEOUT_MS = 20000;
  const START_SETTLE_MS = 2000;
  const END_SETTLE_MS = 1500;
  const CLICK_GUARD_MS = 900;
  const NAVIGATION_RETRY_MS = 3000;
  const FALLBACK_LOCK_TTL_MS = 15000;
  const FALLBACK_LOCK_HEARTBEAT_MS = 5000;
  const MAX_ESCAPE_CONFIRMATION_CLICKS = 4;
  const ESCAPE_CONFIRMATION_RETRY_MS = 2000;

  const TEXT = {
    enter: ["进入迷宫", "Enter Labyrinth"],
    flee: ["逃跑", "Flee"],
    immediateStart: ["立即开始", "Start Now"],
    plainStart: ["开始", "Start"],
    stop: ["停止", "Stop"],
    end: ["结束迷宫", "逃出迷宫", "逃离迷宫", "Escape Labyrinth", "Escape"],
    refill: ["补充入场券", "补充迷宫入场券", "Refill Entries", "Refill Labyrinth Entries"],
    confirm: ["确认", "确定", "确认结束", "仍然结束", "是", "Confirm", "Yes"],
  };

  const characterId = new URL(location.href).searchParams.get("characterId");
  const stateKey = `${SCRIPT_ID}:state:${characterId || "missing"}`;
  const fallbackLockKey = `${SCRIPT_ID}:lock:${characterId || "missing"}`;
  const webLockName = `${SCRIPT_ID}:${location.origin}:${characterId || "missing"}`;
  const debugLogKey = `${SCRIPT_ID}:debug:${characterId || "missing"}`;
  const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  const defaultState = {
    version: STATE_VERSION,
    enabled: false,
    ownedRun: false,
    startIssued: false,
    phase: "idle",
    phaseSince: 0,
    blockedReason: "",
    blockedMessage: "",
  };

  let state = loadState();
  let evaluating = false;
  let evaluationQueued = false;
  let debounceTimer = 0;
  let lastClickAt = 0;
  let lastOwnedRunNavigationAt = 0;
  let lastEscapeDialogSignature = "";
  let lastEscapeDialogClickAt = 0;
  let escapeConfirmationCount = 0;
  let pendingEscapeActivation = null;
  let statusText = "脚本已停用";
  let logItems = [];
  let debugLogItems = loadDebugLog();
  let ui = null;

  let webLockHeld = false;
  let webLockPending = false;
  let releaseWebLock = null;
  let uiHost = null;

  function loadState() {
    const saved = GM_getValue(stateKey, null);
    if (!saved || typeof saved !== "object") {
      return { ...defaultState };
    }
    if (saved.version !== STATE_VERSION) {
      return { ...defaultState, enabled: saved.enabled === true };
    }
    return { ...defaultState, ...saved };
  }

  function loadDebugLog() {
    const saved = GM_getValue(debugLogKey, []);
    return Array.isArray(saved) ? saved.slice(-200) : [];
  }

  function recordDebug(event, details = {}) {
    debugLogItems.push({
      time: new Date().toISOString(),
      event,
      phase: state?.phase || "initializing",
      ownedRun: state?.ownedRun === true,
      startIssued: state?.startIssued === true,
      ...details,
    });
    debugLogItems = debugLogItems.slice(-200);
    GM_setValue(debugLogKey, debugLogItems);
  }

  function saveState() {
    GM_setValue(stateKey, { ...state, version: STATE_VERSION });
    renderUi();
  }

  function setPhase(phase, extra = {}) {
    const previousPhase = state.phase;
    if (state.phase !== phase) {
      state.phase = phase;
      state.phaseSince = Date.now();
    }
    Object.assign(state, extra);
    if (previousPhase !== phase) recordDebug("phase", { from: previousPhase, to: phase });
    saveState();
  }

  function setStatus(text) {
    if (statusText === text) return;
    statusText = text;
    recordDebug("status", { message: text });
    renderUi();
  }

  function addLog(text) {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    logItems.unshift(`${time}  ${text}`);
    logItems = logItems.slice(0, 5);
    recordDebug("action", { message: text });
    renderUi();
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (
      typeof element.checkVisibility === "function" &&
      !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    ) {
      return false;
    }
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function rectSnapshot(element) {
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function hitTest(element) {
    if (!element?.isConnected || typeof document.elementFromPoint !== "function") {
      return { accepted: false, hit: null, rect: element ? rectSnapshot(element) : null };
    }
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const accepted = Boolean(hit && (hit === element || element.contains?.(hit)));
    return { accepted, hit, rect: rectSnapshot(element) };
  }

  function elementIdentity(element) {
    if (!element) return "none";
    const id = element.id ? `#${element.id}` : "";
    const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).slice(0, 2) : [];
    return `${String(element.tagName || "element").toLowerCase()}${id}${classes.length ? `.${classes.join(".")}` : ""}`;
  }

  function isDisabled(element) {
    return Boolean(
      element.disabled ||
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true"
    );
  }

  function clickableElements(root = document) {
    return Array.from(root.querySelectorAll("button, a, [role='button']"));
  }

  function findExactButton(texts, root = document, includeDisabled = true) {
    const wanted = new Set(texts.map(normalizeText));
    return (
      clickableElements(root).find((element) => {
        if (!isVisible(element)) return false;
        if (!includeDisabled && isDisabled(element)) return false;
        return wanted.has(normalizeText(element.innerText || element.textContent));
      }) || null
    );
  }

  function getActiveControls() {
    const endButton = findExactButton(TEXT.end);
    if (!endButton) {
      return { active: false, endButton: null, immediateStartButton: null, startButton: null, stopButton: null };
    }

    const immediateStartButton = findExactButton(TEXT.immediateStart);
    const startButton = immediateStartButton || findExactButton(TEXT.plainStart);
    return {
      active: true,
      endButton,
      immediateStartButton,
      startButton,
      // Other queued actions also expose a global Stop button. A visible
      // labyrinth Start button is authoritative: its automation is not running.
      stopButton: startButton ? null : findExactButton(TEXT.stop),
    };
  }

  function buildDebugReport() {
    const controls = getActiveControls();
    const dialogs = Array.from(new Set([...dialogCandidates(), ...escapeDialogCandidates()])).map((dialog) =>
      normalizeText(dialog.innerText || dialog.textContent).slice(0, 600)
    );
    const payload = {
      script: { id: SCRIPT_ID, version: SCRIPT_VERSION, stateVersion: STATE_VERSION },
      capturedAt: new Date().toISOString(),
      url: location.href,
      characterId,
      state: { ...state },
      status: statusText,
      entries: readEntries(),
      controls: {
        active: controls.active,
        hasEnd: Boolean(controls.endButton),
        hasImmediateStart: Boolean(controls.immediateStartButton),
        hasStart: Boolean(controls.startButton),
        hasStop: Boolean(controls.stopButton),
      },
      dialogs,
      recentPanelLogs: [...logItems],
      events: [...debugLogItems],
    };
    return `Milky Way Idle 迷宫循环详细日志\n${JSON.stringify(payload, null, 2)}`;
  }

  async function copyDetailedLog() {
    const report = buildDebugReport();
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(report, "text");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report);
      } else {
        throw new Error("当前环境不支持剪贴板写入");
      }
      addLog("已复制详细日志");
      ui.copyLog.textContent = "已复制";
    } catch (error) {
      recordDebug("copyLogError", { message: error?.message || String(error) });
      ui.copyLog.textContent = "复制失败";
    }
    window.setTimeout(() => {
      if (ui?.copyLog) ui.copyLog.textContent = "复制详细日志";
    }, 1600);
  }

  function readEntries() {
    const text = normalizeText(document.body?.innerText);
    const patterns = [
      /入场券\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/i,
      /(\d+)\s*\/\s*(\d+)\s*入场券/i,
      /(?:Labyrinth\s+)?Entries\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/i,
      /(\d+)\s*\/\s*(\d+)\s*(?:Labyrinth\s+)?Entries/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return { current: Number(match[1]), max: Number(match[2]) };
    }
    return null;
  }

  function safeClick(element, description) {
    if (!element || !isVisible(element) || isDisabled(element)) return false;
    if (Date.now() - lastClickAt < CLICK_GUARD_MS) return false;
    lastClickAt = Date.now();
    element.click();
    addLog(description);
    return true;
  }

  function getFallbackLock() {
    try {
      const parsed = JSON.parse(localStorage.getItem(fallbackLockKey) || "null");
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function acquireFallbackLock() {
    const now = Date.now();
    const lock = getFallbackLock();
    if (lock && lock.instanceId !== instanceId && now - Number(lock.timestamp || 0) < FALLBACK_LOCK_TTL_MS) {
      return false;
    }
    if (lock?.instanceId === instanceId) return true;
    localStorage.setItem(fallbackLockKey, JSON.stringify({ instanceId, timestamp: now }));
    return getFallbackLock()?.instanceId === instanceId;
  }

  function ensureControllerLock() {
    if (navigator.locks?.request) {
      if (webLockHeld) return true;
      if (!webLockPending) {
        webLockPending = true;
        navigator.locks
          .request(webLockName, { ifAvailable: true }, async (lock) => {
            webLockPending = false;
            if (!lock) {
              setStatus("另一个同角色标签页正在运行脚本");
              return;
            }
            webLockHeld = true;
            scheduleEvaluate();
            await new Promise((resolve) => {
              releaseWebLock = resolve;
            });
            webLockHeld = false;
            releaseWebLock = null;
          })
          .catch((error) => {
            webLockPending = false;
            console.error(`[${SCRIPT_ID}] Web Lock`, error);
            scheduleEvaluate();
          });
      }
      return false;
    }
    return acquireFallbackLock();
  }

  function refreshFallbackLock() {
    if (navigator.locks?.request || !state.enabled) return;
    const lock = getFallbackLock();
    if (lock?.instanceId === instanceId) {
      localStorage.setItem(fallbackLockKey, JSON.stringify({ instanceId, timestamp: Date.now() }));
    }
  }

  function releaseControllerLock() {
    if (releaseWebLock) releaseWebLock();
    if (getFallbackLock()?.instanceId === instanceId) localStorage.removeItem(fallbackLockKey);
  }

  function block(reason, message) {
    state.blockedReason = reason;
    state.blockedMessage = message;
    setPhase("blocked");
    setStatus(message);
    addLog(`已暂停：${message}`);
  }

  function hasTimedOut() {
    return state.phaseSince > 0 && Date.now() - state.phaseSince >= ACTION_TIMEOUT_MS;
  }

  function dialogCandidates() {
    const semantic = Array.from(
      document.querySelectorAll("[role='dialog'], [role='alertdialog'], [aria-modal='true']")
    ).filter(isVisible);
    const conventional = Array.from(document.querySelectorAll("[class*='modal' i], [class*='dialog' i]")).filter(isVisible);
    return Array.from(new Set([...semantic, ...conventional]));
  }

  function isKnownTorchEscapeDialog(text) {
    const normalized = normalizeText(text);
    return (
      /真的.{0,12}(确定|确认).{0,40}(火把|火炬).{0,40}(进度|继续)/i.test(normalized) ||
      /(确定|确认|结束|离开|逃离|逃出|继续).{0,50}(火把|火炬)|(火把|火炬).{0,50}(确定|确认|结束|离开|逃离|逃出|继续|探索)/i.test(
        normalized
      ) ||
      /really\s+sure.{0,80}torches?\s+remaining.{0,80}(?:more\s+progress|progress)/i.test(normalized)
    );
  }

  function isKnownEscapeDialog(text) {
    const normalized = normalizeText(text);
    const knownFirstStep =
      /(结束|逃离|逃出).{0,12}迷宫|迷宫.{0,20}(将会|会|即将).{0,8}结束/i.test(normalized) ||
      /escape\s+(?:the\s+)?labyrinth|end\s+(?:the\s+)?labyrinth|labyrinth.{0,30}(?:will\s+end|escape)/i.test(
        normalized
      );
    const knownTorchStep = isKnownTorchEscapeDialog(normalized);
    const entrySupplyWarning =
      /补给.{0,20}(不足|未满)|未带满|携带.{0,20}火把.{0,20}进入|entering\s+with.{0,50}torches?\s+instead|entering\s+without.{0,50}suppl/i.test(
        normalized
      );
    return !entrySupplyWarning && (knownFirstStep || knownTorchStep);
  }

  function escapeDialogCandidates() {
    const candidates = [...dialogCandidates()];
    const wanted = new Set(TEXT.confirm.map(normalizeText));
    const confirmButtons = clickableElements().filter(
      (element) =>
        isVisible(element) &&
        !isDisabled(element) &&
        wanted.has(normalizeText(element.innerText || element.textContent))
    );

    for (const button of confirmButtons) {
      let ancestor = button.parentElement;
      for (let depth = 0; ancestor && ancestor !== document.body && depth < 8; depth += 1) {
        if (isVisible(ancestor) && isKnownEscapeDialog(ancestor.innerText || ancestor.textContent)) {
          candidates.push(ancestor);
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }
    return Array.from(new Set(candidates));
  }

  function nearestKnownEscapeDialog(button) {
    let ancestor = button.parentElement;
    for (let depth = 0; ancestor && ancestor !== document.body && depth < 10; depth += 1) {
      if (isVisible(ancestor) && isKnownEscapeDialog(ancestor.innerText || ancestor.textContent)) return ancestor;
      ancestor = ancestor.parentElement;
    }
    return null;
  }

  function maximumZIndex(element) {
    let maximum = 0;
    for (let current = element; current && current !== document.body; current = current.parentElement) {
      const parsed = Number.parseInt(getComputedStyle(current).zIndex, 10);
      if (Number.isFinite(parsed)) maximum = Math.max(maximum, parsed);
    }
    return maximum;
  }

  function auditPendingEscapeActivation() {
    if (!pendingEscapeActivation || Date.now() - pendingEscapeActivation.clickedAt < 250) return;
    const { button, dialog, signature } = pendingEscapeActivation;
    const currentHit = button?.isConnected && isVisible(button) ? hitTest(button) : { accepted: false, hit: null };
    const dialogStillOpen = Boolean(
      dialog?.isConnected && isVisible(dialog) && normalizeText(dialog.innerText || dialog.textContent).slice(0, 400) === signature
    );
    recordDebug("escapeConfirmationOutcome", {
      dialogStillOpen,
      buttonConnected: Boolean(button?.isConnected),
      buttonStillHitTestable: currentHit.accepted,
      hitElement: elementIdentity(currentHit.hit),
    });
    pendingEscapeActivation = null;
  }

  function handleEscapeConfirmation() {
    auditPendingEscapeActivation();
    if (escapeConfirmationCount >= MAX_ESCAPE_CONFIRMATION_CLICKS) return false;

    const matches = [];
    const wanted = new Set(TEXT.confirm.map(normalizeText));
    const buttons = clickableElements();
    for (let domOrder = 0; domOrder < buttons.length; domOrder += 1) {
      const confirmButton = buttons[domOrder];
      if (
        !isVisible(confirmButton) ||
        isDisabled(confirmButton) ||
        !wanted.has(normalizeText(confirmButton.innerText || confirmButton.textContent))
      ) continue;
      const dialog = nearestKnownEscapeDialog(confirmButton);
      if (!dialog) continue;
      const dialogText = normalizeText(dialog.innerText || dialog.textContent);
      const hit = hitTest(confirmButton);
      matches.push({
        dialog,
        dialogText,
        confirmButton,
        signature: dialogText.slice(0, 400),
        hit,
        zIndex: maximumZIndex(confirmButton),
        domOrder,
      });
    }

    const actionable = matches
      .filter((candidate) => candidate.hit.accepted)
      .sort((left, right) => right.zIndex - left.zIndex || right.domOrder - left.domOrder);

    const match =
      actionable.find((candidate) => candidate.signature !== lastEscapeDialogSignature) ||
      actionable.find(
        (candidate) =>
          candidate.signature === lastEscapeDialogSignature &&
          Date.now() - lastEscapeDialogClickAt >= ESCAPE_CONFIRMATION_RETRY_MS
      );
    if (!match) return false;

    const buttonText = normalizeText(match.confirmButton.innerText || match.confirmButton.textContent);
    recordDebug("escapeConfirmationSelection", {
      candidateCount: matches.length,
      actionableCount: actionable.length,
      chosenButton: buttonText,
      chosenDialog: match.dialogText.slice(0, 400),
      rect: match.hit.rect,
      isConnected: Boolean(match.confirmButton.isConnected),
      hitTest: match.hit.accepted,
      hitElement: elementIdentity(match.hit.hit),
      zIndex: match.zIndex,
      domOrder: match.domOrder,
    });
    const description = `确认结束迷宫（${escapeConfirmationCount + 1}）：按钮“${buttonText}” · ${match.dialogText.slice(
      0,
      160
    )}`;
    if (!safeClick(match.confirmButton, description)) return false;
    lastEscapeDialogSignature = match.signature;
    lastEscapeDialogClickAt = Date.now();
    escapeConfirmationCount += 1;
    pendingEscapeActivation = {
      button: match.confirmButton,
      dialog: match.dialog,
      signature: match.signature,
      clickedAt: Date.now(),
    };
    return true;
  }

  function hasUnknownDialog() {
    return dialogCandidates().some((dialog) => normalizeText(dialog.innerText || dialog.textContent).length > 0);
  }

  function hasUnknownEscapeDialog() {
    return dialogCandidates().some((dialog) => {
      const dialogText = normalizeText(dialog.innerText || dialog.textContent);
      return dialogText.length > 0 && !isKnownEscapeDialog(dialogText);
    });
  }

  function findNavigation(section) {
    const icon = document.querySelector(`svg[aria-label="navigationBar.${section}"]`);
    if (!icon) return null;
    const semanticTarget = icon.closest("button, a, [role='button'], [class*='NavigationBar_navigationLink']");
    const target = semanticTarget || icon.parentElement;
    return target && isVisible(target) ? target : null;
  }

  function navigateTo(section, description) {
    return safeClick(findNavigation(section), description);
  }

  function beginEnding(controls) {
    if (!safeClick(controls.endButton, "游戏内置自动化已停止，结束迷宫")) return;
    lastEscapeDialogSignature = "";
    lastEscapeDialogClickAt = 0;
    escapeConfirmationCount = 0;
    pendingEscapeActivation = null;
    setPhase("ending");
    setStatus("正在结束迷宫");
  }

  function handleRefill() {
    if (state.phase === "verifyRefill") {
      if (hasUnknownDialog()) {
        block("refillDialog", "补充入场券出现确认或错误弹窗，请手动处理");
        return;
      }
      if (Date.now() - state.phaseSince < 1500) return;
      if (navigateTo("labyrinth", "返回迷宫验证入场券")) {
        setPhase("verifyRefillResult");
      } else if (hasTimedOut()) {
        block("labyrinthNavMissing", "补充后找不到迷宫入口");
      }
      return;
    }

    if (state.phase === "verifyRefillResult") {
      const entries = readEntries();
      if (entries?.current > 0) {
        addLog(`补充成功（入场券 ${entries.current}/${entries.max}）`);
        setPhase("idle");
        return;
      }
      if (entries && entries.current <= 0) {
        setPhase("openSettings");
        setStatus("入场券仍为 0，返回设置检查冷却");
        return;
      }
      if (hasTimedOut()) block("refillVerifyTimeout", "无法验证补充后的入场券数量");
      else setStatus("正在验证补充结果");
      return;
    }

    const refillButton = findExactButton(TEXT.refill);
    if (refillButton) {
      if (isDisabled(refillButton)) {
        setPhase("waitingRefill");
        setStatus("补充入场券处于 3 小时冷却，正在等待");
        return;
      }
      if (safeClick(refillButton, "请求补充迷宫入场券")) {
        setPhase("verifyRefill");
        setStatus("已请求补充，等待验证结果");
      }
      return;
    }

    if (state.phase !== "openSettings") {
      if (navigateTo("settings", "打开设置")) {
        setPhase("openSettings");
        setStatus("正在打开设置");
      } else {
        block("settingsMissing", "找不到设置入口");
      }
      return;
    }

    if (hasTimedOut()) block("refillMissing", "找不到补充迷宫入场券按钮");
  }

  function waitForInactiveControl(phase, message) {
    if (state.phase !== phase) {
      setPhase(phase);
      setStatus(message);
      return;
    }
    if (hasTimedOut()) block(phase, message);
    else setStatus(message);
  }

  function handleInactiveRun() {
    const entries = readEntries();

    if (state.ownedRun && !entries) {
      if (state.phase !== "returnToOwnedRun") {
        lastOwnedRunNavigationAt = 0;
        setPhase("returnToOwnedRun");
      }
      if (Date.now() - lastOwnedRunNavigationAt >= NAVIGATION_RETRY_MS) {
        if (navigateTo("labyrinth", "返回迷宫继续监控")) {
          lastOwnedRunNavigationAt = Date.now();
          setStatus("正在返回迷宫继续监控");
          return;
        }
      }
      if (hasTimedOut()) {
        block("ownedRunPageMissing", "返回迷宫超时，无法继续监控当前迷宫");
      } else {
        setStatus("等待迷宫页面恢复");
      }
      return;
    }

    if (state.ownedRun) {
      if (state.phase !== "verifyEnded") {
        setPhase("verifyEnded");
        setStatus("正在确认迷宫已结束");
        return;
      }
      if (Date.now() - state.phaseSince < END_SETTLE_MS) {
        setStatus("正在确认迷宫已结束");
        return;
      }
      state.ownedRun = false;
      state.startIssued = false;
      state.blockedReason = "";
      state.blockedMessage = "";
      setPhase("idle");
      addLog("已确认迷宫结束");
    }

    if (state.phase === "enterPending") {
      if (hasUnknownDialog()) {
        block("entryDialog", "进入迷宫出现补给或未知确认框，请手动处理");
      } else if (findExactButton(TEXT.enter, document, false) && findExactButton(TEXT.flee, document, false)) {
        setStatus("迷宫已加入游戏队列，等待当前战斗完成");
      } else if (hasTimedOut()) {
        block("enterTimeout", "进入迷宫超时");
      } else {
        setStatus("等待迷宫创建");
      }
      return;
    }

    if (["openSettings", "waitingRefill", "verifyRefill", "verifyRefillResult"].includes(state.phase)) {
      handleRefill();
      return;
    }

    if (!entries) {
      if (!["openLabyrinth", "waitEntries"].includes(state.phase)) {
        if (navigateTo("labyrinth", "打开迷宫页面")) {
          setPhase("openLabyrinth");
          setStatus("正在打开迷宫页面");
          return;
        }
      }
      waitForInactiveControl("waitEntries", "无法识别入场券数据");
      return;
    }

    if (entries.current <= 0) {
      setStatus(`入场券 ${entries.current}/${entries.max}，准备补充`);
      handleRefill();
      return;
    }

    const enterButton = findExactButton(TEXT.enter, document, false);
    if (!enterButton) {
      waitForInactiveControl("waitEnter", `入场券 ${entries.current}/${entries.max}，找不到进入迷宫按钮`);
      return;
    }

    if (safeClick(enterButton, `进入迷宫（入场券 ${entries.current}/${entries.max}）`)) {
      state.startIssued = false;
      setPhase("enterPending");
      setStatus("已点击进入迷宫，等待创建");
    }
  }

  function handleActiveRun(controls) {
    if (!state.ownedRun) {
      if (state.phase === "enterPending") {
        state.ownedRun = true;
        state.startIssued = false;
        setPhase("awaitFirstStart");
        addLog("已接管本次迷宫");
      } else if (["idle", "openLabyrinth", "waitEntries", "waitEnter"].includes(state.phase)) {
        state.ownedRun = true;
        state.startIssued = false;
        setPhase("awaitFirstStart");
        addLog("已接管当前迷宫");
      } else {
        setStatus("检测到非脚本启动的迷宫，等待你手动结束");
        return;
      }
    }

    if (state.phase === "ending") {
      const confirmed = handleEscapeConfirmation();
      if (confirmed) {
        setStatus("正在确认并结束迷宫");
        return;
      }
      if (!confirmed && hasUnknownEscapeDialog()) {
        block("unknownDialog", "结束迷宫出现未知弹窗，请手动处理");
        return;
      }
      if (hasTimedOut()) block("endTimeout", "结束迷宫超时，请检查确认框");
      else setStatus("正在确认并结束迷宫");
      return;
    }

    if (controls.stopButton) {
      if (state.phase !== "running" || !state.startIssued) {
        setPhase("running", { startIssued: true });
      }
      setStatus("游戏内置迷宫自动化正在运行");
      return;
    }

    if (!state.startIssued) {
      if (state.phase !== "awaitFirstStart") setPhase("awaitFirstStart");
      const firstStartButton = controls.immediateStartButton || controls.startButton;
      if (!firstStartButton || isDisabled(firstStartButton)) {
        if (hasTimedOut()) block("startUnavailable", "新迷宫无法立即开始，请检查游戏内自动化路线");
        else setStatus("等待立即开始按钮可用");
        return;
      }
      if (safeClick(firstStartButton, "首次启动迷宫自动化")) {
        state.startIssued = true;
        setPhase("awaitRunning");
        setStatus("已启动一次，等待运行或结束状态");
      }
      return;
    }

    if (controls.startButton && !controls.stopButton) {
      if (state.phase === "awaitRunning" && Date.now() - state.phaseSince < START_SETTLE_MS) {
        setStatus("已启动一次，等待界面状态稳定");
        return;
      }
      beginEnding(controls);
      return;
    }

    if (state.phase === "awaitRunning") {
      if (hasTimedOut()) block("startTimeout", "启动后未识别到运行或结束状态");
      else setStatus("等待迷宫自动化状态变化");
      return;
    }

    setStatus("正在识别迷宫运行状态");
  }

  function evaluate() {
    if (evaluating) {
      evaluationQueued = true;
      return;
    }
    evaluating = true;

    try {
      if (!state.enabled) {
        setStatus("脚本已停用");
        releaseControllerLock();
        return;
      }
      if (!characterId) {
        setStatus("当前网址缺少 characterId，脚本不会执行");
        return;
      }
      auditPendingEscapeActivation();
      if (state.phase === "blocked") {
        // A confirmation dialog can appear just after the timeout boundary.
        // Resume only an owned end-confirmation flow so it can handle it.
        if (state.ownedRun && state.blockedReason === "endTimeout" && getActiveControls().active) {
          retryFromBlocked();
          return;
        }
        setStatus(state.blockedMessage || "脚本已暂停");
        return;
      }
      if (!ensureControllerLock()) {
        if (!webLockPending) setStatus("另一个同角色标签页正在运行脚本");
        return;
      }

      const controls = getActiveControls();
      if (!["ending", "enterPending", "verifyRefill"].includes(state.phase) && hasUnknownDialog()) {
        block("unknownDialog", "页面出现未知弹窗，请手动处理");
        return;
      }
      if (controls.active) handleActiveRun(controls);
      else handleInactiveRun();
    } catch (error) {
      console.error(`[${SCRIPT_ID}]`, error);
      block("runtimeError", `运行异常：${error?.message || String(error)}`);
    } finally {
      evaluating = false;
      if (evaluationQueued) {
        evaluationQueued = false;
        scheduleEvaluate();
      }
    }
  }

  function scheduleEvaluate() {
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(evaluate, MUTATION_DEBOUNCE_MS);
  }

  function retryFromBlocked() {
    if (state.phase !== "blocked") return;
    const controls = getActiveControls();
    const reason = state.blockedReason;
    state.blockedReason = "";
    state.blockedMessage = "";

    if (controls.active && state.ownedRun) {
      if (reason === "endTimeout") {
        lastEscapeDialogSignature = "";
        lastEscapeDialogClickAt = 0;
        escapeConfirmationCount = 0;
        lastTorchConfirmationAt = 0;
        postTorchEndRetryIssued = false;
        const knownDialogStillOpen = escapeDialogCandidates().some((dialog) =>
          isKnownEscapeDialog(dialog.innerText || dialog.textContent)
        );
        if (!knownDialogStillOpen) safeClick(controls.endButton, "重新请求结束迷宫");
        setPhase("ending");
      } else if (state.startIssued) {
        setPhase("awaitRunning");
      } else {
        setPhase("awaitFirstStart");
      }
    } else if (controls.active && ["enterTimeout", "entryDialog"].includes(reason)) {
      state.ownedRun = true;
      setPhase("awaitFirstStart");
    } else if (state.ownedRun && reason === "ownedRunPageMissing") {
      lastOwnedRunNavigationAt = 0;
      setPhase("returnToOwnedRun");
    } else {
      state.ownedRun = false;
      state.startIssued = false;
      setPhase("idle");
    }
    addLog("已手动重试");
    scheduleEvaluate();
  }

  function toggleEnabled() {
    state.enabled = !state.enabled;
    state.blockedReason = "";
    state.blockedMessage = "";
    state.phaseSince = Date.now();
    if (!state.enabled) {
      state.ownedRun = false;
      state.startIssued = false;
      state.phase = "idle";
      releaseControllerLock();
      addLog("脚本已停用，当前迷宫不再托管");
    } else {
      state.phase = "idle";
      addLog("脚本已启用");
    }
    saveState();
    scheduleEvaluate();
  }

  function createUi() {
    const host = document.createElement("div");
    host.id = `${SCRIPT_ID}-host`;
    uiHost = host;
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel { position: fixed; top: 12px; right: 12px; z-index: 2147483647; width: 286px;
          box-sizing: border-box; border: 1px solid rgba(255,255,255,.18); border-radius: 10px;
          background: rgba(23,27,36,.96); box-shadow: 0 8px 28px rgba(0,0,0,.42); color: #eef2f8;
          font: 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding: 12px; }
        .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .title { font-size: 14px; font-weight: 700; }
        button { border: 0; border-radius: 6px; color: #fff; cursor: pointer; font: inherit; padding: 6px 10px; }
        .toggle.on { background: #c0392b; } .toggle.off { background: #27804b; }
        .retry, .copy-log { margin-top: 8px; width: 100%; }
        .retry { background: #b7791f; }
        .copy-log { background: #334e68; }
        .status { margin-top: 10px; color: #d8e1ec; overflow-wrap: anywhere; }
        .meta { margin-top: 4px; color: #8fa1b5; font-size: 11px; }
        .logs { margin-top: 9px; border-top: 1px solid rgba(255,255,255,.12); padding-top: 7px; }
        .log { color: #aebccd; font-size: 11px; overflow-wrap: anywhere; }
        .empty { color: #738399; font-size: 11px; }
      </style>
      <section class="panel">
        <div class="header"><div class="title">迷宫循环 · 测试服</div><button class="toggle" type="button"></button></div>
        <div class="status"></div><div class="meta"></div>
        <button class="retry" type="button">重试</button>
        <button class="copy-log" type="button">复制详细日志</button><div class="logs"></div>
      </section>`;

    ui = {
      toggle: shadow.querySelector(".toggle"),
      retry: shadow.querySelector(".retry"),
      copyLog: shadow.querySelector(".copy-log"),
      status: shadow.querySelector(".status"),
      meta: shadow.querySelector(".meta"),
      logs: shadow.querySelector(".logs"),
    };
    ui.toggle.addEventListener("click", toggleEnabled);
    ui.retry.addEventListener("click", retryFromBlocked);
    ui.copyLog.addEventListener("click", copyDetailedLog);
    renderUi();
  }

  function renderUi() {
    if (!ui) return;
    // Expose status for diagnostics without using it as a control input.
    if (uiHost) {
      uiHost.dataset.enabled = String(state.enabled);
      uiHost.dataset.phase = state.phase;
      uiHost.dataset.ownedRun = String(state.ownedRun);
      uiHost.dataset.startIssued = String(state.startIssued);
      uiHost.dataset.status = statusText;
      uiHost.dataset.blockedReason = state.blockedReason || "";
    }
    ui.toggle.textContent = state.enabled ? "停用" : "启用";
    ui.toggle.className = `toggle ${state.enabled ? "on" : "off"}`;
    ui.status.textContent = statusText;
    ui.meta.textContent = `角色 ${characterId || "未识别"} · ${state.phase}${state.ownedRun ? " · 已托管" : ""}`;
    ui.retry.style.display = state.phase === "blocked" ? "block" : "none";
    ui.logs.replaceChildren();
    if (logItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "暂无操作记录";
      ui.logs.appendChild(empty);
      return;
    }
    for (const item of logItems) {
      const row = document.createElement("div");
      row.className = "log";
      row.textContent = item;
      ui.logs.appendChild(row);
    }
  }

  GM_addValueChangeListener(stateKey, (_name, _oldValue, newValue, remote) => {
    if (!remote || !newValue || typeof newValue !== "object") return;
    state = { ...defaultState, ...newValue };
    renderUi();
    scheduleEvaluate();
  });

  createUi();
  recordDebug("scriptLoaded", { version: SCRIPT_VERSION, enabled: state.enabled });
  const observer = new MutationObserver(scheduleEvaluate);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-disabled"],
  });

  window.setInterval(evaluate, TICK_MS);
  window.setInterval(refreshFallbackLock, FALLBACK_LOCK_HEARTBEAT_MS);
  window.addEventListener("beforeunload", releaseControllerLock);
  window.addEventListener("storage", (event) => {
    if (event.key === fallbackLockKey) scheduleEvaluate();
  });
  scheduleEvaluate();
})();
