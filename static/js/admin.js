// Admin panel logic
(function () {
    "use strict";

    // ======================================================================
    // Helpers
    // ======================================================================
    function post(url, body) {
        return fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
        });
    }

    function fmtPrice(n) {
        return "$" + Number(n).toLocaleString("en-CA", {
            minimumFractionDigits: 2, maximumFractionDigits: 2,
        });
    }

    function fmtUptime(secs) {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (h > 0) return h + "h " + m + "m";
        if (m > 0) return m + "m " + s + "s";
        return s + "s";
    }

    // ======================================================================
    // Toast notifications
    // ======================================================================
    const toastContainer = document.getElementById("toast-container");
    let toastCounter = 0;

    function showToast(message, type) {
        // type: "success", "danger", "warning", "info"
        const id = "toast-" + (++toastCounter);
        const iconMap = {
            success: "bi-check-circle-fill",
            danger:  "bi-x-circle-fill",
            warning: "bi-exclamation-triangle-fill",
            info:    "bi-info-circle-fill",
        };
        const icon = iconMap[type] || iconMap.info;

        const html = '<div id="' + id + '" class="toast align-items-center text-bg-' + type
            + ' border-0" role="alert">'
            + '<div class="d-flex">'
            + '<div class="toast-body"><i class="bi ' + icon + ' me-2"></i>' + message + '</div>'
            + '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>'
            + '</div></div>';

        toastContainer.insertAdjacentHTML("beforeend", html);
        const el = document.getElementById(id);
        const toast = new bootstrap.Toast(el, { delay: 3500 });
        toast.show();
        el.addEventListener("hidden.bs.toast", () => el.remove());
    }

    // ======================================================================
    // Card 1 — Now Playing / Playback Controls
    // ======================================================================
    const nowLabel = document.getElementById("now-playing-label");
    const nowState = document.getElementById("now-playing-state");

    function controlAction(url, label) {
        post(url)
            .then(r => {
                if (!r.ok) throw new Error(r.status);
                showToast(label, "success");
            })
            .catch(() => showToast(label + " failed", "danger"));
    }

    document.getElementById("btn-play").addEventListener("click",  () => controlAction("/api/control/play", "Play"));
    document.getElementById("btn-pause").addEventListener("click", () => controlAction("/api/control/pause", "Pause"));
    document.getElementById("btn-skip").addEventListener("click",  () => controlAction("/api/control/skip", "Skip"));
    document.getElementById("btn-stop").addEventListener("click",  () => controlAction("/api/control/stop", "Stop"));

    function pollStatus() {
        fetch("/api/status")
            .then(r => r.json())
            .then(s => {
                const video = s.current_video || "Stopped";
                nowLabel.textContent = video;

                nowState.textContent = s.state;
                nowState.className = "badge ms-2 bg-"
                    + (s.state === "playing" ? "success"
                       : s.state === "paused" ? "warning"
                       : "secondary");

                document.getElementById("sys-version").textContent = s.version || "\u2014";
                document.getElementById("sys-uptime").textContent = fmtUptime(s.uptime || 0);
                document.getElementById("nav-version").textContent = "v" + (s.version || "");
            })
            .catch(() => {});
    }

    // ======================================================================
    // Card 2 — Playlist
    // ======================================================================
    const playlistList = document.getElementById("playlist-list");
    const videoSelect = document.getElementById("video-select");
    let currentPlaylist = [];

    function loadPlaylist() {
        fetch("/api/playlist")
            .then(r => r.json())
            .then(items => {
                currentPlaylist = items;
                renderPlaylist(items);
                loadAvailableVideos();
            })
            .catch(() => showToast("Failed to load playlist", "danger"));
    }

    function renderPlaylist(items) {
        if (items.length === 0) {
            playlistList.innerHTML = '<li class="list-group-item playlist-empty">Playlist is empty</li>';
            return;
        }
        playlistList.innerHTML = items.map(item =>
            '<li class="list-group-item list-group-item-action playlist-item" data-id="' + item.id + '">'
            + '<i class="bi bi-grip-vertical drag-handle"></i>'
            + '<span class="filename">' + escHtml(item.filename) + '</span>'
            + '<button class="btn btn-sm btn-outline-danger btn-remove" data-id="' + item.id + '" title="Remove">'
            + '<i class="bi bi-trash"></i></button>'
            + '</li>'
        ).join("");
    }

    function escHtml(s) {
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    // Drag-and-drop reorder via SortableJS
    new Sortable(playlistList, {
        handle: ".drag-handle",
        ghostClass: "sortable-ghost",
        animation: 150,
        onEnd: function () {
            const ids = Array.from(playlistList.querySelectorAll(".playlist-item"))
                .map(el => parseInt(el.dataset.id, 10));
            post("/api/playlist/reorder", { order: ids })
                .then(r => {
                    if (!r.ok) throw new Error();
                    showToast("Playlist reordered", "success");
                    loadPlaylist();
                })
                .catch(() => {
                    showToast("Reorder failed", "danger");
                    loadPlaylist();
                });
        },
    });

    // Remove button (event delegation)
    playlistList.addEventListener("click", function (e) {
        const btn = e.target.closest(".btn-remove");
        if (!btn) return;
        const id = parseInt(btn.dataset.id, 10);
        post("/api/playlist/remove", { id: id })
            .then(r => {
                if (!r.ok) throw new Error();
                showToast("Video removed", "success");
                loadPlaylist();
            })
            .catch(() => {
                showToast("Remove failed", "danger");
                loadPlaylist();
            });
    });

    // Add video
    document.getElementById("btn-add-video").addEventListener("click", function () {
        const filename = videoSelect.value;
        if (!filename) {
            showToast("Select a video first", "warning");
            return;
        }
        post("/api/playlist/add", { filename: filename })
            .then(r => {
                if (r.status === 409) {
                    showToast("Already in playlist", "warning");
                    return;
                }
                if (!r.ok) throw new Error();
                showToast("Added: " + filename, "success");
                loadPlaylist();
            })
            .catch(() => showToast("Add failed", "danger"));
    });

    function loadAvailableVideos() {
        fetch("/api/videos")
            .then(r => r.json())
            .then(files => {
                const inPlaylist = new Set(currentPlaylist.map(p => p.filename));
                const available = files.filter(f => !inPlaylist.has(f.filename));

                videoSelect.innerHTML = '<option value="">Select a video to add...</option>';
                available.forEach(f => {
                    const opt = document.createElement("option");
                    opt.value = f.filename;
                    opt.textContent = f.filename;
                    videoSelect.appendChild(opt);
                });
            })
            .catch(() => {});
    }

    // ======================================================================
    // Card 3 — Current Prices + warning badge
    // ======================================================================
    const pricesBody = document.querySelector("#prices-table tbody");
    const pricesUpdated = document.getElementById("prices-updated");
    const priceWarnBadge = document.getElementById("price-warn-badge");

    function loadPrices() {
        fetch("/api/prices")
            .then(r => r.json())
            .then(data => {
                const prices = data.prices || [];

                // Warning badge for 3+ consecutive failures
                if (data.failures >= 3) {
                    priceWarnBadge.classList.remove("d-none");
                    priceWarnBadge.textContent = "API Error (" + data.failures + " failures)";
                } else {
                    priceWarnBadge.classList.add("d-none");
                }

                if (prices.length === 0) {
                    pricesBody.innerHTML = '<tr><td colspan="4" class="text-muted text-center">No prices loaded</td></tr>';
                    pricesUpdated.textContent = "";
                    return;
                }

                pricesBody.innerHTML = prices.map(p => {
                    const pos = p.change_dollar >= 0;
                    const cls = pos ? "price-pos" : "price-neg";
                    const sign = pos ? "+" : "";
                    return '<tr>'
                        + '<td><strong>' + p.name + '</strong></td>'
                        + '<td class="text-end">' + fmtPrice(p.price_cad) + '</td>'
                        + '<td class="text-end ' + cls + '">' + sign + fmtPrice(p.change_dollar) + '</td>'
                        + '<td class="text-end ' + cls + '">' + sign + p.change_percent.toFixed(2) + '%</td>'
                        + '</tr>';
                }).join("");

                const t = prices[0].fetched_at;
                pricesUpdated.textContent = "Last updated: " + t;
            })
            .catch(() => {});
    }

    document.getElementById("btn-refresh-prices").addEventListener("click", function () {
        const btn = this;
        btn.disabled = true;
        btn.innerHTML = '<i class="bi bi-arrow-clockwise spin"></i> Refreshing...';
        post("/api/prices/refresh")
            .then(r => {
                if (!r.ok) throw new Error();
                showToast("Prices refreshed", "success");
                loadPrices();
            })
            .catch(() => showToast("Price refresh failed", "danger"))
            .finally(() => {
                btn.disabled = false;
                btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh';
            });
    });

    // ======================================================================
    // Card 4 — Settings
    // ======================================================================
    const setTickerEnabled  = document.getElementById("set-ticker-enabled");
    const setChartsEnabled  = document.getElementById("set-charts-enabled");
    const setUpdateInterval = document.getElementById("set-update-interval");
    const setChartFrequency = document.getElementById("set-chart-frequency");
    const setChartDuration  = document.getElementById("set-chart-duration");
    const setOffsetX        = document.getElementById("set-offset-x");
    const setOffsetY        = document.getElementById("set-offset-y");
    const setAutoStart      = document.getElementById("set-auto-start");

    // Live slider labels
    setUpdateInterval.addEventListener("input", () => {
        document.getElementById("interval-val").textContent = setUpdateInterval.value;
    });
    setChartFrequency.addEventListener("input", () => {
        document.getElementById("freq-val").textContent = setChartFrequency.value;
    });
    setChartDuration.addEventListener("input", () => {
        document.getElementById("dur-val").textContent = setChartDuration.value;
    });

    function loadSettings() {
        fetch("/api/settings")
            .then(r => r.json())
            .then(s => {
                setTickerEnabled.checked = s.ticker_enabled !== "false";

                if (s.ticker_mode === "marquee") {
                    document.getElementById("mode-marquee").checked = true;
                } else {
                    document.getElementById("mode-static").checked = true;
                }

                setUpdateInterval.value = s.update_interval || "1";
                document.getElementById("interval-val").textContent = setUpdateInterval.value;

                setChartsEnabled.checked = s.charts_enabled !== "false";

                setChartFrequency.value = s.chart_frequency || "3";
                document.getElementById("freq-val").textContent = setChartFrequency.value;

                setChartDuration.value = s.chart_duration || "15";
                document.getElementById("dur-val").textContent = setChartDuration.value;

                setOffsetX.value = s.monitor_offset_x || "1920";
                setOffsetY.value = s.monitor_offset_y || "0";

                setAutoStart.checked = s.auto_start === "true";
            })
            .catch(() => showToast("Failed to load settings", "danger"));
    }

    document.getElementById("btn-save-settings").addEventListener("click", function () {
        const mode = document.querySelector('input[name="tickerMode"]:checked').value;
        const payload = {
            ticker_enabled:  setTickerEnabled.checked ? "true" : "false",
            ticker_mode:     mode,
            update_interval: setUpdateInterval.value,
            charts_enabled:  setChartsEnabled.checked ? "true" : "false",
            chart_frequency: setChartFrequency.value,
            chart_duration:  setChartDuration.value,
            monitor_offset_x: setOffsetX.value,
            monitor_offset_y: setOffsetY.value,
            auto_start:      setAutoStart.checked ? "true" : "false",
        };

        const btn = this;
        btn.disabled = true;
        post("/api/settings", payload)
            .then(r => {
                if (!r.ok) throw new Error();
                showToast("Settings saved", "success");
                btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Saved!';
                setTimeout(() => {
                    btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Save Settings';
                    btn.disabled = false;
                }, 1500);
            })
            .catch(() => {
                showToast("Failed to save settings", "danger");
                btn.disabled = false;
            });
    });

    // Launch display on Monitor 2 via Chrome kiosk
    document.getElementById("btn-launch-display").addEventListener("click", function () {
        const btn = this;
        btn.disabled = true;
        post("/api/launch-display")
            .then(r => {
                if (!r.ok) throw new Error();
                showToast("Display launched on Monitor 2", "success");
                btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Launched!';
                setTimeout(() => {
                    btn.innerHTML = '<i class="bi bi-box-arrow-up-right me-1"></i>Launch Display';
                    btn.disabled = false;
                }, 2000);
            })
            .catch(() => {
                showToast("Failed to launch display", "danger");
                btn.disabled = false;
            });
    });

    // ======================================================================
    // Card 5 — System / Logs
    // ======================================================================
    const logBox = document.getElementById("log-box");

    function loadLogs() {
        fetch("/api/logs")
            .then(r => r.json())
            .then(lines => {
                logBox.textContent = lines.slice(-10).join("\n") || "No log entries";
                logBox.scrollTop = logBox.scrollHeight;
            })
            .catch(() => {});
    }

    // ======================================================================
    // Init & polling
    // ======================================================================
    loadPlaylist();
    loadPrices();
    loadSettings();
    loadLogs();
    pollStatus();

    setInterval(pollStatus, 5000);
    setInterval(loadPrices, 60000);
    setInterval(loadLogs, 30000);
})();
