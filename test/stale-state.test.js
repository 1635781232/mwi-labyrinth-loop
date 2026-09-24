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
      [".toggle", ".retry", ".copy-log", ".status", ".meta", ".logs"].map((selector) => [
        selector,
        new FakeElement(),
      ])
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
  const immediateStart = new FakeElement("button", "立即开始");
  const end = new FakeElement("button", "结束迷宫");
  const pageButtons = [immediateStart, end];
  const body = new FakeElement("body");
  body.innerText = "入场券: 5 / 5";

  const timers = new Map();
  let nextTimerId = 1;
  const intervals = [];
  const storage = new Map();
  const stateKey = "mwi-labyrinth-loop:state:27538";
  storage.set(
    stateKey,
    JSON.stringify({
      version: 2,
      enabled: true,
      ownedRun: true,
      startIssued: true,
      phase: "blocked",
      phaseSince: Date.now(),
      blockedReason: "endTimeout",
      blockedMessage: "结束迷宫超时，请检查确认框",
    })
  );

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
    Date,
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
    immediateStart,
    end,
    flushTimers(limit = 10) {
      for (let index = 0; index < limit && timers.size > 0; index += 1) {
        const [id, callback] = timers.entries().next().value;
        timers.delete(id);
        callback();
      }
    },
  };
}

const harness = createHarness();
const scriptPath = path.resolve(__dirname, "..", "mwi-labyrinth-loop.user.js");
vm.runInContext(fs.readFileSync(scriptPath, "utf8"), harness.context, { filename: scriptPath });
harness.flushTimers();

assert.equal(harness.immediateStart.clickCount, 1, "stale state must not prevent the first automatic start");
assert.equal(harness.end.clickCount, 0, "a fresh waiting maze must not be treated as ready to end");
console.log("stale-state auto-start: ok");
