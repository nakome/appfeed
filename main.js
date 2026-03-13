class AppFeed {
    constructor() {
        // Estado principal de la app.
        this.allItems = [];
        this.filteredItems = [];
        this.failedFeeds = [];
        this.feedDiagnostics = [];
        this.itemMeta = {};
        this.pendingTags = new Set();

        this.isSummarizing = false;
        this.isVoiceRecording = false;

        this.mediaRecorder = null;
        this.voiceChunks = [];
        this.voiceStream = null;
        this.activeAudio = null;

        this.currentUser = null;
        this.chatHistory = [];
        this.aiChatSafeMode = true;

        this.currentPage = 1;
        this.itemsPerPage = 9;
        this.responsiveLayoutReady = false;
        this.viewportResizeTimer = null;

        this.currentFilterCatId = null;
        this.autoRefreshMs = 5 * 60 * 1000;
        this.autoRefreshEnabled = true;
        this.autoRefreshTimer = null;
        this.isRefreshingFeeds = false;
        this.lastRefreshAt = 0;
        this.reopenManageFeedsAfterModalClose = false;
        this.feedDetectDebounceTimer = null;
        this.feedDetectInProgress = false;
        this.lastDetectedInputUrl = "";

        this.db = {
            categories: [],
            feeds: [],
            settings: {
                darkMode: true,
                autoRefreshMs: 5 * 60 * 1000,
                autoRefreshEnabled: true,
                layoutDensity: "auto",
            },
        };

        this.CONFIG_PATH = "rss_config.json";
        this.BACKUP_DIR = "~/AppFeedBackups";

        this.utils = window.FeedUtils || {
            normalizeUrl: (value) => {
                const raw = String(value || "").trim();
                if (!raw) return "";
                const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
                try {
                    return new URL(withProtocol).toString();
                } catch {
                    return "";
                }
            },
            isLikelyFeedUrl: (url) => /(?:rss|atom|feed|xml)(?:[/?#.]|$)/i.test(String(url || "")),
            parsePublishedTimestamp: (value) => {
                if (!value) return 0;
                const time = Date.parse(value);
                return Number.isNaN(time) ? 0 : time;
            },
            sanitizePlainText: (value, fallback = "") => {
                const source = String(value || "");
                const cleaned = Array.from(source, (ch) => {
                    const code = ch.charCodeAt(0);
                    if (code < 32 || code === 127) return " ";
                    return ch;
                }).join("");
                const text = cleaned.replace(/\s+/g, " ").trim();
                return text || fallback;
            },
            safeExternalUrl: (value) => {
                try {
                    const parsed = new URL(String(value || ""), window.location.href);
                    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : "";
                } catch {
                    return "";
                }
            },
        };
    }

    // Inicializa config, tema, auth y carga inicial.
    async init() {
        try {
            const response = await puter.fs.read(this.CONFIG_PATH).catch(() => null);
            let hasDarkModeSaved = false;

            if (response) {
                const text = await response.text();
                this.db = JSON.parse(text);
                hasDarkModeSaved = typeof this.db?.settings?.darkMode === "boolean";
            }

            this.ensureConfigSchema();

            if (!response) {
                await this.saveToPuter();
            }

            if (!hasDarkModeSaved) {
                this.db.settings.darkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
                await this.saveToPuter();
            }

            this.applyThemePreference();
            this.renderUI();
            this.setupResponsiveLayout();
            this.autoRefreshMs = this.db.settings.autoRefreshMs;
            this.autoRefreshEnabled = this.db.settings.autoRefreshEnabled;
            this.updateRefreshIntervalControl();
            this.updateAutoRefreshToggleControl();
            await this.refreshUserInfo();
            await this.loadAllFeeds();
            this.setupAutoRefresh();
        } catch (e) {
            console.error("Init error:", e);
        }
    }

    setupAutoRefresh() {
        this.startAutoRefresh();

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.stopAutoRefresh();
                return;
            }

            this.startAutoRefresh();
            this.refreshFeedsSilently();
        });

        window.addEventListener("beforeunload", () => this.stopAutoRefresh());
    }

    startAutoRefresh() {
        this.stopAutoRefresh();
        if (!this.autoRefreshEnabled) return;
        this.autoRefreshTimer = window.setInterval(() => {
            this.refreshFeedsSilently();
        }, this.autoRefreshMs);
    }

    stopAutoRefresh() {
        if (!this.autoRefreshTimer) return;
        clearInterval(this.autoRefreshTimer);
        this.autoRefreshTimer = null;
    }

    async refreshFeedsSilently() {
        if (this.isRefreshingFeeds) return;
        await this.loadAllFeeds(this.currentFilterCatId, { preservePage: true, closeSidebarOnMobile: false });
    }

    setRefreshStatus(text) {
        const status = document.getElementById("refresh-status");
        if (!status) return;
        status.textContent = text;
    }

    updateRetryFailedButton() {
        const btn = document.getElementById("retry-failed-btn");
        if (!btn) return;
        btn.classList.toggle("hidden", !this.failedFeeds.length);
    }

    showToast(message, type = "info") {
        const container = document.getElementById("toast-container");
        if (!container || !message) return;

        const toneMap = {
            info: "bg-slate-800 text-white",
            success: "bg-emerald-700 text-white",
            warn: "bg-amber-600 text-white",
            error: "bg-red-600 text-white",
        };

        const toast = document.createElement("div");
        toast.className = `rounded-md px-3 py-2 text-xs shadow-lg transition-opacity duration-300 ${toneMap[type] || toneMap.info}`;
        toast.textContent = message;
        container.appendChild(toast);

        window.setTimeout(() => {
            toast.style.opacity = "0";
            window.setTimeout(() => toast.remove(), 280);
        }, 2600);
    }

    updateRefreshIntervalControl() {
        const select = document.getElementById("refreshIntervalSelect");
        if (!select) return;

        const value = String(this.autoRefreshMs);
        const hasOption = Array.from(select.options).some((opt) => opt.value === value);
        if (hasOption) {
            select.value = value;
        }
    }

    updateAutoRefreshToggleControl() {
        const toggle = document.getElementById("auto-refresh-toggle");
        const label = document.getElementById("auto-refresh-toggle-label");

        if (toggle) toggle.checked = this.autoRefreshEnabled;
        if (label) label.textContent = this.autoRefreshEnabled ? "Auto ON" : "Auto OFF";
    }

    updateLayoutDensityControl() {
        const select = document.getElementById("densitySelect");
        if (!select) return;

        const value = String(this.db?.settings?.layoutDensity || "auto");
        const hasOption = Array.from(select.options).some((opt) => opt.value === value);
        select.value = hasOption ? value : "auto";
    }

    async setRefreshInterval(valueMs) {
        const next = Number(valueMs);
        if (!Number.isFinite(next) || next < 30000) return;
        if (next === this.autoRefreshMs) return;

        this.autoRefreshMs = next;
        this.db.settings.autoRefreshMs = next;
        this.updateRefreshIntervalControl();
        this.startAutoRefresh();
        await this.saveToPuter();
    }

    async setAutoRefreshEnabled(enabled) {
        this.autoRefreshEnabled = Boolean(enabled);
        this.db.settings.autoRefreshEnabled = this.autoRefreshEnabled;
        this.updateAutoRefreshToggleControl();

        if (this.autoRefreshEnabled) {
            this.startAutoRefresh();
            await this.refreshFeedsSilently();
        } else {
            this.stopAutoRefresh();
        }

        await this.saveToPuter();
    }

    async setLayoutDensity(value) {
        const allowed = new Set(["auto", "compact", "comfortable"]);
        const next = allowed.has(value) ? value : "auto";
        if (next === this.db.settings.layoutDensity) return;

        this.db.settings.layoutDensity = next;
        this.updateLayoutDensityControl();

        const changed = this.updateItemsPerPageByViewport();
        if (changed) {
            const totalPages = Math.max(1, Math.ceil(this.filteredItems.length / this.itemsPerPage));
            if (this.currentPage > totalPages) this.currentPage = totalPages;
            this.renderPage(this.filteredItems);
        }

        await this.saveToPuter();
    }

    // Guarda estado persistente.
    async saveToPuter() {
        await puter.fs.write(this.CONFIG_PATH, JSON.stringify(this.db));
        this.renderUI();
    }

    // Garantiza estructura minima para compatibilidad.
    ensureConfigSchema() {
        if (!Array.isArray(this.db.categories)) this.db.categories = [];
        if (!Array.isArray(this.db.feeds)) this.db.feeds = [];
        if (!this.db.settings || typeof this.db.settings !== "object") {
            this.db.settings = { darkMode: true };
        }
        if (typeof this.db.settings.darkMode !== "boolean") {
            this.db.settings.darkMode = true;
        }
        if (!Number.isFinite(this.db.settings.autoRefreshMs) || this.db.settings.autoRefreshMs < 30000) {
            this.db.settings.autoRefreshMs = 5 * 60 * 1000;
        }
        if (typeof this.db.settings.autoRefreshEnabled !== "boolean") {
            this.db.settings.autoRefreshEnabled = true;
        }
        if (!["auto", "compact", "comfortable"].includes(this.db.settings.layoutDensity)) {
            this.db.settings.layoutDensity = "auto";
        }
    }

    // Activa o desactiva dark mode.
    applyThemePreference() {
        document.documentElement.classList.toggle("dark", this.db.settings.darkMode);
        this.updateThemeToggleButton();
    }

    // Actualiza icono y texto del boton de tema segun el modo activo.
    updateThemeToggleButton() {
        const icon = document.getElementById("theme-toggle-icon");
        const label = document.getElementById("theme-toggle-label");
        if (!icon || !label) return;

        if (this.db.settings.darkMode) {
            icon.textContent = "☀️";
            label.textContent = "Modo Claro";
        } else {
            icon.textContent = "🌙";
            label.textContent = "Modo Oscuro";
        }

        this.renderMobileQuickActionsState();
    }

    toggleSidebar() {
        document.getElementById("sidebar").classList.toggle("-translate-x-full");
        document.getElementById("overlay").classList.toggle("hidden");
    }

    // Renderiza panel lateral y estado de usuario.
    renderUI() {
        document.getElementById("category-list").innerHTML = this.db.categories
            .map(
                (cat) => `
                <div class="group flex items-center justify-between p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer" onclick="loadAllFeeds('${cat.id}')">
                    <div class="flex items-center gap-2">
                        <span class="w-3 h-3 rounded-md" style="background:${cat.color}"></span>
                        <span class="text-sm font-medium">${this.escapeHtml(cat.name)}</span>
                    </div>
                    <button onclick="event.stopPropagation(); deleteCategory('${cat.id}')" class="opacity-0 group-hover:opacity-100 text-red-500 text-xs">✕</button>
                </div>
            `,
            )
            .join("");

        document.getElementById("manage-feeds-list").innerHTML = this.db.feeds
            .map(
                (feed) => `
                <div class="text-[11px] border-b border-slate-100 dark:border-slate-800 py-2 flex justify-between items-center group">
                    <div class="truncate flex-1 pr-2 font-bold">${this.escapeHtml(feed.url)}</div>
                    <div class="flex gap-1">
                        <button onclick="editFeed('${feed.id}')" class="p-1 text-blue-500">✏️</button>
                        <button onclick="deleteFeed('${feed.id}')" class="p-1 text-red-500">✕</button>
                    </div>
                </div>
            `,
            )
            .join("");

        this.renderAuthPanel();
        this.updateLayoutDensityControl();
        this.renderMobileQuickActionsState();
    }

    setupResponsiveLayout() {
        if (this.responsiveLayoutReady) return;
        this.responsiveLayoutReady = true;

        this.updateItemsPerPageByViewport();

        window.addEventListener("resize", () => {
            if (this.viewportResizeTimer) {
                window.clearTimeout(this.viewportResizeTimer);
            }

            this.viewportResizeTimer = window.setTimeout(() => {
                const changed = this.updateItemsPerPageByViewport();
                if (!changed) return;

                const totalPages = Math.max(1, Math.ceil(this.filteredItems.length / this.itemsPerPage));
                if (this.currentPage > totalPages) this.currentPage = totalPages;

                this.renderPage(this.filteredItems);
                this.renderMobileQuickActionsState();
            }, 140);
        });

        const searchInput = document.getElementById("searchInput");
        if (searchInput) {
            searchInput.addEventListener("focus", () => this.renderMobileQuickActionsState());
            searchInput.addEventListener("blur", () => this.renderMobileQuickActionsState());
        }

        this.renderMobileQuickActionsState();
    }

    updateItemsPerPageByViewport() {
        const width = window.innerWidth || 1280;
        const density = this.db?.settings?.layoutDensity || "auto";
        let next = 12;

        if (width < 640) {
            next = density === "compact" ? 8 : density === "comfortable" ? 4 : 6;
        } else if (width < 1024) {
            next = density === "compact" ? 10 : density === "comfortable" ? 6 : 8;
        } else {
            next = density === "compact" ? 14 : density === "comfortable" ? 9 : 12;
        }

        if (this.itemsPerPage === next) return false;

        this.itemsPerPage = next;
        return true;
    }

    setQuickActionActive(action, isActive) {
        const btn = document.querySelector(`[data-quick-action="${action}"]`);
        if (!btn) return;

        btn.classList.toggle("bg-slate-200", isActive);
        btn.classList.toggle("dark:bg-slate-700", isActive);
        btn.classList.toggle("text-slate-900", isActive);
        btn.classList.toggle("dark:text-white", isActive);
    }

    renderMobileQuickActionsState() {
        const isMobile = window.innerWidth < 768;
        const isChatOpen = !document.getElementById("ai-chat-modal")?.classList.contains("hidden");
        const isFeedsOpen = !document.getElementById("manage-feeds-modal")?.classList.contains("hidden");
        const isGeneralModalOpen = !document.getElementById("modal")?.classList.contains("hidden");
        const hasSearchFocus = document.activeElement?.id === "searchInput";
        const isDark = Boolean(this.db?.settings?.darkMode);

        this.setQuickActionActive("home", isMobile && !isChatOpen && !isFeedsOpen && !isGeneralModalOpen && !hasSearchFocus);
        this.setQuickActionActive("search", isMobile && hasSearchFocus);
        this.setQuickActionActive("chat", isMobile && isChatOpen);
        this.setQuickActionActive("feeds", isMobile && (isFeedsOpen || isGeneralModalOpen));
        this.setQuickActionActive("theme", isMobile && isDark);
    }

    focusSearchInput() {
        const input = document.getElementById("searchInput");
        if (!input) return;

        input.focus();
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        this.renderMobileQuickActionsState();
    }

    // Pinta info de usuario autenticado.
    renderAuthPanel() {
        const userStatus = document.getElementById("user-status");
        const signInBtn = document.getElementById("sign-in-btn");
        const signOutBtn = document.getElementById("sign-out-btn");

        if (!userStatus || !signInBtn || !signOutBtn) return;

        if (this.currentUser) {
            const username = this.currentUser.username || this.currentUser.email || "Usuario";
            userStatus.textContent = `Conectado: ${username}`;
            signInBtn.classList.add("hidden");
            signOutBtn.classList.remove("hidden");
        } else {
            userStatus.textContent = "No has iniciado sesion";
            signInBtn.classList.remove("hidden");
            signOutBtn.classList.add("hidden");
        }
    }

    // Actualiza estado de sesion actual.
    async refreshUserInfo() {
        try {
            const signed = await puter.auth.isSignedIn();
            this.currentUser = signed ? await puter.auth.getUser() : null;
        } catch {
            this.currentUser = null;
        }
        this.renderAuthPanel();
    }

    async signInUser() {
        await puter.auth.signIn();
        await this.refreshUserInfo();
    }

    async signOutUser() {
        await puter.auth.signOut();
        await this.refreshUserInfo();
    }

    // Descarga y normaliza items RSS/Atom.
    async fetchRSS(url) {
        try {
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), 12000);
            const response = await fetch(`proxy.php?url=${encodeURIComponent(url)}`, {
                signal: controller.signal,
            });
            window.clearTimeout(timeoutId);

            if (!response.ok) {
                return { items: [], error: `HTTP ${response.status}` };
            }

            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, "text/xml");
            const parserError = xml.querySelector("parsererror");

            if (parserError) {
                return { items: [], error: "Formato RSS/Atom invalido" };
            }

            const items = Array.from(xml.querySelectorAll("item, entry"));

            return {
                items: items.slice(0, 10).map((i) => {
                    const desc = i.querySelector("description, summary, content")?.textContent || "";
                    const temp = document.createElement("div");
                    temp.innerHTML = desc;

                    const publishedRaw =
                        i.querySelector("pubDate, updated, published, issued")?.textContent ||
                        i.querySelector("dc\\:date")?.textContent ||
                        "";
                    const publishedAt = this.parsePublishedTimestamp(publishedRaw);

                    const img =
                        i.querySelector("enclosure")?.getAttribute("url") ||
                        i.querySelector("media\\:content")?.getAttribute("url") ||
                        temp.querySelector("img")?.src ||
                        "";

                    const link =
                        i.querySelector("link")?.getAttribute("href") ||
                        i.querySelector("link")?.textContent ||
                        "#";

                    const safeTitle = this.utils.sanitizePlainText(
                        i.querySelector("title")?.textContent || "",
                        "Sin titulo",
                    );
                    const safeDescription = this.utils.sanitizePlainText(
                        desc.replace(/<[^>]*>?/gm, "").substring(0, 180),
                        "Sin descripcion",
                    );

                    return {
                        key: this.makeItemKey(link, safeTitle),
                        title: safeTitle,
                        link,
                        description: `${safeDescription}...`,
                        image: img || false,
                        ocrText: "",
                        publishedAt,
                    };
                }),
                error: null,
            };
        } catch (e) {
            if (e?.name === "AbortError") {
                return { items: [], error: "Tiempo de espera agotado" };
            }
            return { items: [], error: e.message };
        }
    }

    normalizeUrl(value) {
        return this.utils.normalizeUrl(value);
    }

    isLikelyFeedUrl(url) {
        return this.utils.isLikelyFeedUrl(url);
    }

    safeExternalUrl(value) {
        return this.utils.safeExternalUrl(value);
    }

    setFeedDetectStatus(text, isError = false) {
        const el = document.getElementById("feed-detect-status");
        if (!el) return;

        el.textContent = text || "";
        el.classList.toggle("text-red-500", Boolean(isError));
        el.classList.toggle("text-slate-500", !isError);
    }

    renderFeedCandidates(urls) {
        const select = document.getElementById("feed-candidate-select");
        if (!select) return;

        const candidates = Array.from(new Set((urls || []).filter(Boolean)));
        if (!candidates.length) {
            select.classList.add("hidden");
            select.innerHTML = "";
            return;
        }

        select.innerHTML = candidates
            .map((url) => {
                const safe = this.escapeHtml(url);
                return `<option value="${safe}">${safe}</option>`;
            })
            .join("");
        select.classList.remove("hidden");
    }

    handleFeedUrlInputChange() {
        const input = document.getElementById("val1");
        const current = String(input?.value || "").trim();

        this.setFeedDetectStatus("");
        this.renderFeedCandidates([]);

        if (this.feedDetectDebounceTimer) {
            clearTimeout(this.feedDetectDebounceTimer);
            this.feedDetectDebounceTimer = null;
        }

        if (!current) {
            this.lastDetectedInputUrl = "";
            return;
        }

        this.feedDetectDebounceTimer = window.setTimeout(() => {
            this.detectFeedSources({ auto: true });
        }, 700);
    }

    async discoverFeedUrls(inputUrl) {
        const normalized = this.normalizeUrl(inputUrl);
        if (!normalized) return [];

        const response = await fetch(`proxy.php?url=${encodeURIComponent(normalized)}`);
        const raw = await response.text();
        if (!response.ok) {
            return [];
        }

        const parser = new DOMParser();
        const asXml = parser.parseFromString(raw, "text/xml");
        const xmlError = asXml.querySelector("parsererror");
        const rootName = asXml?.documentElement?.nodeName?.toLowerCase() || "";

        if (!xmlError && ["rss", "feed", "rdf:rdf"].includes(rootName)) {
            return [normalized];
        }

        const asHtml = parser.parseFromString(raw, "text/html");
        const links = [];
        const addUrl = (href) => {
            if (!href) return;
            try {
                links.push(new URL(href, normalized).toString());
            } catch {
                // noop
            }
        };

        asHtml
            .querySelectorAll('link[rel~="alternate"]')
            .forEach((el) => {
                const type = (el.getAttribute("type") || "").toLowerCase();
                const href = el.getAttribute("href") || "";
                if (type.includes("rss") || type.includes("atom") || type.includes("xml")) {
                    addUrl(href);
                }
            });

        asHtml.querySelectorAll("a[href]").forEach((el) => {
            const href = el.getAttribute("href") || "";
            if (/(?:rss|atom|feed|xml)/i.test(href)) {
                addUrl(href);
            }
        });

        ["/feed", "/rss", "/rss.xml", "/atom.xml", "/feed.xml", "/index.xml"].forEach((path) => {
            addUrl(path);
        });

        const candidates = Array.from(new Set(links)).slice(0, 12);
        if (!candidates.length) return [];

        const checks = await Promise.all(
            candidates.map(async (url) => ({ url, result: await this.fetchRSS(url) })),
        );

        return checks.filter((item) => !item.result.error).map((item) => item.url);
    }

    async detectFeedSources(options = {}) {
        const { auto = false } = options;
        const input = document.getElementById("val1");
        const btn = document.getElementById("detect-feed-btn");
        if (!input || !btn) return;

        const url = String(input.value || "").trim();
        if (!url) {
            if (!auto) this.setFeedDetectStatus("Escribe una URL primero.", true);
            return;
        }

        if (this.feedDetectInProgress) return;
        if (auto && url === this.lastDetectedInputUrl) return;
        if (auto && this.isLikelyFeedUrl(url)) return;

        this.feedDetectInProgress = true;
        this.lastDetectedInputUrl = url;

        btn.disabled = true;
        btn.textContent = "Buscando...";
        if (!auto) {
            this.setFeedDetectStatus("Buscando fuentes RSS/Atom...");
            this.renderFeedCandidates([]);
        }

        try {
            const found = await this.discoverFeedUrls(url);
            if (!found.length) {
                if (!auto) {
                    this.setFeedDetectStatus("No encontré fuentes RSS/Atom en esa URL.", true);
                }
                return;
            }

            this.renderFeedCandidates(found);
            this.setFeedDetectStatus(
                found.length === 1
                    ? "Encontré 1 fuente. Puedes guardar directamente."
                    : `Encontré ${found.length} fuentes. Elige una.`,
            );

            if (found.length === 1) {
                input.value = found[0];
            }
        } catch (error) {
            if (!auto) {
                this.setFeedDetectStatus(`Error al detectar fuentes: ${this.formatErrorMessage(error)}`, true);
            }
        } finally {
            btn.disabled = false;
            btn.textContent = "Buscar fuentes";
            this.feedDetectInProgress = false;
        }
    }

    makeItemKey(link, title) {
        return `${link}::${title}`.toLowerCase();
    }

    parsePublishedTimestamp(value) {
        return this.utils.parsePublishedTimestamp(value);
    }

    async loadAllFeeds(filterCatId = null, options = {}) {
        const { preservePage = false, closeSidebarOnMobile = true } = options;
        if (this.isRefreshingFeeds) return;

        this.isRefreshingFeeds = true;
        this.currentFilterCatId = filterCatId;
        this.allItems = [];
        this.failedFeeds = [];
        if (!preservePage) this.currentPage = 1;

        const container = document.getElementById("feed-container");
        document.getElementById("loader").classList.remove("hidden");
        container.innerHTML = "";
        this.setRefreshStatus("Actualizando...");

        const feeds = filterCatId
            ? this.db.feeds.filter((f) => f.catId === filterCatId)
            : this.db.feeds;
        this.feedDiagnostics = [];

        if (!feeds.length) {
            this.filteredItems = [];
            this.renderPage([]);
            this.updateRetryFailedButton();
            this.setRefreshStatus("Sin feeds configurados");
            this.renderMobileQuickActionsState();
            document.getElementById("loader").classList.add("hidden");
            this.isRefreshingFeeds = false;
            return;
        }

        try {
            const feedResults = await Promise.all(
                feeds.map(async (feed) => {
                    const startedAt = performance.now();
                    const res = await this.fetchRSS(feed.url);
                    const durationMs = Math.round(performance.now() - startedAt);
                    return { feed, res, durationMs };
                }),
            );

            feedResults.forEach(({ feed, res, durationMs }) => {
                if (res.error) {
                    this.failedFeeds.push({ url: feed.url, error: res.error });
                    this.feedDiagnostics.push({
                        url: feed.url,
                        status: "error",
                        error: res.error,
                        itemCount: 0,
                        durationMs,
                        checkedAt: new Date().toISOString(),
                    });
                    return;
                }
                this.allItems.push(...res.items);
                this.feedDiagnostics.push({
                    url: feed.url,
                    status: "ok",
                    error: "",
                    itemCount: res.items.length,
                    durationMs,
                    checkedAt: new Date().toISOString(),
                });
            });

            // Mezcla noticias de todos los feeds por fecha/hora, no por origen.
            this.allItems.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

            if (closeSidebarOnMobile && window.innerWidth < 768) this.toggleSidebar();
            this.applyFilters();

            this.lastRefreshAt = Date.now();
            const loadedFeeds = feeds.length - this.failedFeeds.length;
            const timeLabel = new Date(this.lastRefreshAt).toLocaleTimeString("es-ES", {
                hour: "2-digit",
                minute: "2-digit",
            });
            this.setRefreshStatus(
                `${loadedFeeds}/${feeds.length} feeds · ${this.allItems.length} noticias · ${timeLabel}`,
            );

            if (this.failedFeeds.length) {
                this.showToast(`Se detectaron ${this.failedFeeds.length} feeds con error`, "warn");
            }
            this.updateRetryFailedButton();
            this.renderDiagnosticsIfOpen();
            this.renderMobileQuickActionsState();
        } finally {
            document.getElementById("loader").classList.add("hidden");
            this.isRefreshingFeeds = false;
        }
    }

    applyFilters() {
        let filtered = [...this.allItems];

        const search = document.getElementById("searchInput").value.toLowerCase();
        const sort = document.getElementById("sortSelect").value;

        if (search) {
            filtered = filtered.filter((i) => {
                const ocr = (i.ocrText || "").toLowerCase();
                return (
                    i.title.toLowerCase().includes(search) ||
                    i.description.toLowerCase().includes(search) ||
                    ocr.includes(search)
                );
            });
        }

        if (sort === "az") filtered.sort((a, b) => a.title.localeCompare(b.title));
        if (sort === "za") filtered.sort((a, b) => b.title.localeCompare(a.title));
        if (sort === "desc") filtered.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
        if (sort === "asc") filtered.sort((a, b) => (a.publishedAt || 0) - (b.publishedAt || 0));

        this.filteredItems = filtered;
        this.renderPage(filtered);
    }

    renderPage(items) {
        const container = document.getElementById("feed-container");
        container.innerHTML = "";

        this.renderFeedWarnings(container);

        const start = (this.currentPage - 1) * this.itemsPerPage;
        const pageItems = items.slice(start, start + this.itemsPerPage);

        if (!pageItems.length) {
            const hasSearch = Boolean(document.getElementById("searchInput")?.value?.trim());
            const message = hasSearch
                ? "No hay resultados para la busqueda actual."
                : "No hay noticias disponibles todavia. Agrega feeds para comenzar.";

            container.innerHTML += `
              <div class="md:col-span-2 lg:col-span-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-6 text-center">
                  <h4 class="font-bold text-sm mb-2">Vista vacia</h4>
                  <p class="text-xs text-slate-500 dark:text-slate-300">${message}</p>
              </div>
            `;
            this.renderPagination(items.length);
            return;
        }

        pageItems.forEach((item, idx) => {
            const safeTitle = this.escapeHtml(item.title || "Sin titulo");
            const safeDescription = this.escapeHtml(item.description || "");
            const safeLink = this.safeExternalUrl(item.link) || "#";
            const safeImage = this.safeExternalUrl(item.image);

            const imageFeed = safeImage
                ? `<img src="${safeImage}" loading="lazy" alt="Imagen de la noticia" class="w-full h-full object-cover">`
                : `<div class="w-full h-40 bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-sm text-slate-500">Sin imagen</div>`;

            const encodedTitle = encodeURIComponent(item.title);
            const encodedDescription = encodeURIComponent(item.description);

            const safeId = start + idx;
            const summaryBtnId = `summary-btn-${safeId}`;

            const meta = this.itemMeta[item.key] || {};
            const tagText = meta.tag || "Analizando...";

            if (!meta.tag) {
                this.tagNewsItem(item);
            }

            container.innerHTML += `
              <div class="bg-white dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col hover:shadow-lg transition-shadow">
                  <div class="w-full overflow-hidden bg-slate-100 dark:bg-slate-700">
                      ${imageFeed}
                  </div>

                  <div class="p-5 flex flex-col flex-1">
                      <div class="flex items-center justify-between gap-2 mb-2">
                          <h4 class="font-bold text-slate-800 dark:text-slate-100 text-base">
                              ${safeTitle}
                          </h4>
                          <span class="text-[10px] px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200 whitespace-nowrap">
                              ${this.escapeHtml(tagText)}
                          </span>
                      </div>

                      <p class="text-sm text-slate-500 dark:text-slate-400 mb-4 flex-1">
                          ${safeDescription}
                      </p>

                                            <div class="mt-auto pt-3 flex items-center justify-between gap-3">
                                                <a href="${safeLink}" target="_blank" rel="noopener noreferrer" class="text-blue-600 font-bold text-xs uppercase">
                                                    Ir a la noticia ➔
                                                </a>

                                                <button id="${summaryBtnId}" onclick="summarizeNews('${encodedTitle}','${encodedDescription}','${summaryBtnId}')"
                                                    class="text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap">
                                                    🗒️ Resumir
                                                </button>
                                            </div>
                  </div>
              </div>
            `;
        });

        this.renderPagination(items.length);
    }

    renderFeedWarnings(container) {
        if (!this.failedFeeds.length) return;

        const warnings = this.failedFeeds
            .map(
                (f) =>
                    `<li class="truncate">${this.escapeHtml(f.url)} (${this.escapeHtml(f.error)})</li>`,
            )
            .join("");

        container.innerHTML += `
          <div class="md:col-span-2 lg:col-span-3 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 text-amber-900 dark:text-amber-100">
              <h4 class="font-bold text-sm mb-2">Algunas fuentes no se pudieron cargar</h4>
              <ul class="text-xs space-y-1">${warnings}</ul>
              <div class="mt-3">
                <button onclick="retryFailedFeeds()" class="text-xs font-bold underline">Reintentar ahora</button>
              </div>
          </div>
        `;
    }

    async retryFailedFeeds() {
        if (!this.failedFeeds.length) {
            this.showToast("No hay feeds fallidos para reintentar", "info");
            return;
        }

        this.showToast("Reintentando feeds fallidos...", "info");
        await this.loadAllFeeds(this.currentFilterCatId, { preservePage: true, closeSidebarOnMobile: false });
    }

        renderDiagnosticsIfOpen() {
                const modal = document.getElementById("diagnostics-modal");
                if (modal?.classList.contains("hidden")) return;
                this.renderDiagnosticsModal();
        }

        openDiagnosticsModal() {
                document.getElementById("diagnostics-modal")?.classList.remove("hidden");
                this.renderDiagnosticsModal();
        }

        closeDiagnosticsModal() {
                document.getElementById("diagnostics-modal")?.classList.add("hidden");
        }

        renderDiagnosticsModal() {
                const container = document.getElementById("diagnostics-content");
                if (!container) return;

                if (!this.feedDiagnostics.length) {
                        container.innerHTML =
                                '<p class="text-slate-500 dark:text-slate-300">No hay datos de diagnostico todavia. Ejecuta una carga de feeds.</p>';
                        return;
                }

                const rows = this.feedDiagnostics
                        .map((d) => {
                                const tone = d.status === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-300";
                                const checkedAt = new Date(d.checkedAt).toLocaleTimeString("es-ES", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                        second: "2-digit",
                                });

                                return `
                                    <tr class="border-b border-slate-200 dark:border-slate-700 align-top">
                                        <td class="py-2 pr-2 break-all">${this.escapeHtml(d.url)}</td>
                                        <td class="py-2 pr-2 ${tone}">${this.escapeHtml(d.status)}</td>
                                        <td class="py-2 pr-2">${d.itemCount}</td>
                                        <td class="py-2 pr-2">${d.durationMs} ms</td>
                                        <td class="py-2 pr-2">${this.escapeHtml(d.error || "-")}</td>
                                        <td class="py-2 pr-2 whitespace-nowrap">${checkedAt}</td>
                                    </tr>
                                `;
                        })
                        .join("");

                container.innerHTML = `
                    <table class="w-full text-left text-xs">
                        <thead>
                            <tr class="border-b border-slate-300 dark:border-slate-600">
                                <th class="py-2 pr-2">Feed</th>
                                <th class="py-2 pr-2">Estado</th>
                                <th class="py-2 pr-2">Items</th>
                                <th class="py-2 pr-2">Tiempo</th>
                                <th class="py-2 pr-2">Error</th>
                                <th class="py-2 pr-2">Hora</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
        }

    renderPagination(total) {
        const pages = Math.ceil(total / this.itemsPerPage);
        const container = document.getElementById("pagination");
        container.innerHTML = "";

        for (let i = 1; i <= pages; i++) {
            container.innerHTML += `
              <button onclick="goPage(${i})"
                class="px-3 py-1 rounded-md ${i === this.currentPage ? "bg-blue-600 text-white" : "bg-slate-200 dark:bg-slate-700"}">
                ${i}
              </button>
            `;
        }
    }

    goPage(p) {
        this.currentPage = p;
        this.applyFilters();
    }

    openModal(type, existingData = null) {
        const modal = document.getElementById("modal");
        modal.classList.remove("hidden");
        this.renderMobileQuickActionsState();

        document.getElementById("modal-content").innerHTML =
            type === "cat"
                ? `<input id="val1" type="text" value="${existingData?.name || ""}" placeholder="Nombre" class="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                   <input id="val2" type="color" value="${existingData?.color || "#3b82f6"}" class="w-full h-10 rounded-md">`
                : `<input id="val1" type="text" value="${existingData?.url || ""}" placeholder="URL del sitio o RSS" oninput="handleFeedUrlInputChange()" class="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                   <div class="flex items-center gap-2">
                     <button id="detect-feed-btn" type="button" onclick="detectFeedSources()" class="px-3 py-2 bg-slate-200 dark:bg-slate-700 rounded-md text-xs font-medium">Buscar fuentes</button>
                     <span id="feed-detect-status" class="text-xs text-slate-500"></span>
                   </div>
                   <select id="feed-candidate-select" class="hidden w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-xs" onchange="document.getElementById('val1').value=this.value"></select>
                   <select id="val2" class="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">${this.db.categories
                    .map((c) => `<option value="${c.id}" ${existingData?.catId === c.id ? "selected" : ""}>${c.name}</option>`)
                    .join("")}</select>`;

        if (type === "feed") {
            this.setFeedDetectStatus("");
            this.renderFeedCandidates([]);
        }

        document.getElementById("modal-save").onclick = async () => {
            if (type === "cat") {
                this.db.categories.push({
                    id: "c" + Date.now(),
                    name: document.getElementById("val1").value,
                    color: document.getElementById("val2").value,
                });
            } else {
                let selectedUrl = String(document.getElementById("val1").value || "").trim();
                const candidate = document.getElementById("feed-candidate-select")?.value;
                if (candidate) selectedUrl = candidate;

                if (!selectedUrl) {
                    this.setFeedDetectStatus("Debes indicar una URL.", true);
                    return;
                }

                selectedUrl = this.normalizeUrl(selectedUrl);
                if (!selectedUrl) {
                    this.setFeedDetectStatus("URL invalida.", true);
                    return;
                }

                if (!this.isLikelyFeedUrl(selectedUrl)) {
                    const found = await this.discoverFeedUrls(selectedUrl);
                    if (!found.length) {
                        this.setFeedDetectStatus("No encontré una fuente RSS/Atom para esa URL.", true);
                        return;
                    }

                    if (found.length > 1) {
                        this.renderFeedCandidates(found);
                        this.setFeedDetectStatus("Encontré varias fuentes. Elige una y vuelve a guardar.");
                        return;
                    }

                    selectedUrl = found[0];
                    document.getElementById("val1").value = selectedUrl;
                }

                this.db.feeds.push({
                    id: "f" + Date.now(),
                    url: selectedUrl,
                    catId: document.getElementById("val2").value,
                });
            }

            await this.saveToPuter();
            this.closeModal();
            await this.loadAllFeeds();
        };
    }

    closeModal() {
        document.getElementById("modal").classList.add("hidden");
        this.renderMobileQuickActionsState();

        if (this.reopenManageFeedsAfterModalClose) {
            this.reopenManageFeedsAfterModalClose = false;
            this.openManageFeedsModal();
        }
    }

    // Abre/cierra modal de gestion de fuentes.
    openManageFeedsModal() {
        document.getElementById("manage-feeds-modal")?.classList.remove("hidden");
        this.renderMobileQuickActionsState();
    }

    closeManageFeedsModal() {
        document.getElementById("manage-feeds-modal")?.classList.add("hidden");
        this.renderMobileQuickActionsState();
    }

    // Lanza selector de archivo JSON para importar configuracion.
    triggerConfigImport() {
        const input = document.getElementById("config-import-input");
        if (!input) return;
        input.value = "";
        input.click();
    }

    // Importa un JSON y reemplaza rss_config actual.
    async handleConfigImport(event) {
        try {
            const file = event?.target?.files?.[0];
            if (!file) return;

            const raw = await file.text();
            const imported = JSON.parse(raw);

            if (!imported || typeof imported !== "object") {
                throw new Error("JSON invalido");
            }

            this.db = imported;
            this.ensureConfigSchema();
            await this.saveToPuter();
            await this.loadAllFeeds();

            this.openSummaryModal("Configuracion importada correctamente.");
            this.openManageFeedsModal();
        } catch (error) {
            this.openSummaryModal(`Error al importar JSON: ${this.formatErrorMessage(error)}`);
        }
    }

    // Descarga backup local del archivo rss_config.json.
    createJsonBackup() {
        try {
            const now = new Date();
            const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
            const filename = `rss_config-backup-${stamp}.json`;
            const content = JSON.stringify(this.db, null, 2);

            const blob = new Blob([content], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);

            this.openSummaryModal(`Backup descargado: ${filename}`);
        } catch (error) {
            this.openSummaryModal(`Error al crear backup JSON: ${this.formatErrorMessage(error)}`);
        }
    }

    async toggleDarkMode() {
        this.db.settings.darkMode = !this.db.settings.darkMode;
        this.applyThemePreference();
        await this.saveToPuter();
    }

    // Modal reutilizable para mostrar resultados IA.
    openSummaryModal(content = "") {
        document.getElementById("ai-summary-content").textContent = content;
        document.getElementById("ai-summary-modal").classList.remove("hidden");
    }

    // Abre modal de chat IA con mensaje inicial.
    openAiChatModal() {
        document.getElementById("ai-chat-modal")?.classList.remove("hidden");

        const safeModeCheckbox = document.getElementById("ai-chat-safe-mode");
        if (safeModeCheckbox) safeModeCheckbox.checked = this.aiChatSafeMode;

        if (!this.chatHistory.length) {
            this.chatHistory.push({
                role: "assistant",
                content: "Hola. Puedo responder preguntas sobre tus fuentes y tambien crear categorias o feeds por ti.",
            });
        }

        this.renderAiChatMessages();
        document.getElementById("ai-chat-input")?.focus();
        this.renderMobileQuickActionsState();
    }

    closeAiChatModal() {
        document.getElementById("ai-chat-modal")?.classList.add("hidden");
        this.renderMobileQuickActionsState();
    }

    clearAiChat() {
        this.chatHistory = [
            {
                role: "assistant",
                content: "Chat limpiado. Puedes pedirme crear o borrar categorias y feeds.",
            },
        ];
        this.renderAiChatMessages();
    }

    toggleAiChatSafeMode(enabled) {
        this.aiChatSafeMode = Boolean(enabled);
    }

    renderAiChatMessages() {
        const container = document.getElementById("ai-chat-messages");
        if (!container) return;

        container.innerHTML = this.chatHistory
            .map((m) => {
                const isUser = m.role === "user";
                return `
                  <div class="${isUser ? "text-right" : "text-left"}">
                    <div class="inline-block max-w-[90%] px-3 py-2 rounded-md text-sm ${isUser
                        ? "bg-slate-600 text-white"
                        : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"}">
                      ${this.escapeHtml(m.content)}
                    </div>
                  </div>
                `;
            })
            .join("");

        container.scrollTop = container.scrollHeight;
    }

    escapeHtml(str) {
        return String(str)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    setAiChatLoading(isLoading) {
        const btn = document.getElementById("ai-chat-send-btn");
        const input = document.getElementById("ai-chat-input");
        if (btn) {
            btn.disabled = isLoading;
            btn.textContent = isLoading ? "Pensando..." : "Enviar";
        }
        if (input) {
            input.disabled = isLoading;
        }
    }

    // Extrae bloque JSON de respuesta IA (plain o fenced).
    extractJsonFromText(text) {
        if (!text) return null;

        try {
            return JSON.parse(text);
        } catch {
            // noop
        }

        const fenced = text.match(/```json\s*([\s\S]*?)```/i);
        if (fenced?.[1]) {
            try {
                return JSON.parse(fenced[1]);
            } catch {
                // noop
            }
        }

        const first = text.indexOf("{");
        const last = text.lastIndexOf("}");
        if (first >= 0 && last > first) {
            try {
                return JSON.parse(text.slice(first, last + 1));
            } catch {
                return null;
            }
        }

        return null;
    }

    async sendAiChatMessage() {
        const input = document.getElementById("ai-chat-input");
        const userText = input?.value?.trim();
        if (!userText) return;

        this.chatHistory.push({ role: "user", content: userText });
        this.renderAiChatMessages();
        if (input) input.value = "";

        this.setAiChatLoading(true);
        try {
            const context = {
                categories: this.db.categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
                feeds: this.db.feeds.map((f) => ({ id: f.id, url: f.url, catId: f.catId })),
            };

            const prompt = `Eres un asistente de una app RSS. Responde SIEMPRE en JSON con este formato exacto:\n{\n  "reply": "texto para el usuario",\n  "actions": [\n    {"type":"add_category","name":"...","color":"#rrggbb"},\n    {"type":"add_feed","url":"https://...","categoryName":"..."},\n    {"type":"delete_category","name":"..."},\n    {"type":"delete_feed","url":"https://..."}\n  ]\n}\n\nSi no hay acciones, devuelve "actions": [].\n\nEstado actual:\n${JSON.stringify(context)}\n\nPeticion del usuario:\n${userText}`;

            const res = await puter.ai.chat(prompt, {
                model: "gpt-4o-mini",
                max_tokens: 400,
            });

            const text = this.extractSummaryText(res) || "";
            const parsed = this.extractJsonFromText(text);

            if (!parsed || typeof parsed !== "object") {
                this.chatHistory.push({
                    role: "assistant",
                    content: "No pude interpretar la respuesta en JSON. Intenta reformular tu solicitud.",
                });
                this.renderAiChatMessages();
                return;
            }

            const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
            const applied = await this.applyChatActions(actions);

            const baseReply = parsed.reply || "Listo.";
            const detail = applied.length ? `\n\nAcciones ejecutadas:\n- ${applied.join("\n- ")}` : "";

            this.chatHistory.push({ role: "assistant", content: `${baseReply}${detail}` });
            this.renderAiChatMessages();
        } catch (error) {
            this.chatHistory.push({
                role: "assistant",
                content: `Error: ${this.formatErrorMessage(error)}`,
            });
            this.renderAiChatMessages();
        } finally {
            this.setAiChatLoading(false);
            document.getElementById("ai-chat-input")?.focus();
        }
    }

    async applyChatActions(actions) {
        const changes = [];
        if (!actions.length) return changes;

        if (this.aiChatSafeMode) {
            const preview = actions
                .map((a, idx) => `${idx + 1}. ${a.type} ${a.name || a.url || ""}`)
                .join("\n");
            const approved = window.confirm(
                `La IA propone estas acciones:\n\n${preview}\n\n¿Deseas ejecutarlas?`,
            );
            if (!approved) {
                return ["Acciones canceladas por el usuario"];
            }
        }

        for (const action of actions) {
            if (action?.type === "add_category") {
                const name = String(action.name || "").trim();
                if (!name) continue;

                const exists = this.db.categories.some(
                    (c) => c.name.toLowerCase() === name.toLowerCase(),
                );
                if (exists) {
                    changes.push(`Categoria existente: ${name}`);
                    continue;
                }

                const color = /^#[0-9a-fA-F]{6}$/.test(action.color || "")
                    ? action.color
                    : "#3b82f6";

                this.db.categories.push({
                    id: "c" + Date.now() + Math.floor(Math.random() * 1000),
                    name,
                    color,
                });
                changes.push(`Categoria creada: ${name}`);
                continue;
            }

            if (action?.type === "add_feed") {
                const url = String(action.url || "").trim();
                const categoryName = String(action.categoryName || "").trim();
                if (!url) continue;

                const exists = this.db.feeds.some((f) => f.url.toLowerCase() === url.toLowerCase());
                if (exists) {
                    changes.push(`Feed existente: ${url}`);
                    continue;
                }

                let category = this.db.categories.find(
                    (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
                );

                if (!category) {
                    category = {
                        id: "c" + Date.now() + Math.floor(Math.random() * 1000),
                        name: categoryName || "General",
                        color: "#3b82f6",
                    };
                    this.db.categories.push(category);
                    changes.push(`Categoria creada: ${category.name}`);
                }

                this.db.feeds.push({
                    id: "f" + Date.now() + Math.floor(Math.random() * 1000),
                    url,
                    catId: category.id,
                });
                changes.push(`Feed agregado: ${url}`);
                continue;
            }

            if (action?.type === "delete_category") {
                const name = String(action.name || "").trim();
                if (!name) continue;

                const category = this.db.categories.find(
                    (c) => c.name.toLowerCase() === name.toLowerCase(),
                );
                if (!category) {
                    changes.push(`Categoria no encontrada: ${name}`);
                    continue;
                }

                this.db.categories = this.db.categories.filter((c) => c.id !== category.id);
                this.db.feeds = this.db.feeds.filter((f) => f.catId !== category.id);
                changes.push(`Categoria eliminada: ${name} (y sus feeds)`);
                continue;
            }

            if (action?.type === "delete_feed") {
                const url = String(action.url || "").trim();
                if (!url) continue;

                const before = this.db.feeds.length;
                this.db.feeds = this.db.feeds.filter((f) => f.url.toLowerCase() !== url.toLowerCase());
                if (this.db.feeds.length === before) {
                    changes.push(`Feed no encontrado: ${url}`);
                } else {
                    changes.push(`Feed eliminado: ${url}`);
                }
            }
        }

        if (changes.length) {
            await this.saveToPuter();
            await this.loadAllFeeds();
            this.openManageFeedsModal();
        }

        return changes;
    }

    closeSummaryModal() {
        document.getElementById("ai-summary-modal").classList.add("hidden");
    }

    setSummaryLoader(isLoading) {
        const loader = document.getElementById("ai-summary-loader");
        if (!loader) return;
        loader.classList.toggle("hidden", !isLoading);
    }

    setButtonLoading(buttonId, isLoading, idleText, loadingText) {
        if (!buttonId) return;
        const button = document.getElementById(buttonId);
        if (!button) return;

        button.disabled = isLoading;
        button.textContent = isLoading ? loadingText : idleText;
    }

    extractSummaryText(res) {
        if (!res) return "";
        if (typeof res === "string") return res;
        if (typeof res?.text === "string") return res.text;
        if (typeof res?.output_text === "string") return res.output_text;

        const content = res?.message?.content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
            return content
                .map((part) => {
                    if (typeof part === "string") return part;
                    if (typeof part?.text === "string") return part.text;
                    return "";
                })
                .filter(Boolean)
                .join("\n");
        }

        const choiceContent = res?.choices?.[0]?.message?.content;
        if (typeof choiceContent === "string") return choiceContent;

        return "";
    }

    formatErrorMessage(error) {
        if (!error) return "Error desconocido";
        if (typeof error === "string") return error;
        if (typeof error?.message === "string") return error.message;
        if (typeof error?.error?.message === "string") return error.error.message;
        try {
            return JSON.stringify(error);
        } catch {
            return "Error no legible";
        }
    }

    async requestSummary(prompt) {
        const attempts = [
            { model: "gpt-5-nano", max_tokens: 300, reasoning_effort: "none", text_verbosity: "low" },
            { model: "gpt-4o-mini", max_tokens: 220 },
        ];

        let lastResponse = null;
        for (const options of attempts) {
            const res = await puter.ai.chat(prompt, options);
            lastResponse = res;
            const summary = this.extractSummaryText(res);
            if (summary) return { summary, response: res };
        }

        return { summary: "", response: lastResponse };
    }

    // 1) Resumen de noticia.
    async summarizeNews(encodedTitle, encodedDescription, buttonId = null) {
        if (this.isSummarizing) return;

        const title = decodeURIComponent(encodedTitle || "");
        const description = decodeURIComponent(encodedDescription || "");
        if (!title && !description) {
            this.openSummaryModal("No hay contenido para resumir.");
            return;
        }

        this.isSummarizing = true;
        this.setButtonLoading(buttonId, true, "Resumir", "Resumiendo...");
        this.setSummaryLoader(true);
        this.openSummaryModal("Generando resumen...");

        try {
            const prompt = `Devuelve solo el resumen final en espanol, entre 4 y 5 lineas, maximo 90 palabras.\\n\\nTitulo: ${title}\\n\\nContenido: ${description}`;
            const { summary, response } = await this.requestSummary(prompt);

            if (!summary) {
                const payloadPreview = JSON.stringify(response, null, 2).slice(0, 900);
                this.openSummaryModal("No se pudo extraer texto del modelo. Respuesta recibida:\n\n" + payloadPreview);
                return;
            }

            this.openSummaryModal(summary);
        } catch (error) {
            this.openSummaryModal(`Error al resumir: ${this.formatErrorMessage(error)}`);
        } finally {
            this.isSummarizing = false;
            this.setSummaryLoader(false);
            this.setButtonLoading(buttonId, false, "Resumir", "Resumiendo...");
        }
    }

    // 2) Lectura en voz alta con txt2speech.
    async speakNews(encodedTitle, encodedDescription, buttonId = null) {
        const title = decodeURIComponent(encodedTitle || "");
        const description = decodeURIComponent(encodedDescription || "");
        const text = `${title}. ${description}`.slice(0, 2800);

        this.setButtonLoading(buttonId, true, "Escuchar", "Cargando audio...");
        try {
            if (this.activeAudio) {
                this.activeAudio.pause();
                this.activeAudio = null;
            }

            const audio = await puter.ai.txt2speech(text, {
                provider: "openai",
                model: "gpt-4o-mini-tts",
                voice: "alloy",
            });

            this.activeAudio = audio;
            await audio.play();
        } catch (error) {
            this.openSummaryModal(`Error de audio: ${this.formatErrorMessage(error)}`);
        } finally {
            this.setButtonLoading(buttonId, false, "Escuchar", "Cargando audio...");
        }
    }

    // 3) Busqueda por voz con speech2txt.
    async toggleVoiceSearch() {
        if (this.isVoiceRecording) {
            this.stopVoiceRecording();
            return;
        }
        await this.startVoiceRecording();
    }

    setVoiceSearchButton(isRecording) {
        const btn = document.getElementById("voice-search-btn");
        if (!btn) return;
        btn.textContent = isRecording ? "Detener voz" : "Buscar por voz";
        btn.classList.toggle("bg-red-100", isRecording);
        btn.classList.toggle("text-red-700", isRecording);
    }

    async startVoiceRecording() {
        if (!navigator.mediaDevices?.getUserMedia) {
            this.openSummaryModal("Tu navegador no soporta grabacion de audio.");
            return;
        }

        try {
            this.voiceChunks = [];
            this.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(this.voiceStream);

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data?.size) this.voiceChunks.push(event.data);
            };

            this.mediaRecorder.onstop = async () => {
                try {
                    const blob = new Blob(this.voiceChunks, { type: "audio/webm" });
                    this.setSummaryLoader(true);
                    this.openSummaryModal("Transcribiendo audio...");

                    const result = await puter.ai.speech2txt(blob, {
                        model: "gpt-4o-mini-transcribe",
                        response_format: "text",
                    });

                    const text = typeof result === "string" ? result : result?.text || "";
                    document.getElementById("searchInput").value = text.trim();
                    this.applyFilters();

                    this.openSummaryModal(`Busqueda por voz aplicada:\n\n${text || "Sin texto detectado."}`);
                } catch (error) {
                    this.openSummaryModal(`Error de voz: ${this.formatErrorMessage(error)}`);
                } finally {
                    this.setSummaryLoader(false);
                    this.cleanupVoiceRecorder();
                }
            };

            this.mediaRecorder.start();
            this.isVoiceRecording = true;
            this.setVoiceSearchButton(true);
        } catch (error) {
            this.openSummaryModal(`No se pudo iniciar microfono: ${this.formatErrorMessage(error)}`);
            this.cleanupVoiceRecorder();
        }
    }

    stopVoiceRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            this.mediaRecorder.stop();
        }
        this.isVoiceRecording = false;
        this.setVoiceSearchButton(false);
    }

    cleanupVoiceRecorder() {
        if (this.voiceStream) {
            this.voiceStream.getTracks().forEach((track) => track.stop());
        }
        this.voiceStream = null;
        this.mediaRecorder = null;
        this.voiceChunks = [];
        this.isVoiceRecording = false;
        this.setVoiceSearchButton(false);
    }

    // 4) Etiquetado inteligente automatico.
    async tagNewsItem(item) {
        if (!item?.key || this.pendingTags.has(item.key) || this.itemMeta[item.key]?.tag) {
            return;
        }

        this.pendingTags.add(item.key);
        try {
            const prompt = `Clasifica esta noticia en una sola etiqueta corta entre: tecnologia, finanzas, deportes, politica, salud, ciencia, entretenimiento, negocios, otro.\\n\\nTitulo: ${item.title}\\nDescripcion: ${item.description}`;
            const res = await puter.ai.chat(prompt, {
                model: "gpt-4o-mini",
                max_tokens: 12,
            });

            const raw = (this.extractSummaryText(res) || "otro").toLowerCase();
            const allowed = ["tecnologia", "finanzas", "deportes", "politica", "salud", "ciencia", "entretenimiento", "negocios", "otro"];
            const tag = allowed.find((t) => raw.includes(t)) || "otro";

            this.itemMeta[item.key] = { ...(this.itemMeta[item.key] || {}), tag };
            this.applyFilters();
        } catch {
            this.itemMeta[item.key] = { ...(this.itemMeta[item.key] || {}), tag: "otro" };
        } finally {
            this.pendingTags.delete(item.key);
        }
    }

    // 5) Traduccion de titulo y descripcion bajo demanda.
    async translateNews(encodedTitle, encodedDescription, buttonId = null) {
        const title = decodeURIComponent(encodedTitle || "");
        const description = decodeURIComponent(encodedDescription || "");
        const lang = navigator.language || "es-ES";

        this.setButtonLoading(buttonId, true, "Traducir", "Traduciendo...");
        this.setSummaryLoader(true);
        this.openSummaryModal("Traduciendo contenido...");

        try {
            const prompt = `Traduce el siguiente contenido al idioma ${lang}. Devuelve dos secciones: TITULO y DESCRIPCION.\\n\\nTitulo: ${title}\\nDescripcion: ${description}`;
            const res = await puter.ai.chat(prompt, {
                model: "gpt-4o-mini",
                max_tokens: 260,
            });

            const translated = this.extractSummaryText(res) || "No se pudo traducir.";
            this.openSummaryModal(translated);
        } catch (error) {
            this.openSummaryModal(`Error de traduccion: ${this.formatErrorMessage(error)}`);
        } finally {
            this.setSummaryLoader(false);
            this.setButtonLoading(buttonId, false, "Traducir", "Traduciendo...");
        }
    }

    // 6) OCR de imagen y agregado al indice de busqueda.
    async ocrFromImage(encodedImage, encodedLink, buttonId = null) {
        const imageUrl = decodeURIComponent(encodedImage || "");
        const link = decodeURIComponent(encodedLink || "");

        if (!imageUrl) {
            this.openSummaryModal("Esta noticia no tiene imagen para OCR.");
            return;
        }

        this.setButtonLoading(buttonId, true, "OCR Imagen", "Leyendo imagen...");
        this.setSummaryLoader(true);
        this.openSummaryModal("Extrayendo texto de la imagen...");

        try {
            const ocrText = await puter.ai.img2txt(imageUrl, {
                provider: "aws-textract",
            });

            const item = this.allItems.find((i) => i.link === link);
            if (item) item.ocrText = (ocrText || "").slice(0, 2500);

            this.openSummaryModal(ocrText || "No se detecto texto en la imagen.");
        } catch (error) {
            this.openSummaryModal(`Error OCR: ${this.formatErrorMessage(error)}`);
        } finally {
            this.setSummaryLoader(false);
            this.setButtonLoading(buttonId, false, "OCR Imagen", "Leyendo imagen...");
        }
    }

    // 8) Backup de configuracion en nube del usuario.
    async createBackup() {
        try {
            await puter.fs.mkdir({ path: this.BACKUP_DIR, createMissingParents: true, overwrite: true }).catch(() => null);

            const now = new Date();
            const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
            const backupName = `appfeed-backup-${stamp}.json`;

            await puter.fs.copy({
                source: this.CONFIG_PATH,
                destination: this.BACKUP_DIR,
                newName: backupName,
            });

            this.openSummaryModal(`Backup creado: ${backupName}`);
        } catch (error) {
            this.openSummaryModal(`Error al crear backup: ${this.formatErrorMessage(error)}`);
        }
    }

    async restoreBackup() {
        try {
            const items = await puter.fs.readdir(this.BACKUP_DIR);
            const backups = (items || [])
                .map((it) => it.name)
                .filter((name) => name.startsWith("appfeed-backup-") && name.endsWith(".json"))
                .sort()
                .reverse();

            if (!backups.length) {
                this.openSummaryModal("No hay backups disponibles para restaurar.");
                return;
            }

            const latest = backups[0];
            await puter.fs.copy({
                source: `${this.BACKUP_DIR}/${latest}`,
                destination: this.CONFIG_PATH,
                overwrite: true,
            });

            await this.init();
            this.openSummaryModal(`Backup restaurado: ${latest}`);
        } catch (error) {
            this.openSummaryModal(`Error al restaurar backup: ${this.formatErrorMessage(error)}`);
        }
    }

    // 9) Metricas de consumo mensual.
    async showUsageMetrics() {
        try {
            const usage = await puter.auth.getMonthlyUsage();
            this.openSummaryModal(JSON.stringify(usage, null, 2));
        } catch (error) {
            this.openSummaryModal(`Error de consumo: ${this.formatErrorMessage(error)}`);
        }
    }

    // 10) Registro de app en Puter.
    async registerPuterApp() {
        try {
            const suggested = `appfeed-${Date.now()}`;
            const name = window.prompt("Nombre unico para registrar la app en Puter:", suggested);
            if (!name) return;

            const indexURL = window.location.href;
            const created = await puter.apps.create({
                name,
                title: "AppFeed RSS",
                description: "Lector RSS con funciones IA sobre Puter.js",
                indexURL,
            });

            this.openSummaryModal(`App registrada correctamente:\n\n${JSON.stringify(created, null, 2)}`);
        } catch (error) {
            this.openSummaryModal(`Error al registrar app: ${this.formatErrorMessage(error)}`);
        }
    }

    deleteCategory(id) {
        this.db.categories = this.db.categories.filter((c) => c.id !== id);
        this.saveToPuter();
    }

    async deleteFeed(id) {
        this.db.feeds = this.db.feeds.filter((f) => f.id !== id);
        await this.saveToPuter();
        await this.loadAllFeeds();
    }

    editFeed(id) {
        this.reopenManageFeedsAfterModalClose = true;
        this.closeManageFeedsModal();
        this.openModal("feed", this.db.feeds.find((f) => f.id === id));
    }
}

const app = new AppFeed();

window.toggleSidebar = () => app.toggleSidebar();
window.openModal = (type, existingData = null) => app.openModal(type, existingData);
window.closeModal = () => app.closeModal();
window.toggleDarkMode = () => app.toggleDarkMode();
window.applyFilters = () => app.applyFilters();
window.loadAllFeeds = (filterCatId = null) => app.loadAllFeeds(filterCatId);
window.setRefreshInterval = (valueMs) => app.setRefreshInterval(valueMs);
window.setAutoRefreshEnabled = (enabled) => app.setAutoRefreshEnabled(enabled);
window.setLayoutDensity = (value) => app.setLayoutDensity(value);
window.detectFeedSources = () => app.detectFeedSources();
window.handleFeedUrlInputChange = () => app.handleFeedUrlInputChange();
window.deleteCategory = (id) => app.deleteCategory(id);
window.deleteFeed = (id) => app.deleteFeed(id);
window.editFeed = (id) => app.editFeed(id);
window.goPage = (p) => app.goPage(p);

window.summarizeNews = (encodedTitle, encodedDescription, buttonId = null) =>
    app.summarizeNews(encodedTitle, encodedDescription, buttonId);
window.closeSummaryModal = () => app.closeSummaryModal();
window.openAiChatModal = () => app.openAiChatModal();
window.closeAiChatModal = () => app.closeAiChatModal();
window.sendAiChatMessage = () => app.sendAiChatMessage();
window.clearAiChat = () => app.clearAiChat();
window.toggleAiChatSafeMode = (enabled) => app.toggleAiChatSafeMode(enabled);
window.openManageFeedsModal = () => app.openManageFeedsModal();
window.closeManageFeedsModal = () => app.closeManageFeedsModal();
window.triggerConfigImport = () => app.triggerConfigImport();
window.handleConfigImport = (event) => app.handleConfigImport(event);
window.createJsonBackup = () => app.createJsonBackup();
window.retryFailedFeeds = () => app.retryFailedFeeds();
window.openDiagnosticsModal = () => app.openDiagnosticsModal();
window.closeDiagnosticsModal = () => app.closeDiagnosticsModal();
window.focusSearchInput = () => app.focusSearchInput();

window.signInUser = () => app.signInUser();
window.signOutUser = () => app.signOutUser();

async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    try {
        await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
        console.warn("No se pudo registrar el Service Worker:", error);
    }
}

registerServiceWorker();
app.init();
