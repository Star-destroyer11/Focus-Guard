
// ==UserScript==
// @name         Focus Guard
// @namespace    focus-guard
// @version      1.0.0
// @description  A tool to bypass site focus checks like Pear Assessments and others
// @match        *://*/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
    "use strict";

    const pageWindow = typeof unsafeWindow === "undefined" ? window : unsafeWindow;
    const isstable = true;

    if (!isstable) return;

    function fullscreen() {
        if (!isstable) return false;

        let simulatedFullscreen = false;
        let bypassEnabled = false;
        const pageDocument = pageWindow.document;
        const elementPrototype = pageWindow.Element.prototype;
        const nativeRequestFullscreen = elementPrototype.requestFullscreen;
        const nativeExitFullscreen = pageDocument.exitFullscreen;
        let documentPrototype = pageDocument;
        let nativeFullscreenElementGetter;
        while (documentPrototype && !nativeFullscreenElementGetter) {
            nativeFullscreenElementGetter = Object.getOwnPropertyDescriptor(
                documentPrototype,
                "fullscreenElement"
            )?.get;
            documentPrototype = Object.getPrototypeOf(documentPrototype);
        }

        const fireChange = () => {
            pageDocument.dispatchEvent(new pageWindow.Event("fullscreenchange", {
                bubbles: false,
                cancelable: false
            }));
        };

        try {
            Object.defineProperty(pageDocument, "fullscreenElement", {
                configurable: true,
                get: () => bypassEnabled
                    ? simulatedFullscreen ? pageDocument.documentElement : null
                    : nativeFullscreenElementGetter?.call(pageDocument) ?? null
            });
            Object.defineProperty(pageDocument, "fullscreen", {
                configurable: true,
                get: () => bypassEnabled
                    ? simulatedFullscreen
                    : Boolean(nativeFullscreenElementGetter?.call(pageDocument))
            });
            Object.defineProperty(pageWindow.Element.prototype, "requestFullscreen", {
                configurable: true,
                writable: true,
                value: async function () {
                    if (bypassEnabled) {
                        simulatedFullscreen = true;
                        fireChange();
                        return;
                    }
                    if (typeof nativeRequestFullscreen !== "function") {
                        throw new pageWindow.DOMException(
                            "The browser Fullscreen API is unavailable.",
                            "NotSupportedError"
                        );
                    }
                    return nativeRequestFullscreen.apply(this, arguments);
                }
            });
            Object.defineProperty(pageDocument, "exitFullscreen", {
                configurable: true,
                writable: true,
                value: async function () {
                    if (!bypassEnabled && typeof nativeExitFullscreen === "function") {
                        return nativeExitFullscreen.call(pageDocument);
                    }
                    simulatedFullscreen = false;
                    fireChange();
                }
            });
            Object.defineProperty(pageWindow, "__focusGuardFullscreen", {
                configurable: true,
                value: {
                    enable() {
                        simulatedFullscreen = true;
                        fireChange();
                    },
                    disable() {
                        simulatedFullscreen = false;
                        fireChange();
                    },
                    toggle() {
                        if (!bypassEnabled) return;
                        simulatedFullscreen = !simulatedFullscreen;
                        fireChange();
                    },
                    setBypass(enabled) {
                        bypassEnabled = Boolean(enabled);
                        simulatedFullscreen = false;
                        fireChange();
                    },
                    get bypass() {
                        return bypassEnabled;
                    },
                    get state() {
                        return Boolean(pageDocument.fullscreenElement);
                    }
                }
            });
        } catch {
            return false;
        }

        return true;
    }

    const fullscreenControllerAvailable = fullscreen();

    const DEFAULTS = {
        monitor: true,
        fullscreenSimulator: false,
        override: false,
        fakeVisible: true,
        fakeFocus: true,
        suppressFocusEvents: false,
        maxEvents: 500
    };

    let settings = { ...DEFAULTS };
    let events = [];
    let sequence = 0;
    let panel;
    let list;
    let status;
    let applied = false;
    const originalProperties = [];
    try {
        const savedSettings = GM_getValue("settings", {});
        const savedEvents = GM_getValue("events", []);
        settings = {
            ...DEFAULTS,
            ...(savedSettings && typeof savedSettings === "object"
                ? savedSettings
                : {})
        };
        events = Array.isArray(savedEvents)
            ? savedEvents.filter(entry => entry && typeof entry === "object")
            : [];
    } catch {}

    settings.monitor = settings.monitor !== false;
    settings.fullscreenSimulator = settings.fullscreenSimulator === true;
    settings.override = settings.override === true;
    settings.fakeVisible = settings.fakeVisible !== false;
    settings.fakeFocus = settings.fakeFocus !== false;
    settings.suppressFocusEvents = settings.suppressFocusEvents === true;
    settings.maxEvents = Number.isInteger(settings.maxEvents)
        ? Math.min(Math.max(settings.maxEvents, 1), 5000)
        : DEFAULTS.maxEvents;
    sequence = events.reduce((highest, entry) =>
        Number.isSafeInteger(entry.id) ? Math.max(highest, entry.id) : highest,
    0);

    const startedAt = new Date().toISOString();

    function updateFullscreen() {
        pageWindow.__focusGuardFullscreen?.setBypass(settings.fullscreenSimulator);
    }

    updateFullscreen();

    function currentState() {
        const pageDocument = pageWindow.document;
        return {
            visibility: pageDocument.visibilityState,
            hidden: pageDocument.hidden,
            focused: pageDocument.hasFocus()
        };
    }

    function record(type, details = {}) {
        if (!settings.monitor) return;

        const state = currentState();
        events.push({
            id: ++sequence,
            time: new Date().toISOString(),
            type,
            ...state,
            ...details
        });

        if (events.length > settings.maxEvents) {
            events.splice(0, events.length - settings.maxEvents);
        }

        try {
            GM_setValue("events", events);
        } catch {}

        render();
        renderEvents();
    }

    function saveSettings() {
        try {
            GM_setValue("settings", settings);
        } catch {}

        updateFullscreen();
        applyOverrides();
        render();
    }

    function restorePageOverrides() {
        for (const original of originalProperties.splice(0).reverse()) {
            try {
                if (original.descriptor) {
                    Object.defineProperty(
                        original.target,
                        original.name,
                        original.descriptor
                    );
                } else {
                    delete original.target[original.name];
                }
            } catch {}
        }
    }

    function setPageOverride(target, name, descriptor) {
        if (!originalProperties.some(item =>
            item.target === target && item.name === name
        )) {
            originalProperties.push({
                target,
                name,
                descriptor: Object.getOwnPropertyDescriptor(target, name)
            });
        }

        try {
            Object.defineProperty(target, name, {
                configurable: true,
                ...descriptor
            });
            return true;
        } catch (error) {
            record("override-error", {
                property: name,
                message: String(error)
            });
            return false;
        }
    }

    function applyOverrides() {
        restorePageOverrides();
        applied = false;
        if (!settings.override) return;

        const pageDocument = pageWindow.document;
        let count = 0;
        if (settings.fakeVisible) {
            count += Number(setPageOverride(pageDocument, "hidden", {
                get: () => false
            }));
            count += Number(setPageOverride(pageDocument, "visibilityState", {
                get: () => "visible"
            }));
        }
        if (settings.fakeFocus) {
            count += Number(setPageOverride(pageDocument, "hasFocus", {
                writable: true,
                value: () => true
            }));
        }

        applied = count > 0;
    }

    // Monitor browser events without changing them by default.
    for (const type of [
        "visibilitychange",
        "focus",
        "blur",
        "pageshow",
        "pagehide"
    ]) {
        pageWindow.addEventListener(type, event => {
            record(type, {
                target: event.target === pageWindow
                    ? "window"
                    : event.target?.nodeName ?? "unknown"
            });
        }, true);
    }

    pageWindow.document.addEventListener("visibilitychange", () => {
        record("document-visibilitychange");
    }, true);

    for (const type of ["blur", "focus"]) {
        pageWindow.addEventListener(type, event => {
            if (settings.override && settings.suppressFocusEvents) {
                event.stopImmediatePropagation();
            }
        }, true);
    }

    applyOverrides();

    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    }

    function button(label, callback) {
        const node = element("button", label);
        node.type = "button";
        node.addEventListener("click", callback);
        return node;
    }

    function checkbox(label, key) {
        const wrapper = element("label", undefined, "fg-check");
        const input = element("input");
        input.type = "checkbox";
        input.checked = Boolean(settings[key]);

        input.addEventListener("change", () => {
            settings[key] = input.checked;
            saveSettings();
        });

        wrapper.append(input, element("span", label));
        return wrapper;
    }

    function section(title) {
        const wrapper = element("section", undefined, "fg-section");
        wrapper.append(element("h3", title));
        return wrapper;
    }

    function createPanel() {
        if (panel) return;

        const host = document.createElement("div");
        host.id = "focus-guard-host";

        const shadow = host.attachShadow({ mode: "open" });
        const style = element("style", `
            :host { all: initial; }
            * { box-sizing: border-box; }
            .fg {
                position: fixed;
                z-index: 2147483647;
                right: 18px;
                bottom: 18px;
                width: 340px;
                max-height: 78vh;
                overflow: auto;
                background: #15171d;
                color: #e8eaf0;
                border: 1px solid #343844;
                border-radius: 12px;
                box-shadow: 0 12px 40px #0008;
                font: 13px/1.45 system-ui, sans-serif;
            }
            .fg-header {
                padding: 14px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: #20232c;
                position: sticky;
                top: 0;
            }
            .fg-header strong { font-size: 15px; }
            .fg button {
                color: #f1f3f8;
                background: #292d38;
                border: 1px solid #414654;
                border-radius: 6px;
                padding: 7px 9px;
                cursor: pointer;
            }
            .fg button:hover { background: #383e4d; }
            .fg-content { padding: 12px; }
            .fg-section { margin-bottom: 14px; }
            .fg-section h3 {
                margin: 0 0 8px;
                font-size: 12px;
                color: #aeb7ca;
                text-transform: uppercase;
                letter-spacing: .06em;
            }
            .fg-check {
                display: flex;
                gap: 9px;
                align-items: center;
                margin: 9px 0;
                cursor: pointer;
            }
            .fg-check input { accent-color: #9b8cff; }
            .fg-stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }
            .fg-stat {
                background: #20232c;
                padding: 10px;
                border-radius: 7px;
            }
            .fg-value { font-size: 17px; font-weight: 650; }
            .fg-muted { color: #9ca4b5; font-size: 11px; }
            .fg-actions { display: flex; gap: 6px; flex-wrap: wrap; }
            .fg-events {
                max-height: 150px;
                overflow: auto;
                font: 11px/1.5 ui-monospace, monospace;
                overflow-wrap: anywhere;
            }
            .fg-event {
                padding: 5px 0;
                border-bottom: 1px solid #30343e;
            }
            .fg-status { color: #a8e6bb; }
            .fg-warning {
                color: #f0ca84;
                background: #332b1d;
                border-radius: 6px;
                padding: 8px;
                margin: 8px 0;
            }
            .fg-hidden { display: none; }
        `);

        panel = element("div", undefined, "fg fg-hidden");
        const header = element("div", undefined, "fg-header");
        header.append(element("strong", "FOCUS GUARD"));

        const headerActions = element("div");
        const minimize = button("Hide", () => panel.classList.add("fg-hidden"));
        minimize.title = "Hide Focus Guard (Alt+Shift+G to show it again)";
        minimize.setAttribute("aria-keyshortcuts", "Alt+Shift+G");

        headerActions.append(minimize);
        header.append(headerActions);

        const content = element("div", undefined, "fg-content");

        const stats = element("div", undefined, "fg-stats");
        stats.append(
            makeStat("Current visibility", "visibility"),
            makeStat("Current focus", "focus"),
            makeStat("Recorded events", "count"),
            makeStat("Override status", "override")
        );

        const monitorSection = section("Monitoring");
        monitorSection.append(checkbox("Record browser events", "monitor"));

        const fullscreenSection = section("Fullscreen");
        fullscreenSection.append(
            checkbox("Enable fullscreen simulator", "fullscreenSimulator")
        );
        const fullscreenActions = element("div", undefined, "fg-actions");
        fullscreenActions.append(
            button("Enter fullscreen", async () => {
                try {
                    await pageWindow.document.documentElement.requestFullscreen();
                } catch {
                    status.textContent = "Fullscreen was denied by the browser.";
                }
            }),
            button("Exit fullscreen", async () => {
                try {
                    await pageWindow.document.exitFullscreen();
                } catch {
                    status.textContent = "Could not exit fullscreen.";
                }
            })
        );
        fullscreenSection.append(fullscreenActions);

        const overrideSection = section("Page overrides");
        overrideSection.append(
            checkbox("Enable page-level overrides", "override"),
            checkbox("Report visible / not hidden", "fakeVisible"),
            checkbox("Report focused", "fakeFocus"),
            checkbox("Suppress focus and blur events", "suppressFocusEvents")
        );

        const warning = element("div",
            "Page overrides can affect site behavior. Browser and server signals remain unchanged.",
            "fg-warning");

        status = element("div", "Initializing…", "fg-status");

        const eventSection = section("Event history");
        list = element("div", undefined, "fg-events");
        eventSection.append(list);

        const actions = element("div", undefined, "fg-actions");
        actions.append(
            button("Export JSON", exportJSON),
            button("Clear log", () => {
                if (!confirm("Clear the Focus Guard event log?")) return;
                events = [];
                sequence = 0;
                try { GM_setValue("events", []); } catch {}
                render();
            }),
            button("Refresh", render)
        );
        content.append(
            stats,
            monitorSection,
            fullscreenSection,
            overrideSection,
            warning,
            status,
            eventSection,
            actions
        );

        shadow.append(style, panel);
        panel.append(header, content);
        pageWindow.addEventListener("keydown", event => {
            if (!event.altKey || !event.shiftKey || event.key.toLowerCase() !== "g") {
                return;
            }

            event.preventDefault();
            panel.classList.toggle("fg-hidden");
        }, true);

        function makeStat(label, key) {
            const box = element("div", undefined, "fg-stat");
            box.append(
                element("div", label, "fg-muted"),
                element("div", "—", "fg-value")
            );
            box.dataset.stat = key;
            return box;
        }

        (document.documentElement || document).appendChild(host);
        render();
    }

    function renderEvents() {
        if (!list) return;

        list.replaceChildren();

        if (!events.length) {
            list.append(element("div", "No events recorded.", "fg-muted"));
            return;
        }

        for (const entry of events.slice(-40).reverse()) {
            const row = element("div", undefined, "fg-event");
            const time = entry.time
                ? new Date(entry.time).toLocaleTimeString()
                : "unknown time";

            row.textContent = `${time} | ${entry.type}`;
            list.append(row);
        }
    }

    function render() {
        if (!panel) return;

        const state = currentState();
        const root = panel.getRootNode();
        const stats = root.querySelectorAll("[data-stat]");
        for (const box of stats) {
            const value = box.querySelector(".fg-value");
            switch (box.dataset.stat) {
                case "visibility":
                    value.textContent = state.visibility;
                    break;
                case "focus":
                    value.textContent = String(state.focused);
                    break;
                case "count":
                    value.textContent = String(events.length);
                    break;
                case "override":
                    value.textContent = settings.override
                        ? applied ? "Attempted" : "Limited"
                        : "Off";
                    break;
            }
        }

        status.textContent = settings.override
            ? "Page overrides are on. Some browser surfaces may still report actual state."
            : "Monitor mode — browser readings are unchanged.";

        renderEvents();
    }

    function exportJSON() {
        const data = {
            application: "Focus Guard",
            version: "1.0.0",
            startedAt,
            exportedAt: new Date().toISOString(),
            currentState: currentState(),
            settings,
            events
        };

        const blob = new Blob(
            [JSON.stringify(data, null, 2)],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);
        const link = element("a");
        link.href = url;
        link.download = `focus-guard-${Date.now()}.json`;
        link.click();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function boot() {
        createPanel();
        record("focus-guard-started", {
            url: pageWindow.location.href,
            userAgent: pageWindow.navigator.userAgent
        });
    }

    if (document.documentElement) {
        boot();
    } else {
        const observer = new MutationObserver(() => {
            if (!document.documentElement) return;
            observer.disconnect();
            boot();
        });

        observer.observe(document, {
            childList: true,
            subtree: true
        });
    }
})();
