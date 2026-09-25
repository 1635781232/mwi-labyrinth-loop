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
  appendChild(child) {
    if (child.parentElement) child.parentElement.children = child.parentElement.children.filter((item) => item !== child);
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  click() { this.clickCount++; this.listeners.get("click")?.(); }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return this.rect || { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 }; }
  contains(element) { return element === this; }
  closest() { return null; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  attachShadow() {
    const elements = new Map([".details", ".expand", ".toggle", ".status", ".meta", ".retry", ".copy", ".latest"]
      .map((selector) => [selector, new Element()]));
    this.shadowElements = elements;
    return { innerHTML: "", querySelector: (selector) => elements.get(selector) };
  }
}

function harness({ tickets = 2, active = false, floor = 1, target = 2, entryFailures = 0,
  captureSocket = true, ticketsInitiallyVisible = true, refillDisabled = false,
  welcome = false, welcomeOffline = true, buttonsInitiallyVisible = true } = {}) {
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
  const queue = new Element("button", "添加队列 #3");
  const info = new Element("button", "信息");
  queue.rect = { left: 1088, top: 579, right: 1163, bottom: 600, width: 75, height: 21 };
  start.rect = stop.rect = { left: 1168, top: 579, right: 1243, bottom: 600, width: 75, height: 21 };
  end.rect = { left: 1088, top: 604, right: 1163, bottom: 625, width: 75, height: 21 };
  info.rect = { left: 1168, top: 604, right: 1243, bottom: 625, width: 75, height: 21 };
  const refill = new Element("button", "补充入场券");
  const welcomeTitle = new Element("div", "欢迎回来!");
  const welcomeDialog = new Element("div", welcomeOffline ?
    "欢迎回来! 离线时间 18s 获得物品 关闭" : "欢迎回来! 其他提示 关闭");
  const welcomeClose = new Element("button", "关闭");
  welcomeTitle.parentElement = welcomeDialog;
  welcomeDialog.querySelectorAll = () => welcome ? [welcomeClose] : [];
  welcomeClose.addEventListener("click", () => { welcome = false; });
  refill.disabled = refillDisabled;
  const navLabyrinth = new Element("div", "迷宫");
  const navSettings = new Element("div", "设置");
  const iconLabyrinth = new Element("svg");
  const iconSettings = new Element("svg");
  iconLabyrinth.parentElement = navLabyrinth;
  iconSettings.parentElement = navSettings;
  const body = new Element("body");
  const panel = body.appendChild(new Element("div"));
  panel.rect = { left: 160, top: 90, right: 1520, bottom: 630, width: 1360, height: 540 };
  const buttonsSection = panel.appendChild(new Element("div"));
  buttonsSection.rect = { left: 1080, top: 560, right: 1520, bottom: 630, width: 440, height: 70 };
  buttonsSection.closest = () => panel;
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
  let pageButtons = active ? [queue, start, end, info] : [enter];
  let settingsOpen = false;
  const updateTickets = () => { body.innerText = `入场券: ${tickets} / 5`; };
  updateTickets();
  if (!ticketsInitiallyVisible) body.innerText = "";
  end.closest = () => panel;
  panel.querySelectorAll = (selector) =>
    selector.includes("settingLabel") ? [setting] :
      selector.startsWith("button") ? pageButtons : [];
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
    pageButtons = [queue, start, end, info];
  });
  start.addEventListener("click", () => {
    end.disabled = true;
    pageButtons = [queue, stop, end, info];
  });
  navSettings.addEventListener("click", () => { settingsOpen = true; pageButtons = [refill]; });
  navLabyrinth.addEventListener("click", () => {
    settingsOpen = false;
    pageButtons = [enter];
    updateTickets();
  });
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
      selector.includes("navigationBar.settings") ? iconSettings :
        selector.includes("LabyrinthPanel_buttonsSection") && buttonsInitiallyVisible ? buttonsSection : null,
    querySelectorAll: (selector) => {
      if (selector.startsWith("h1")) return welcome ? [welcomeTitle] : [];
      if (selector.startsWith("button")) return pageButtons;
      if (selector.includes("role='dialog'")) return welcome ? [welcomeDialog] : [];
      return [];
    },
  };
  const intervals = [];
  const timers = [];
  const window = {
    innerWidth: 1000,
    innerHeight: 700,
    listeners: new Map(),
    addEventListener(name, callback) { this.listeners.set(name, callback); },
  };
  const context = vm.createContext({
    console, document, window, HTMLElement: Element, MessageEvent: FakeMessageEvent,
    WebSocket: FakeSocket, MutationObserver: class { observe() {} },
    Date: Clock, Math, JSON, URL,
    location: { href: "https://test.milkywayidle.com/game?characterId=27538" },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1", position: "static" }),
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
  const host = [...body.children, ...panel.children].find((element) => element.id === "mwi-labyrinth-loop-host");
  assert.ok(host);
  host.shadowElements.get(".toggle").click();
  return {
    start, end, enter, refill, navSettings, sent, welcomeClose, host, panel,
    tick(milliseconds = 2000) { now += milliseconds; intervals[0](); },
    showButtons() { buttonsInitiallyVisible = true; },
    finish() { floor = target; torches = 390; end.disabled = false; pageButtons = [queue, start, end, info]; },
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

const welcomeFlow = harness({ welcome: true });
welcomeFlow.tick();
assert.equal(welcomeFlow.welcomeClose.clickCount, 1, "close only the offline return popup first");
assert.equal(welcomeFlow.sent.length, 0, "wait before issuing another game action");
welcomeFlow.tick();
assert.equal(welcomeFlow.sent[0].type, "start_labyrinth", "continue the maze after closing the popup");
welcomeFlow.tick();

const otherPopup = harness({ welcome: true, welcomeOffline: false });
otherPopup.tick();
assert.equal(otherPopup.welcomeClose.clickCount, 0, "leave other dialogs untouched");
assert.equal(otherPopup.state().phase, "paused", "pause for an unrecognized dialog");

assert.equal(welcomeFlow.host.parentElement, welcomeFlow.panel,
  "mount beside the four lower labyrinth action buttons");
assert.equal(welcomeFlow.host.style.left, "1093px", "place the panel 10px right of the action buttons");
assert.equal(welcomeFlow.host.style.top, "486px", "align the panel with the action buttons");
welcomeFlow.host.shadowElements.get(".expand").click();
assert.equal(welcomeFlow.host.shadowElements.get(".details").hidden, false,
  "keep detailed status and log actions accessible in the inline panel");

const delayedButtons = harness({ buttonsInitiallyVisible: false });
assert.equal(delayedButtons.host.hidden, true, "hide the panel until the lower controls exist");
delayedButtons.showButtons();
delayedButtons.tick();
assert.equal(delayedButtons.host.parentElement, delayedButtons.panel,
  "mount after the game renders the lower action buttons");
assert.equal(delayedButtons.host.hidden, false);

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

const delayedEmpty = harness({ tickets: 0, ticketsInitiallyVisible: false, refillDisabled: true });
delayedEmpty.tick(22000);
assert.equal(delayedEmpty.navSettings.clickCount, 0, "open labyrinth to read the entry count first");
delayedEmpty.tick(500);
assert.notEqual(delayedEmpty.state().phase, "paused", "old idle time must not expire the refill stage");
delayedEmpty.tick(1500);
assert.equal(delayedEmpty.navSettings.clickCount, 1, "navigate to settings after the two-second interval");
delayedEmpty.tick();
assert.equal(delayedEmpty.state().phase, "refill", "wait while the refill button is cooling down");
assert.equal(delayedEmpty.sent.length, 0, "do not request refill while the button is disabled");

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
