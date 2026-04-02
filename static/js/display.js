// Display page — video loop + chart slides
(function () {
    "use strict";

    const player = document.getElementById("player");
    const splash = document.getElementById("splash");
    const chartOverlay = document.getElementById("chart-overlay");
    const chartTitle = document.getElementById("chart-title");
    const chartCanvas = document.getElementById("chart-canvas");

    let playlist = [];
    let currentIndex = -1;
    let videoCounter = 0;

    // ---- Chart state ------------------------------------------------------
    const CHART_METALS = [
        { symbol: "GC=F", name: "Gold",      color: "#FFD700" },
        { symbol: "SI=F", name: "Silver",    color: "#C0C0C0" },
        { symbol: "PL=F", name: "Platinum",  color: "#E5E4E2" },
        { symbol: "PA=F", name: "Palladium", color: "#CED0DD" },
    ];
    let chartMetalIndex = 0;
    let chartInstance = null;
    let chartDismissTimer = null;

    // Client-side chart data cache: symbol -> {data, time}
    const chartCache = {};
    const CHART_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

    // Settings (fetched periodically by ticker IIFE, read here)
    let chartsEnabled = true;
    let chartFrequency = 3;
    let chartDuration = 15;

    // ---- Settings sync ----------------------------------------------------
    function fetchChartSettings() {
        fetch("/api/settings")
            .then(r => r.json())
            .then(s => {
                chartsEnabled = s.charts_enabled !== "false";
                chartFrequency = parseInt(s.chart_frequency, 10) || 3;
                chartDuration = parseInt(s.chart_duration, 10) || 15;
            })
            .catch(() => {});
    }

    // ---- Playlist fetching ------------------------------------------------
    function fetchPlaylist() {
        fetch("/api/playlist")
            .then(r => r.json())
            .then(items => {
                const enabled = items.filter(v => v.enabled);

                if (enabled.length === 0 && playlist.length === 0) {
                    return;
                }

                if (enabled.length === 0) {
                    playlist = [];
                    currentIndex = -1;
                    player.pause();
                    player.removeAttribute("src");
                    player.style.display = "none";
                    splash.style.display = "flex";
                    return;
                }

                const oldNames = playlist.map(v => v.filename).join(",");
                const newNames = enabled.map(v => v.filename).join(",");

                playlist = enabled;

                if (currentIndex === -1 && serverState !== "stopped") {
                    currentIndex = 0;
                    playCurrentVideo();
                } else if (currentIndex === -1) {
                    // Playlist loaded but waiting for play command
                } else if (oldNames !== newNames) {
                    const currentFile = player.getAttribute("src")?.split("/").pop();
                    const idx = playlist.findIndex(v => v.filename === currentFile);
                    if (idx !== -1) {
                        currentIndex = idx;
                    } else {
                        currentIndex = Math.min(currentIndex, playlist.length - 1);
                    }
                }
            })
            .catch(() => {});
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
                    if (showingChart) {
                        resumeAfterChart();
                    } else {
                        advanceToNext();
                    }
                    return;
                }

                // Handle state transitions
                if (s.state === "stopped" && serverState !== "stopped") {
                    player.pause();
                    player.removeAttribute("src");
                    player.style.display = "none";
                    chartOverlay.style.display = "none";
                    splash.style.display = "flex";
                    if (chartDismissTimer) {
                        clearTimeout(chartDismissTimer);
                        chartDismissTimer = null;
                    }
                    reportVideo(null);
                } else if (s.state === "playing" && serverState === "stopped") {
                    if (playlist.length > 0) {
                        if (currentIndex === -1) currentIndex = 0;
                        playCurrentVideo();
                    }
                } else if (s.state === "playing" && serverState === "paused") {
                    if (!showingChart) player.play().catch(() => {});
                } else if (s.state === "paused" && serverState === "playing") {
                    if (!showingChart) player.pause();
                }

                serverState = s.state;
            })
            .catch(() => {});
    }

    // ---- Video playback ---------------------------------------------------
    function playCurrentVideo() {
        if (playlist.length === 0) return;
        if (serverState === "stopped") return;

        splash.style.display = "none";
        chartOverlay.style.display = "none";
        player.style.display = "block";
        showingChart = false;

        const filename = playlist[currentIndex].filename;
        player.src = "/videos/" + encodeURIComponent(filename);
        reportVideo(filename);
        player.play().catch(() => {
            document.addEventListener("click", function once() {
                player.play();
                document.removeEventListener("click", once);
            });
        });
    }

    function advanceToNext() {
        if (playlist.length === 0) return;
        if (serverState === "stopped") return;

        videoCounter++;

        // Check if it's time for a chart slide
        if (chartsEnabled && chartFrequency > 0 && videoCounter % chartFrequency === 0) {
            showChartSlide();
            return;
        }

        currentIndex = (currentIndex + 1) % playlist.length;
        playCurrentVideo();
    }

    // ---- Chart slides -----------------------------------------------------
    function showChartSlide() {
        const metal = CHART_METALS[chartMetalIndex % CHART_METALS.length];
        chartMetalIndex++;
        showingChart = true;

        player.pause();
        player.style.display = "none";
        reportVideo("Chart: " + metal.name);

        chartTitle.textContent = metal.name.toUpperCase() + " \u2014 7 Day Price (CAD)";
        chartOverlay.style.display = "flex";

        fetchChartData(metal.symbol, function (data) {
            if (!data) {
                // No data — skip chart, resume video
                resumeAfterChart();
                return;
            }
            renderChart(data, metal);
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

    function fetchChartData(symbol, cb) {
        // Check client-side cache
        const cached = chartCache[symbol];
        if (cached && Date.now() - cached.time < CHART_CACHE_TTL) {
            cb(cached.data);
            return;
        }

        fetch("/api/chart-data/" + encodeURIComponent(symbol))
            .then(r => {
                if (!r.ok) throw new Error(r.status);
                return r.json();
            })
            .then(data => {
                if (data.error) {
                    cb(null);
                    return;
                }
                chartCache[symbol] = { data: data, time: Date.now() };
                cb(data);
            })
            .catch(() => cb(null));
    }

    function renderChart(data, metal) {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }

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
                    label: metal.name + " (CAD)",
                    data: data.prices,
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
                            callback: function (v) { return "$" + v.toLocaleString(); },
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
    player.addEventListener("ended", advanceToNext);

    player.addEventListener("error", function () {
        setTimeout(advanceToNext, 1000);
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

    // ---- Format helpers ---------------------------------------------------
    function fmtPrice(n) {
        return "$" + Number(n).toLocaleString("en-CA", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    function fmtChange(n) {
        const abs = Math.abs(n);
        return "$" + abs.toLocaleString("en-CA", {
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

        const items = prices.map((p, i) => {
            const pos = p.change_dollar >= 0;
            const cls = pos ? "change-pos" : "change-neg";
            const arrow = pos ? "\u25B2" : "\u25BC";
            const sign = pos ? "+" : "-";

            const sep = i < prices.length - 1
                ? '<span class="ticker-sep">|</span>'
                : '';

            return '<span class="ticker-item">'
                + '<span class="metal-name">' + p.name + '</span> '
                + '<span class="metal-price">' + fmtPrice(p.price_cad) + '</span> '
                + '<span class="metal-change ' + cls + '">'
                    + arrow + fmtChange(p.change_dollar)
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
