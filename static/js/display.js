// Display page — video loop + chart slides
(function () {
    "use strict";

    const player = document.getElementById("player");
    const imagePlayer = document.getElementById("image-player");
    const splash = document.getElementById("splash");
    const chartOverlay = document.getElementById("chart-overlay");
    const chartTitle = document.getElementById("chart-title");
    const chartCanvas = document.getElementById("chart-canvas");

    let playlist = [];
    let currentIndex = -1;
    let videoCounter = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;
    let imageTimer = null;
    let imageDuration = 10;

    // ---- Chart state ------------------------------------------------------
    const METAL_INFO = {
        "GC=F": { name: "Gold",      color: "#FFD700" },
        "SI=F": { name: "Silver",    color: "#C0C0C0" },
        "PL=F": { name: "Platinum",  color: "#E5E4E2" },
        "PA=F": { name: "Palladium", color: "#CED0DD" },
    };
    const PERIOD_LABELS = {
        "5d": "1 Week", "1mo": "1 Month", "1y": "1 Year", "10y": "10 Years",
    };
    const METAL_ORDER = ["GC=F", "SI=F", "PL=F", "PA=F"];

    let chartQueue = [];       // [{symbol, name, color, period, periodLabel}]
    let chartQueueIndex = 0;
    let chartInstance = null;
    let chartDismissTimer = null;

    // Client-side chart data cache: "symbol:period" -> {data, time}
    const chartCache = {};
    const CHART_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

    let chartFrequency = 3;
    let chartDuration = 15;
    let displayCurrency = "CAD";

    // ---- Settings sync ----------------------------------------------------
    function fetchChartSettings() {
        fetch("/api/settings")
            .then(r => r.json())
            .then(s => {
                chartFrequency = parseInt(s.chart_frequency, 10) || 3;
                chartDuration = parseInt(s.chart_duration, 10) || 15;
                imageDuration = parseInt(s.image_duration, 10) || 10;
                displayCurrency = s.currency || "CAD";

                // Build chart queue from per-metal settings
                var metals = {};
                if (s.chart_metals) {
                    try { metals = JSON.parse(s.chart_metals); } catch (e) {}
                } else if (s.charts_enabled !== "false") {
                    // Backward compat: old settings without chart_metals
                    metals = {"GC=F":["5d"],"SI=F":["5d"],"PL=F":["5d"],"PA=F":["5d"]};
                }

                var newQueue = [];
                METAL_ORDER.forEach(function (sym) {
                    var periods = metals[sym];
                    if (!periods) return;
                    var info = METAL_INFO[sym];
                    periods.forEach(function (p) {
                        var label = PERIOD_LABELS[p];
                        if (!label) return;
                        newQueue.push({
                            symbol: sym, name: info.name, color: info.color,
                            period: p, periodLabel: label,
                        });
                    });
                });

                chartQueue = newQueue;
                console.log("[Charts] Queue:", chartQueue.length, "slide(s)");
            })
            .catch(() => {});
    }

    // ---- Splash helpers -----------------------------------------------------
    function showSplash(text, sub) {
        splash.querySelector(".splash-text").textContent = text;
        splash.querySelector(".splash-sub").textContent = sub;
        splash.style.display = "flex";
    }

    // ---- Playlist fetching ------------------------------------------------
    function fetchPlaylist() {
        fetch("/api/playlist")
            .then(r => r.json())
            .then(items => {
                // Filter to enabled videos that still exist on disk
                const playable = items.filter(v => v.enabled && v.exists !== false);
                const missing = items.filter(v => v.enabled && v.exists === false);

                console.log("[Playlist] Total:", items.length,
                    "| Playable:", playable.length,
                    "| Missing files:", missing.length,
                    "| Server state:", serverState);
                if (missing.length > 0) {
                    console.warn("[Playlist] Missing video files:",
                        missing.map(v => v.filename));
                }

                if (playable.length === 0 && playlist.length === 0) {
                    // Never had videos — keep showing splash
                    if (items.length > 0 && missing.length > 0) {
                        showSplash("Video files missing",
                            missing.length + " playlist item(s) not found in /videos/");
                    }
                    return;
                }

                if (playable.length === 0) {
                    playlist = [];
                    currentIndex = -1;
                    player.pause();
                    player.removeAttribute("src");
                    player.style.display = "none";
                    if (missing.length > 0) {
                        showSplash("Video files missing",
                            missing.length + " playlist item(s) not found in /videos/");
                    } else {
                        showSplash("No videos loaded", "Add videos via the admin panel");
                    }
                    return;
                }

                const oldNames = playlist.map(v => v.filename).join(",");
                const newNames = playable.map(v => v.filename).join(",");

                playlist = playable;

                if (currentIndex === -1 && serverState !== "stopped") {
                    console.log("[Playlist] Starting playback at index 0");
                    currentIndex = 0;
                    playCurrentVideo();
                } else if (currentIndex === -1) {
                    // Playlist loaded but waiting for play command
                    console.log("[Playlist] Loaded but state is stopped — waiting for play");
                    showSplash("Ready", playlist.length + " video(s) — press Play in admin");
                } else if (oldNames !== newNames) {
                    console.log("[Playlist] Playlist changed, re-syncing index");
                    const currentFile = player.getAttribute("src")
                        ? decodeURIComponent(player.getAttribute("src").split("/").pop())
                        : null;
                    const idx = playlist.findIndex(v => v.filename === currentFile);
                    if (idx !== -1) {
                        currentIndex = idx;
                    } else {
                        currentIndex = Math.min(currentIndex, playlist.length - 1);
                    }
                }
            })
            .catch(err => {
                console.error("[Playlist] Fetch failed:", err);
            });
    }

    // ---- Admin control state ------------------------------------------------
    let serverState = "stopped";  // last known state from /api/status
    let lastSkipCounter = 0;
    let showingChart = false;

    function reportVideo(filename) {
        fetch("/api/control/report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_video: filename || null }),
        }).catch(() => {});
    }

    function pollStatus() {
        fetch("/api/status")
            .then(r => r.json())
            .then(s => {
                // Handle skip
                if (s.skip_counter > lastSkipCounter) {
                    lastSkipCounter = s.skip_counter;
                    console.log("[Status] Skip detected, counter:", s.skip_counter);
                    if (showingChart) {
                        resumeAfterChart();
                    } else {
                        advanceToNext();
                    }
                    return;
                }

                // Handle state transitions
                if (s.state !== serverState) {
                    console.log("[Status] State change:", serverState, "->", s.state,
                        "| Playlist:", playlist.length, "| Index:", currentIndex);
                }

                if (s.state === "stopped" && serverState !== "stopped") {
                    player.pause();
                    player.removeAttribute("src");
                    player.style.display = "none";
                    imagePlayer.style.display = "none";
                    imagePlayer.removeAttribute("src");
                    if (imageTimer) { clearTimeout(imageTimer); imageTimer = null; }
                    chartOverlay.style.display = "none";
                    if (chartDismissTimer) {
                        clearTimeout(chartDismissTimer);
                        chartDismissTimer = null;
                    }
                    if (playlist.length > 0) {
                        showSplash("Ready", playlist.length + " video(s) — press Play in admin");
                    } else {
                        showSplash("No videos loaded", "Add videos via the admin panel");
                    }
                    currentIndex = -1;
                    reportVideo(null);
                } else if (s.state === "playing" && serverState === "stopped") {
                    if (playlist.length > 0) {
                        console.log("[Status] Starting playback from stopped state");
                        if (currentIndex === -1) currentIndex = 0;
                        playCurrentVideo();
                    } else {
                        console.warn("[Status] Play requested but playlist is empty");
                    }
                } else if (s.state === "playing" && serverState === "paused") {
                    if (!showingChart) {
                        if (imagePlayer.style.display === "block") {
                            imageTimer = setTimeout(advanceToNext, imageDuration * 1000);
                        } else {
                            player.play().catch(() => {});
                        }
                    }
                } else if (s.state === "paused" && serverState === "playing") {
                    if (!showingChart) {
                        if (imageTimer) { clearTimeout(imageTimer); imageTimer = null; }
                        else { player.pause(); }
                    }
                }

                serverState = s.state;
            })
            .catch(err => {
                console.error("[Status] Poll failed:", err);
            });
    }

    // ---- Media playback (video + image) ------------------------------------
    function playCurrentVideo() {
        if (imageTimer) { clearTimeout(imageTimer); imageTimer = null; }

        if (playlist.length === 0) {
            console.warn("[Player] No items in playlist");
            return;
        }
        if (serverState === "stopped") {
            console.log("[Player] Ignoring play — state is stopped");
            return;
        }

        // Clamp index just in case
        if (currentIndex < 0 || currentIndex >= playlist.length) {
            console.warn("[Player] Index out of bounds:", currentIndex, "- resetting to 0");
            currentIndex = 0;
        }

        splash.style.display = "none";
        chartOverlay.style.display = "none";
        showingChart = false;

        var item = playlist[currentIndex];
        var filename = item.filename;
        var isImage = item.type === "image";
        var src = "/videos/" + encodeURIComponent(filename);

        console.log("[Player]", isImage ? "Showing image:" : "Playing:", filename,
            "(" + (currentIndex + 1) + "/" + playlist.length + ")");
        reportVideo(filename);

        if (isImage) {
            player.pause();
            player.removeAttribute("src");
            player.style.display = "none";
            imagePlayer.src = src;
            imagePlayer.style.display = "block";
            consecutiveErrors = 0;
            imageTimer = setTimeout(advanceToNext, imageDuration * 1000);
        } else {
            imagePlayer.style.display = "none";
            imagePlayer.removeAttribute("src");
            player.style.display = "block";
            player.src = src;
            player.play().then(() => {
                consecutiveErrors = 0;
            }).catch(() => {
                document.addEventListener("click", function once() {
                    player.play();
                    document.removeEventListener("click", once);
                });
            });
        }
    }

    function advanceToNext() {
        if (playlist.length === 0) return;
        if (serverState === "stopped") return;

        videoCounter++;

        // Check if it's time for a chart slide
        if (chartQueue.length > 0 && chartFrequency > 0 && videoCounter % chartFrequency === 0) {
            showChartSlide();
            return;
        }

        currentIndex = (currentIndex + 1) % playlist.length;
        playCurrentVideo();
    }

    // ---- Chart slides -----------------------------------------------------
    function showChartSlide() {
        if (chartQueue.length === 0) { advanceToNext(); return; }

        const entry = chartQueue[chartQueueIndex % chartQueue.length];
        chartQueueIndex++;
        showingChart = true;

        player.pause();
        player.style.display = "none";
        imagePlayer.style.display = "none";
        if (imageTimer) { clearTimeout(imageTimer); imageTimer = null; }
        reportVideo("Chart: " + entry.name + " " + entry.periodLabel);

        chartTitle.textContent = entry.name.toUpperCase() + " \u2014 " + entry.periodLabel + " Price (" + displayCurrency + ")";
        chartOverlay.style.display = "flex";

        fetchChartData(entry.symbol, entry.period, function (data) {
            if (!data) {
                resumeAfterChart();
                return;
            }
            renderChart(data, entry);
            chartDismissTimer = setTimeout(resumeAfterChart, chartDuration * 1000);
        });
    }

    function resumeAfterChart() {
        if (chartDismissTimer) {
            clearTimeout(chartDismissTimer);
            chartDismissTimer = null;
        }
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
        chartOverlay.style.display = "none";
        currentIndex = (currentIndex + 1) % playlist.length;
        playCurrentVideo();
    }

    function fetchChartData(symbol, period, cb) {
        var cacheKey = symbol + ":" + period;
        var cached = chartCache[cacheKey];
        if (cached && Date.now() - cached.time < CHART_CACHE_TTL) {
            cb(cached.data);
            return;
        }

        fetch("/api/chart-data/" + encodeURIComponent(symbol) + "?period=" + encodeURIComponent(period))
            .then(r => {
                if (!r.ok) throw new Error(r.status);
                return r.json();
            })
            .then(data => {
                if (data.error) {
                    cb(null);
                    return;
                }
                chartCache[cacheKey] = { data: data, time: Date.now() };
                cb(data);
            })
            .catch(() => cb(null));
    }

    function renderChart(data, metal) {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }

        // Pick the right price array for the selected currency
        var pricesKey = "prices_" + displayCurrency.toLowerCase();
        var prices = data[pricesKey] || data.prices_cad || data.prices_usd || [];
        var currSym = displayCurrency === "EUR" ? "\u20AC" : "$";

        // Thin the labels — show ~12 evenly spaced labels on the x-axis
        const totalPoints = data.labels.length;
        const labelStep = Math.max(1, Math.floor(totalPoints / 12));
        const thinLabels = data.labels.map(
            (l, i) => (i % labelStep === 0) ? l : ""
        );

        const ctx = chartCanvas.getContext("2d");
        chartInstance = new Chart(ctx, {
            type: "line",
            data: {
                labels: thinLabels,
                datasets: [{
                    label: metal.name + " (" + displayCurrency + ")",
                    data: prices,
                    borderColor: metal.color,
                    backgroundColor: metal.color + "18",
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHitRadius: 0,
                    tension: 0.3,
                    fill: true,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 600 },
                layout: { padding: { left: 10, right: 20, top: 0, bottom: 0 } },
                scales: {
                    x: {
                        ticks: { color: "#888", font: { size: 13 }, maxRotation: 0 },
                        grid: { color: "rgba(255,255,255,0.06)" },
                    },
                    y: {
                        ticks: {
                            color: "#888",
                            font: { size: 14 },
                            callback: function (v) { return currSym + v.toLocaleString(); },
                        },
                        grid: { color: "rgba(255,255,255,0.06)" },
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                },
            },
        });
    }

    // ---- Events -----------------------------------------------------------
    player.addEventListener("ended", function () {
        console.log("[Player] Video ended, advancing");
        advanceToNext();
    });

    player.addEventListener("error", function () {
        const src = player.getAttribute("src") || "unknown";
        consecutiveErrors++;
        console.error("[Player] Error loading:", src,
            "| Consecutive errors:", consecutiveErrors + "/" + playlist.length);

        if (consecutiveErrors >= playlist.length && playlist.length > 0) {
            // Every video in the playlist failed — stop looping
            console.error("[Player] All videos failed to load, showing error splash");
            player.pause();
            player.removeAttribute("src");
            player.style.display = "none";
            showSplash("Video playback error",
                "All " + playlist.length + " video(s) failed to load — check files in /videos/");
            consecutiveErrors = 0;
            return;
        }

        // Skip to next video after a brief delay
        setTimeout(advanceToNext, 500);
    });

    imagePlayer.addEventListener("error", function () {
        var src = imagePlayer.getAttribute("src") || "unknown";
        consecutiveErrors++;
        console.error("[Player] Image error:", src,
            "| Consecutive errors:", consecutiveErrors + "/" + playlist.length);
        if (imageTimer) { clearTimeout(imageTimer); imageTimer = null; }

        if (consecutiveErrors >= playlist.length && playlist.length > 0) {
            console.error("[Player] All items failed to load");
            imagePlayer.style.display = "none";
            showSplash("Playback error",
                "All " + playlist.length + " item(s) failed to load — check files in /videos/");
            consecutiveErrors = 0;
            return;
        }
        setTimeout(advanceToNext, 500);
    });

    // ---- Init & polling ---------------------------------------------------
    fetchChartSettings();
    fetchPlaylist();
    pollStatus();
    setInterval(fetchPlaylist, 30000);
    setInterval(fetchChartSettings, 30000);
    setInterval(pollStatus, 3000);
})();

// Display page — price ticker (separate from video loop)
(function () {
    "use strict";

    const ticker = document.getElementById("ticker");
    const tickerContent = document.getElementById("ticker-content");
    const tickerUpdated = document.getElementById("ticker-updated");

    let tickerMode = "static";
    let currency = "CAD";

    const CURR_MAP = {
        CAD: { priceKey: "price_cad", changeKey: "change_dollar", sym: "$" },
        USD: { priceKey: "price_usd", changeKey: "change_usd",    sym: "$" },
        EUR: { priceKey: "price_eur", changeKey: "change_eur",    sym: "\u20AC" },
    };

    // ---- Format helpers ---------------------------------------------------
    function fmtPrice(n) {
        var s = (CURR_MAP[currency] || CURR_MAP.CAD).sym;
        return s + Number(n).toLocaleString("en-CA", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    function fmtChange(n) {
        var s = (CURR_MAP[currency] || CURR_MAP.CAD).sym;
        const abs = Math.abs(n);
        return s + abs.toLocaleString("en-CA", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    function fmtPct(n) {
        return Math.abs(n).toFixed(2) + "%";
    }

    function fmtTime(iso) {
        try {
            const d = new Date(iso + "Z");
            return d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false });
        } catch {
            return "--:--";
        }
    }

    // ---- Rendering --------------------------------------------------------
    function renderPrices(prices, fetchedAt) {
        if (!prices || prices.length === 0) {
            tickerContent.innerHTML = '<span class="ticker-loading">Prices loading\u2026</span>';
            tickerUpdated.textContent = "";
            return;
        }

        var cc = CURR_MAP[currency] || CURR_MAP.CAD;

        const items = prices.map((p, i) => {
            const price = p[cc.priceKey];
            const change = p[cc.changeKey] || 0;
            const pos = change >= 0;
            const cls = pos ? "change-pos" : "change-neg";
            const arrow = pos ? "\u25B2" : "\u25BC";
            const sign = pos ? "+" : "-";

            const sep = i < prices.length - 1
                ? '<span class="ticker-sep">|</span>'
                : '';

            return '<span class="ticker-item">'
                + '<span class="metal-name">' + p.name + '</span> '
                + '<span class="metal-price">' + fmtPrice(price) + '</span> '
                + '<span class="metal-change ' + cls + '">'
                    + arrow + fmtChange(change)
                    + ' (' + sign + fmtPct(p.change_percent) + ')'
                + '</span>'
                + '</span>'
                + sep;
        }).join("");

        tickerContent.innerHTML = items;

        if (tickerMode === "marquee") {
            requestAnimationFrame(() => {
                const contentW = tickerContent.scrollWidth;
                const screenW = window.innerWidth;
                const duration = (contentW + screenW) / 60;
                ticker.style.setProperty("--marquee-duration", duration + "s");
            });
        }

        tickerUpdated.textContent = "Last updated: " + fmtTime(fetchedAt);
    }

    // ---- Fetch prices -----------------------------------------------------
    function fetchPrices() {
        fetch("/api/prices")
            .then(r => r.json())
            .then(data => {
                const prices = data.prices || [];
                const fetchedAt = prices.length > 0 ? prices[0].fetched_at : null;

                if (data.failures >= 3 && prices.length > 0) {
                    tickerUpdated.textContent = "\u26A0 Last updated: " + fmtTime(fetchedAt);
                } else {
                    renderPrices(prices, fetchedAt);
                }
            })
            .catch(() => {});
    }

    // ---- Fetch settings (ticker mode) ------------------------------------
    function fetchSettings() {
        fetch("/api/settings")
            .then(r => r.json())
            .then(settings => {
                const newMode = settings.ticker_mode === "marquee" ? "marquee" : "static";
                if (newMode !== tickerMode) {
                    tickerMode = newMode;
                    applyMode();
                }

                var newCurrency = settings.currency || "CAD";
                if (newCurrency !== currency) {
                    currency = newCurrency;
                    fetchPrices(); // re-render with new currency
                }

                if (settings.ticker_enabled === "false") {
                    ticker.style.display = "none";
                } else {
                    ticker.style.display = "flex";
                }
            })
            .catch(() => {});
    }

    function applyMode() {
        ticker.classList.remove("mode-static", "mode-marquee");
        ticker.classList.add("mode-" + tickerMode);
    }

    // ---- Init & polling ---------------------------------------------------
    applyMode();
    fetchSettings();
    fetchPrices();
    setInterval(fetchPrices, 60000);
    setInterval(fetchSettings, 30000);
})();
