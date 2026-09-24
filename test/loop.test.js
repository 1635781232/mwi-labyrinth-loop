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

function harness({ tickets = 2, active = false, floor = 1, target = 2, entryFailures = 0, captureSocket = true } = {}) {
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
  navSettings.addEventListener("click", () => { settingsOpen = true; pageButtons = [refill]; });
  navLabyrinth.addEventListener("click", () => { settingsOpen = false; pageButtons = [enter]; });
  refill.addEventListener("click", () => { tickets = 5; updateTickets(); });
  const sent = [];
  class FakeSocket {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.url = "wss://api-test.milkywayidle.com/ws"; }
    send(value) {
      const message = JSON.parse(value);
      sent.push(message);
      if (message.type === "start_labyrinth") enter.listeners.get("click")();
      if (message.type === "new_character_action") start.listeners.get("click")();
      if (message.type === "escape_labyrinth") pageButtons = [enter];
      if (message.type === "force_refill_labyrinth_entries") refill.listeners.get("click")();
    }
  }
  class FakeMessageEvent {
    constructor(socket) { this.currentTarget = socket; }
    get data() { return "{}"; }
  }
  const document = {
    body,
    createElement: (tag) => new Element(tag),
    querySelector: (selector) => selector.includes("navigationBar.labyrinth") ? iconLabyrinth :
      selector.includes("navigationBar.settings") ? iconSettings : null,
    querySelectorAll: (selector) => {
      if (selector.startsWith("button")) return pageButtons;
      if (selector.includes("role='dialog'")) return [];
      return [];
    },
  };
  const intervals = [];
  const timers = [];
  const window = {
    addEventListener() {},
  };
  const context = vm.createContext({
    console, document, window, HTMLElement: Element, MessageEvent: FakeMessageEvent,
    WebSocket: FakeSocket, MutationObserver: class { observe() {} },
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
  if (captureSocket) void new FakeMessageEvent(new FakeSocket()).data;
  const host = body.children.find((element) => element.id === "mwi-labyrinth-loop-host");
  assert.ok(host);
  host.shadowElements.get(".toggle").click();
  return {
    start, end, enter, refill, navSettings, sent,
    tick(milliseconds = 2000) { now += milliseconds; intervals[0](); },
    finish() { floor = target; torches = 390; end.disabled = false; pageButtons = [start, end]; },
    state() { return store.get("mwi-labyrinth-loop:state:27538"); },
  };
}

const flow = harness();
flow.tick();
assert.equal(flow.sent[0].type, "start_labyrinth", "send the game's real entry request");
assert.equal(flow.enter.clickCount, 0, "game buttons must not use ineffective DOM click");
flow.tick(1000);
assert.equal(flow.sent.length, 1, "wait two seconds before the next game request");
flow.tick(1000);
assert.equal(flow.sent[1].type, "new_character_action", "submit the labyrinth action");
assert.equal(flow.sent[1].newCharacterActionData.actionHrid, "/actions/labyrinth/explore");
assert.equal(flow.sent[1].newCharacterActionData.isStartNow, true);
assert.equal(flow.start.clickCount, 0);
flow.tick();
assert.equal(flow.sent.length, 2, "do not end while automation runs");
flow.finish();
flow.tick();
assert.equal(flow.sent[2].type, "escape_labyrinth", "end at automation target");
assert.equal(flow.end.clickCount, 0);
flow.tick();
assert.equal(flow.state().phase, "idle", "confirm server exit before the next run");

const resumed = harness({ active: true, floor: 2 });
resumed.tick();
assert.equal(resumed.sent[0].type, "escape_labyrinth", "end a maze already at target");

const empty = harness({ tickets: 0 });
empty.tick();
assert.equal(empty.navSettings.clickCount, 1, "go to settings when tickets are empty");
empty.tick();
assert.equal(empty.sent[0].type, "force_refill_labyrinth_entries", "send one refill request");
empty.tick();
empty.tick();
empty.tick();
empty.tick();
assert.equal(empty.sent[1].type, "start_labyrinth", "enter after verifying replenished tickets");

const missedClick = harness({ entryFailures: 1 });
missedClick.tick();
assert.equal(missedClick.sent.length, 1);
for (let index = 0; index < 15; index++) missedClick.tick();
assert.equal(missedClick.sent.filter((item) => item.type === "start_labyrinth").length, 2,
  "retry an unacknowledged entry request");
missedClick.tick();
assert.equal(missedClick.sent.at(-1).type, "new_character_action",
  "start once the retried entry creates a maze");

const disconnected = harness({ entryFailures: 3 });
disconnected.tick();
for (let index = 0; index < 31; index++) disconnected.tick();
assert.equal(disconnected.sent.filter((item) => item.type === "start_labyrinth").length, 2,
  "do not submit entry indefinitely");
assert.equal(disconnected.state().phase, "paused", "surface a repeated entry failure");

const noSocket = harness({ captureSocket: false });
noSocket.tick();
assert.equal(noSocket.sent.length, 0, "wait for the game connection");
assert.equal(noSocket.enter.clickCount, 0, "never fall back to ineffective button.click()");
console.log("WebSocket entry, automation, escape, refill and retry: ok");
