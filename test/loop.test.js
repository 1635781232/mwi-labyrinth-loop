"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  constructor(tag = "div", value = "") {
    this.tagName = tag.toUpperCase();
    this.innerText = value;
    this.textContent = value;
    this.isConnected = true;
    this.disabled = false;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.clickCount = 0;
    this.style = {};
    this.dataset = {};
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  click() { this.clickCount++; this.listeners.get("click")?.(); }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return { left: 10, top: 10, width: 100, height: 30 }; }
  contains(element) { return element === this; }
  closest() { return null; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  attachShadow() {
    const elements = new Map([".toggle", ".status", ".meta", ".retry", ".copy", ".latest"]
      .map((selector) => [selector, new Element()]));
    this.shadowElements = elements;
    return { innerHTML: "", querySelector: (selector) => elements.get(selector) };
  }
}

function harness({ tickets = 2, active = false, floor = 1, target = 2, secondConfirm = true, entryFailures = 0 } = {}) {
  let now = 100000;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const store = new Map();
  const enter = new Element("button", "进入迷宫");
  const start = new Element("button", "立即开始");
  const stop = new Element("button", "停止");
  const end = new Element("button", "结束迷宫");
  const refill = new Element("button", "补充入场券");
  const confirm1 = new Element("button", "确定");
  const confirm2 = new Element("button", "确定");
  const modal1 = new Element("div", "确定要逃出迷宫吗？当前的迷宫将会结束。");
  const modal2 = new Element("div", "你真的确定吗？你还有390个火把，可能还能继续探索。");
  confirm1.parentElement = modal1;
  confirm2.parentElement = modal2;
  const navLabyrinth = new Element("div", "迷宫");
  const navSettings = new Element("div", "设置");
  const iconLabyrinth = new Element("svg");
  const iconSettings = new Element("svg");
  iconLabyrinth.parentElement = navLabyrinth;
  iconSettings.parentElement = navSettings;
  const body = new Element("body");
  const panel = new Element("div");
  const label = new Element("div");
  const setting = new Element("span", "完全自动化到层数:");
  const settingRow = new Element("div");
  const combobox = new Element("div", String(target));
  setting.parentElement = settingRow;
  settingRow.querySelector = () => combobox;
  const torchIcon = new Element("svg");
  const torchBox = new Element("div");
  const torchCount = new Element("div");
  torchIcon.closest = () => torchBox;
  torchBox.querySelector = () => torchCount;
  let torches = 400;
  let pageButtons = active ? [start, end] : [enter];
  let modal = null;
  let settingsOpen = false;
  const updateTickets = () => { body.innerText = `入场券: ${tickets} / 5`; };
  updateTickets();
  end.closest = () => panel;
  panel.querySelectorAll = (selector) =>
    selector.includes("settingLabel") ? [setting] :
      selector.startsWith("button") ? pageButtons.filter((item) => [start, stop, end].includes(item)) : [];
  panel.querySelector = (selector) => {
    if (selector.includes("buttonsSection")) {
      label.innerText = `第 ${floor} 层 (宝藏: 0 / 2)`;
      return label;
    }
    if (selector.startsWith("svg")) {
      torchCount.textContent = String(torches);
      return torchIcon;
    }
    return null;
  };
  enter.addEventListener("click", () => {
    if (entryFailures > 0) { entryFailures--; return; }
    tickets--;
    updateTickets();
    floor = 1;
    torches = 400;
    settingsOpen = false;
    pageButtons = [start, end];
  });
  start.addEventListener("click", () => {
    end.disabled = true;
    pageButtons = [stop, end];
  });
  end.addEventListener("click", () => { modal = modal1; });
  confirm1.addEventListener("click", () => {
    if (secondConfirm) modal = modal2;
    else { modal = null; pageButtons = [enter]; }
  });
  confirm2.addEventListener("click", () => { modal = null; pageButtons = [enter]; });
  navSettings.addEventListener("click", () => { settingsOpen = true; pageButtons = [refill]; });
  navLabyrinth.addEventListener("click", () => { settingsOpen = false; pageButtons = [enter]; });
  refill.addEventListener("click", () => { tickets = 5; updateTickets(); });
  const document = {
    body,
    createElement: (tag) => new Element(tag),
    querySelector: (selector) => selector.includes("navigationBar.labyrinth") ? iconLabyrinth :
      selector.includes("navigationBar.settings") ? iconSettings : null,
    querySelectorAll: (selector) => {
      if (selector.startsWith("button")) return [...pageButtons, ...(modal ? [modal === modal1 ? confirm1 : confirm2] : [])];
      if (selector.includes("role='dialog'")) return modal ? [modal] : [];
      return [];
    },
    elementFromPoint: () => modal === modal1 ? confirm1 : modal === modal2 ? confirm2 : null,
  };
  const intervals = [];
  const timers = [];
  const window = {
    addEventListener() {},
  };
  const context = vm.createContext({
    console, document, window, HTMLElement: Element, MutationObserver: class { observe() {} },
    Date: Clock, Math, JSON, URL,
    location: { href: "https://test.milkywayidle.com/game?characterId=27538" },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    GM_getValue: (key, fallback) => store.get(key) ?? fallback,
    GM_setValue: (key, value) => store.set(key, value),
    GM_setClipboard() {},
    setInterval: (callback) => intervals.push(callback),
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout() {},
  });
  const file = path.resolve(__dirname, "..", "mwi-labyrinth-loop.user.js");
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  const host = body.children.find((element) => element.id === "mwi-labyrinth-loop-host");
  assert.ok(host);
  host.shadowElements.get(".toggle").click();
  return {
    start, end, enter, confirm1, confirm2, refill, navSettings,
    tick(milliseconds = 2000) { now += milliseconds; intervals[0](); },
    finish() { floor = target; torches = 390; end.disabled = false; pageButtons = [start, end]; },
    state() { return store.get("mwi-labyrinth-loop:state:27538"); },
  };
}

const flow = harness();
flow.tick();
assert.equal(flow.enter.clickCount, 1, "enter exactly once");
flow.tick(1000);
assert.equal(flow.start.clickCount, 0, "wait two seconds before the next game click");
flow.tick(1000);
assert.equal(flow.start.clickCount, 1, "start exactly once");
flow.tick();
assert.equal(flow.end.clickCount, 0, "do not end while automation runs");
flow.finish();
flow.tick();
assert.equal(flow.end.clickCount, 1, "end at automation target");
flow.tick();
flow.tick();
assert.equal(flow.confirm1.clickCount, 1);
assert.equal(flow.confirm2.clickCount, 1);
flow.tick();
assert.equal(flow.state().phase, "idle", "confirm server exit before the next run");

const resumed = harness({ active: true, floor: 2 });
resumed.tick();
assert.equal(resumed.start.clickCount, 0, "a maze already at target needs no new start");
assert.equal(resumed.end.clickCount, 1, "end a completed maze");

const noTorches = harness({ active: true, floor: 2, secondConfirm: false });
noTorches.tick();
noTorches.tick();
noTorches.tick();
assert.equal(noTorches.confirm1.clickCount, 1, "one confirmation is enough without torches");
assert.equal(noTorches.confirm2.clickCount, 0);
assert.equal(noTorches.state().phase, "idle");

const empty = harness({ tickets: 0 });
empty.tick();
assert.equal(empty.navSettings.clickCount, 1, "go to settings when tickets are empty");
empty.tick();
assert.equal(empty.refill.clickCount, 1, "refill once");
empty.tick();
empty.tick();
empty.tick();
empty.tick();
assert.equal(empty.enter.clickCount, 1, "enter after verifying replenished tickets");

const missedClick = harness({ entryFailures: 1 });
missedClick.tick();
assert.equal(missedClick.enter.clickCount, 1);
for (let index = 0; index < 15; index++) missedClick.tick();
assert.equal(missedClick.enter.clickCount, 2, "retry an entry click with no ticket or page change");
missedClick.tick();
assert.equal(missedClick.start.clickCount, 1, "start once the retried entry creates a maze");

const disconnected = harness({ entryFailures: 3 });
disconnected.tick();
for (let index = 0; index < 31; index++) disconnected.tick();
assert.equal(disconnected.enter.clickCount, 2, "do not submit entry indefinitely");
assert.equal(disconnected.state().phase, "paused", "surface a repeated entry failure");
console.log("maze start, target, exit confirmations, refill: ok");
