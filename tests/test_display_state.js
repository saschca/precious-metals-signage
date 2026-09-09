// Regression tests for the display page's playback state machine.
//
// Guards the v1.4.1 bug: pollStatus() committed the new server state *after*
// running its transition handlers, so playCurrentVideo() / startVideoPlayback()
// saw the stale "stopped" or "paused" value and refused to start. Pressing Play
// in the admin panel left the display sitting on the splash screen.
//
// display.js is a browser IIFE, so it runs here against a hand-rolled DOM stub
// with deterministic timers and a scripted fetch. No jsdom dependency.

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(
    path.join(__dirname, "..", "static", "js", "display.js"), "utf8");

const ELEMENT_IDS = [
    "player", "image-player", "splash", "chart-overlay", "chart-title",
    "chart-canvas", "ticker", "ticker-content", "ticker-updated",
];

function makeElement(id) {
    return {
        id,
        style: {},
        attributes: {},
        currentTime: 0,
        ended: false,
        muted: false,
        playCalls: 0,
        loadCalls: 0,
        pauseCalls: 0,
        textContent: "",
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        play() { this.playCalls++; return Promise.resolve(); },
        load() { this.loadCalls++; },
        pause() { this.pauseCalls++; },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return k === "src" ? (this.src || null) : (this.attributes[k] || null); },
        removeAttribute(k) { if (k === "src") delete this.src; delete this.attributes[k]; },
        addEventListener() {},
        querySelector() { return { textContent: "" }; },
        appendChild() {},
    };
}

// Builds a sandbox whose /api/status response can be swapped between polls.
function createHarness(options) {
    const elements = {};
    ELEMENT_IDS.forEach(id => { elements[id] = makeElement(id); });

    const state = {
        status: options.initialStatus,
        playlist: options.playlist,
        settings: options.settings || {},
        timers: [],
    };

    // Deferred promise queue so tests control resolution order explicitly.
    const pending = [];
    function respond(body) {
        return new Promise(resolve => {
            pending.push(() => resolve({ json: () => Promise.resolve(body) }));
        });
    }

    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: () => 0,
        clearTimeout: () => {},
        setInterval: (fn, ms) => { state.timers.push({ fn, ms }); return state.timers.length; },
        clearInterval: () => {},
        Date,
        Math,
        Number,
        JSON,
        document: {
            getElementById: id => elements[id] || null,
            addEventListener() {},
            removeEventListener() {},
        },
        fetch(url) {
            if (url.startsWith("/api/status")) return respond(state.status);
            if (url.startsWith("/api/playlist")) return respond(state.playlist);
            if (url.startsWith("/api/settings")) return respond(state.settings);
            if (url.startsWith("/api/prices")) return respond({ status: "ok", prices: [] });
            return respond({});
        },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(SOURCE, sandbox);

    // Flush every queued fetch plus the promise callbacks it unblocks.
    async function flush() {
        for (let i = 0; i < 40; i++) {
            const batch = pending.splice(0, pending.length);
            batch.forEach(fn => fn());
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            if (batch.length === 0 && pending.length === 0) break;
        }
    }

    function pollStatusAgain() {
        const timer = state.timers.find(t => t.ms === 3000);
        assert.ok(timer, "expected a 3s status poll interval to be registered");
        timer.fn();
    }

    return { elements, state, flush, pollStatusAgain };
}

const PLAYLIST = [
    { filename: "a.mp4", enabled: 1, exists: true, type: "video" },
    { filename: "b.mp4", enabled: 1, exists: true, type: "video" },
];

async function testPlayAfterStopIsHonoured() {
    const h = createHarness({
        initialStatus: { state: "stopped", skip_counter: 0 },
        playlist: PLAYLIST,
    });
    await h.flush();

    assert.strictEqual(h.elements.player.playCalls, 0,
        "must not play while the server reports stopped");

    // Operator presses Play in the admin panel.
    h.state.status = { state: "playing", skip_counter: 0 };
    h.pollStatusAgain();
    await h.flush();

    assert.ok(h.elements.player.playCalls > 0,
        "pressing Play must start the video on the already-open display");
    assert.strictEqual(h.elements.splash.style.display, "none",
        "splash must be hidden once playback starts");
}

async function testDisplayOpenedWhileAlreadyPlaying() {
    // The kiosk window opens after playback is already running: there is no
    // state *change* to react to, so the page must start from "unknown".
    const h = createHarness({
        initialStatus: { state: "playing", skip_counter: 0 },
        playlist: PLAYLIST,
    });
    await h.flush();

    assert.ok(h.elements.player.playCalls > 0,
        "a display opened during playback must start on its own");
}

async function testResumeFromPause() {
    const h = createHarness({
        initialStatus: { state: "playing", skip_counter: 0 },
        playlist: PLAYLIST,
    });
    await h.flush();

    h.state.status = { state: "paused", skip_counter: 0 };
    h.pollStatusAgain();
    await h.flush();
    const afterPause = h.elements.player.playCalls;

    h.state.status = { state: "playing", skip_counter: 0 };
    h.pollStatusAgain();
    await h.flush();

    assert.ok(h.elements.player.playCalls > afterPause,
        "resuming from paused must call play() again");
}

async function testStoppedStaysStopped() {
    const h = createHarness({
        initialStatus: { state: "playing", skip_counter: 0 },
        playlist: PLAYLIST,
    });
    await h.flush();

    h.state.status = { state: "stopped", skip_counter: 0 };
    h.pollStatusAgain();
    await h.flush();

    assert.ok(h.elements.player.pauseCalls > 0, "stop must pause the player");
    assert.strictEqual(h.elements.splash.style.display, "flex",
        "stop must show the splash screen");
}

async function main() {
    const tests = [
        ["play after stop is honoured", testPlayAfterStopIsHonoured],
        ["display opened while already playing", testDisplayOpenedWhileAlreadyPlaying],
        ["resume from pause", testResumeFromPause],
        ["stop returns to splash", testStoppedStaysStopped],
    ];

    let failed = 0;
    for (const [name, fn] of tests) {
        try {
            await fn();
            console.log("ok - " + name);
        } catch (err) {
            failed++;
            console.error("FAIL - " + name);
            console.error("  " + (err && err.message ? err.message : err));
        }
    }

    console.log("\n" + (tests.length - failed) + "/" + tests.length + " passed");
    if (failed > 0) process.exit(1);
}

main();
