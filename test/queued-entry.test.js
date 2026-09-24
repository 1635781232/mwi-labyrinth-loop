"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor(tagName = "div", text = "") {
    this.tagName = tagName.toUpperCase();
    this.innerText = text;
    this.textContent = text;
    this.disabled = false;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.clickCount = 0;
    this.isConnected = true;
    this.rect = { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  attachShadow() {
    const elements = new Map(
      [".toggle", ".retry", ".copy-log", ".status", ".meta", ".logs"].map((selector) => [
        selector,
        new FakeElement(),
      ])
    );
    this.shadowElements = elements;
    return {
      innerHTML: "",
      querySelector(selector) {
        return elements.get(selector) || null;
      },
    };
  }

  click() {
    this.clickCount += 1;
    this.listeners.get("click")?.();
  }

  getBoundingClientRect() {
    return this.rect;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  closest() {
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "button, a, [role='button']") return this.children;
    return [];
  }
}

function createHarness() {
  let now = 1_000_000;
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }

    static now() {
      return now;
    }
  }

  const enter = new FakeElement("button", "进入迷宫");
  const flee = new FakeElement("button", "逃跑");
  const unrelatedStop = new FakeElement("button", "停止");
  const immediateStart = new FakeElement("button", "立即开始");
  const labyrinthStop = new FakeElement("button", "停止");
  const end = new FakeElement("button", "结束迷宫");
  const cancelFirstExit = new FakeElement("button", "取消");
  const confirmFirstExit = new FakeElement("button", "确定");
  const firstExitDialog = new FakeElement("div", "确定要逃出迷宫吗？当前的迷宫将会结束。");
  firstExitDialog.children = [cancelFirstExit, confirmFirstExit];
  cancelFirstExit.parentElement = firstExitDialog;
  confirmFirstExit.parentElement = firstExitDialog;
  const cancelTorchExit = new FakeElement("button", "取消");
  const confirmTorchExit = new FakeElement("button", "确定");
  const torchDialog = new FakeElement("div", "你还有 388 个火把，确定要离开迷宫吗？");
  torchDialog.children = [cancelTorchExit, confirmTorchExit];
  cancelTorchExit.parentElement = torchDialog;
  confirmTorchExit.parentElement = torchDialog;
  const staleConfirmTorchExit = new FakeElement("button", "确定");
  const staleTorchDialog = new FakeElement("div", "你还有 388 个火把，确定要离开迷宫吗？");
  staleTorchDialog.children = [staleConfirmTorchExit];
  staleConfirmTorchExit.parentElement = staleTorchDialog;
  const labyrinthNav = new FakeElement("div", "迷宫");
  const labyrinthNavIcon = new FakeElement("svg");
  labyrinthNavIcon.parentElement = labyrinthNav;
  let pageButtons = [enter, flee, unrelatedStop];
  let exitDialogStage = 0;
  let escapePending = false;
  immediateStart.addEventListener("click", () => {
    pageButtons = [unrelatedStop, labyrinthStop, end];
  });

  const body = new FakeElement("body");
  body.innerText = "入场券: 5 / 5";
  end.addEventListener("click", () => {
    exitDialogStage = 1;
  });
  confirmFirstExit.addEventListener("click", () => {
    exitDialogStage = 2;
  });
  confirmTorchExit.addEventListener("click", () => {
    exitDialogStage = 0;
    torchDialog.isConnected = false;
    confirmTorchExit.isConnected = false;
    escapePending = true;
  });
  const timers = new Map();
  const intervals = [];
  let clipboardText = "";
  let nextTimerId = 1;
  const stateKey = "mwi-labyrinth-loop:state:27538";
  const storage = new Map([[stateKey, JSON.stringify({ version: 3, enabled: true, phase: "idle" })]]);

  const document = {
    body,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      if (selector === 'svg[aria-label="navigationBar.labyrinth"]') return labyrinthNavIcon;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "button, a, [role='button']") {
        if (exitDialogStage === 1) return [...pageButtons, cancelFirstExit, confirmFirstExit];
        if (exitDialogStage === 2) {
          // React may retain stale, fully-sized dialog nodes under the current modal.
          return [
            ...pageButtons,
            cancelFirstExit,
            confirmFirstExit,
            staleConfirmTorchExit,
            cancelTorchExit,
            confirmTorchExit,
          ];
        }
        return pageButtons;
      }
      return [];
    },
    elementFromPoint() {
      if (exitDialogStage === 1) return confirmFirstExit;
      if (exitDialogStage === 2) return confirmTorchExit;
      return null;
    },
  };

  const window = {
    setTimeout(callback) {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(callback) {
      intervals.push(callback);
      return intervals.length;
    },
    addEventListener() {},
  };

  const context = vm.createContext({
    console,
    document,
    window,
    location: {
      href: "https://test.milkywayidle.com/game?characterId=27538",
      origin: "https://test.milkywayidle.com",
    },
    navigator: {},
    HTMLElement: FakeElement,
    MutationObserver: class {
      observe() {}
    },
    URL,
    Date: FakeDate,
    Math,
    JSON,
    clearTimeout: window.clearTimeout,
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    getComputedStyle() {
      return { display: "block", visibility: "visible", opacity: "1" };
    },
    GM_getValue(key, fallback) {
      const value = storage.get(key);
      return value == null ? fallback : JSON.parse(value);
    },
    GM_setValue(key, value) {
      storage.set(key, JSON.stringify(value));
    },
    GM_addValueChangeListener() {},
    GM_setClipboard(value) {
      clipboardText = String(value);
    },
  });

  return {
    context,
    enter,
    flee,
    end,
    confirmFirstExit,
    confirmTorchExit,
    staleConfirmTorchExit,
    labyrinthNav,
    immediateStart,
    advance(milliseconds) {
      now += milliseconds;
    },
    flushTimer() {
      const next = timers.entries().next();
      if (next.done) return;
      const [id, callback] = next.value;
      timers.delete(id);
      callback();
    },
    tick() {
      intervals[0]();
    },
    createQueuedLabyrinth() {
      pageButtons = [unrelatedStop, immediateStart, end];
    },
    finishLabyrinthAutomation() {
      pageButtons = [unrelatedStop, immediateStart, end];
    },
    completeEscape() {
      assert.equal(escapePending, true, "the server escape request must be pending");
      pageButtons = [];
      body.innerText = "";
    },
    readState() {
      return JSON.parse(storage.get(stateKey));
    },
    copyDetailedLog() {
      const host = body.children.find((element) => element.id === "mwi-labyrinth-loop-host");
      host.shadowElements.get(".copy-log").click();
      return clipboardText;
    },
  };
}

const harness = createHarness();
const scriptPath = path.resolve(__dirname, "..", "mwi-labyrinth-loop.user.js");
vm.runInContext(fs.readFileSync(scriptPath, "utf8"), harness.context, { filename: scriptPath });

harness.flushTimer();
assert.equal(harness.enter.clickCount, 1, "the labyrinth entry must be submitted once");

harness.advance(25_000);
harness.tick();
assert.equal(harness.flee.clickCount, 0, "queued entry must never stop the current combat");
assert.equal(harness.readState().phase, "enterPending", "queued combat must not trigger the entry timeout");

harness.createQueuedLabyrinth();
harness.advance(1_000);
harness.tick();
assert.equal(harness.immediateStart.clickCount, 1, "the labyrinth must start when its queued turn begins");

harness.advance(1_000);
harness.tick();
harness.finishLabyrinthAutomation();
harness.advance(2_500);
harness.tick();
assert.equal(harness.flee.clickCount, 0, "unrelated actions must remain untouched");
assert.equal(harness.immediateStart.clickCount, 1, "the labyrinth start button must only be clicked once");
assert.equal(harness.end.clickCount, 1, "the labyrinth must be ended after its automation stops");
assert.equal(harness.readState().phase, "ending", "the labyrinth must end after its own automation stops");

harness.advance(1_000);
harness.tick();
assert.equal(harness.confirmFirstExit.clickCount, 1, "the first exit confirmation must be clicked");

harness.advance(1_000);
harness.tick();
assert.equal(harness.confirmFirstExit.clickCount, 1, "the stale first confirmation must not be clicked again");
assert.equal(harness.staleConfirmTorchExit.clickCount, 0, "an occluded stale torch confirmation must not be clicked");
assert.equal(harness.confirmTorchExit.clickCount, 1, "the newer torch confirmation must be clicked");

harness.advance(2_000);
harness.tick();
assert.equal(harness.end.clickCount, 1, "ending must not be resubmitted after the torch warning is acknowledged");
assert.equal(harness.readState().phase, "ending", "the script must wait for the server to acknowledge escape");

harness.advance(28_000);
harness.tick();
assert.equal(harness.readState().phase, "ending", "a slow server response must not time out after 20 seconds");
assert.equal(harness.end.clickCount, 1, "a slow response must not resubmit ending");

harness.completeEscape();

harness.advance(2_000);
harness.tick();
assert.equal(harness.labyrinthNav.clickCount, 1, "the sidebar icon container must reopen the labyrinth page");

harness.advance(4_000);
harness.tick();
assert.equal(harness.labyrinthNav.clickCount, 2, "navigation must retry while the labyrinth page is still unavailable");
const copiedLog = harness.copyDetailedLog();
assert.match(copiedLog, /Milky Way Idle 迷宫循环详细日志/);
assert.match(copiedLog, /"version": "0\.3\.4"/);
assert.match(copiedLog, /"hitTest":/);
assert.match(copiedLog, /"dialogStillOpen": false/);
assert.match(copiedLog, /"events": \[/);
console.log("queued entry ignores unrelated stop controls: ok");
