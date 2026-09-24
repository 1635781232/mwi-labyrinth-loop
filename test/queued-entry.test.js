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
      [".toggle", ".retry", ".status", ".meta", ".logs"].map((selector) => [selector, new FakeElement()])
    );
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
    return { width: 100, height: 30 };
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

  querySelectorAll() {
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
  const immediateStart = new FakeElement("button", "立即开始");
  const end = new FakeElement("button", "结束迷宫");
  let pageButtons = [enter, flee];

  const body = new FakeElement("body");
  body.innerText = "入场券: 5 / 5";
  const timers = new Map();
  const intervals = [];
  let nextTimerId = 1;
  const stateKey = "mwi-labyrinth-loop:state:27538";
  const storage = new Map([[stateKey, JSON.stringify({ version: 3, enabled: true, phase: "idle" })]]);

  const document = {
    body,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "button, a, [role='button']") return pageButtons;
      return [];
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
  });

  return {
    context,
    enter,
    flee,
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
      pageButtons = [immediateStart, end];
    },
    readState() {
      return JSON.parse(storage.get(stateKey));
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
console.log("queued entry waits without stopping combat: ok");
