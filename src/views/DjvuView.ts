/**
 * DjVu Document Viewer Component
 * 
 * This module provides the main view for rendering DjVu documents within Obsidian.
 * It uses an isolated iframe to run the DjVu.js library, communicating via postMessage.
 * 
 * Features:
 * - Full DjVu document rendering with zoom and navigation
 * - Page position persistence (remembers last viewed page)
 * - Deep linking support via #page=X fragments
 * - Text selection with context menu (copy, quote, link)
 * - Text highlighting when opening links with encoded quotes
 * 
 * @module views/DjvuView
 */

import { FileView, Menu, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type DjVuReaderPlugin from "../main";
import { getDjvuLibraryResourcePath } from "../djvu/loadDjvuLibrary";
import { getDjvuViewerLibraryResourcePath } from "../djvu/loadDjvuViewerLibrary";

/** Unique identifier for registering this view type with Obsidian */
export const VIEW_TYPE_DJVU = "djvu-reader";

/**
 * Custom FileView for displaying DjVu documents.
 * 
 * Architecture:
 * - Uses an iframe to isolate the DjVu.js viewer from Obsidian's DOM
 * - Communicates with the iframe via window.postMessage
 * - Handles lifecycle events (open, close, file load/unload)
 * 
 * Message Protocol (parent ↔ iframe):
 * - DJVU_READY: Iframe signals it's initialized and ready
 * - LOAD_DJVU: Parent sends document buffer to load
 * - DJVU_LOADED: Iframe confirms document loaded successfully
 * - DJVU_ERROR: Iframe reports an error
 * - DJVU_PAGE_CHANGED: Iframe reports page navigation
 * - DJVU_CONTEXT_MENU: Iframe requests context menu for selection
 * - DJVU_CLICK: Iframe reports a click (used to dismiss menus)
 */
export class DjvuView extends FileView {
	/** Reference to the main plugin for accessing settings and methods */
	private plugin: DjVuReaderPlugin;
	
	/** The iframe element containing the DjVu viewer */
	private iframeEl: HTMLIFrameElement | null = null;
	
	/** Bound message handler for cleanup */
	private messageHandler: ((evt: MessageEvent) => void) | null = null;
	
	/** Sequence number to track render operations and ignore stale responses */
	private renderSeq = 0;
	
	/** Promise resolver for waiting on iframe initialization */
	private initWait: { seq: number; resolve: () => void; reject: (err: Error) => void; timeout: number } | null = null;
	
	/** Page number to navigate to (from link fragment #page=X) */
	private pendingPage: number | null = null;
	
	/** Text to highlight after load (from link fragment #q=encoded) */
	private pendingHighlight: string | null = null;
	
	/** Currently visible context menu (for cleanup) */
	private activeMenu: Menu | null = null;

	/**
	 * Creates a new DjVu view instance.
	 * 
	 * @param leaf - The workspace leaf this view belongs to
	 * @param plugin - The main plugin instance
	 */
	constructor(leaf: WorkspaceLeaf, plugin: DjVuReaderPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	/**
	 * Called when the view is first opened.
	 * Sets up the container CSS class for styling.
	 */
	async onOpen(): Promise<void> {
		this.contentEl.addClass("djvu-view-container");
	}

	/**
	 * Returns the unique view type identifier.
	 * Used by Obsidian to match this view with registered extensions.
	 */
	getViewType(): string {
		return VIEW_TYPE_DJVU;
	}

	/**
	 * Returns the display text shown in the tab header.
	 * Shows the filename without extension, or "DjVu" if no file.
	 */
	getDisplayText(): string {
		return this.file?.basename ?? "DjVu";
	}

	/**
	 * Returns the icon identifier for the tab.
	 */
	getIcon(): string {
		return "file";
	}

	/**
	 * Handles ephemeral state from Obsidian links.
	 * Parses the subpath fragment to extract page number and highlight text.
	 * 
	 * Supported fragment formats:
	 * - #page=5 - Opens to page 5
	 * - #page=5&q=base64text - Opens to page 5 and highlights decoded text
	 * 
	 * @param state - The ephemeral state object containing subpath
	 */
	setEphemeralState(state: Record<string, unknown>): void {
		const subpath = typeof state.subpath === "string" ? state.subpath : "";
		
		// Extract page number from #page=X
		const pageMatch = subpath.match(/page=(\d+)/);
		const page = pageMatch?.[1] ? parseInt(pageMatch[1], 10) : null;
		
		// Extract highlight text from #q=encoded
		const qMatch = subpath.match(/q=([^&]+)/);
		const highlight = qMatch?.[1] ? decodeURIComponent(qMatch[1]) : null;
		
		if (page !== null) {
			this.pendingPage = page;
		}
		if (highlight !== null) {
			try {
				// UTF-8 safe base64 decoding: handles non-ASCII characters
				// Decode: base64 → escaped string → UTF-8 string
				this.pendingHighlight = decodeURIComponent(escape(atob(highlight)));
			} catch {
				this.pendingHighlight = null;
			}
		}
		super.setEphemeralState(state);
	}

	/**
	 * Called when a DjVu file is loaded into the view.
	 * Determines the page to open (from link, saved position, or page 1).
	 * 
	 * @param file - The DjVu file to load
	 */
	async onLoadFile(file: TFile): Promise<void> {
		// Get saved page position for this file
		const savedPage = this.plugin.getFilePage(file.path);
		
		// Priority: link fragment > saved position > page 1
		const page = this.pendingPage ?? savedPage;
		const highlight = this.pendingHighlight;
		
		// Clear pending state
		this.pendingPage = null;
		this.pendingHighlight = null;
		
		void this.render(file, page, highlight);
	}

	/**
	 * Called when the current file is being unloaded.
	 * Cleans up resources before loading a new file.
	 */
	async onUnloadFile(_file: TFile): Promise<void> {
		this.cleanup();
	}

	/**
	 * Called when the view is being closed.
	 * Performs final cleanup and removes CSS classes.
	 */
	async onClose(): Promise<void> {
		this.cleanup();
		this.contentEl.removeClass("djvu-view-container");
		await super.onClose();
	}

	/**
	 * Cleans up all resources: event listeners, timers, and DOM elements.
	 * Safe to call multiple times.
	 */
	private cleanup(): void {
		// Remove message listener
		if (this.messageHandler) {
			window.removeEventListener("message", this.messageHandler);
			this.messageHandler = null;
		}
		
		// Clear initialization timeout
		if (this.initWait) {
			window.clearTimeout(this.initWait.timeout);
			this.initWait = null;
		}
		
		// Clear iframe reference and DOM
		this.iframeEl = null;
		this.contentEl.empty();
	}

	/**
	 * Displays an error message in the view.
	 * 
	 * @param message - The error message to display
	 */
	private showError(message: string): void {
		this.contentEl.empty();
		this.contentEl.createDiv({ cls: "djvu-viewer" }).createDiv({ cls: "djvu-viewer__error", text: message });
	}

	/**
	 * Main render method - sets up the iframe and loads the DjVu document.
	 * 
	 * Flow:
	 * 1. Validate file and extension
	 * 2. Create iframe with embedded DjVu viewer
	 * 3. Wait for viewer to signal ready (DJVU_READY)
	 * 4. Send document buffer to iframe (LOAD_DJVU)
	 * 5. Apply optional page navigation and text highlighting
	 * 
	 * @param file - The DjVu file to render
	 * @param page - Optional page number to navigate to
	 * @param highlight - Optional text to highlight on the page
	 */
	private async render(file: TFile, page: number | null, highlight?: string | null): Promise<void> {
		// Validate we have a file
		file = file ?? this.file ?? undefined;
		if (!file) {
			this.showError("No file.");
			return;
		}
		
		// Validate file extension
		const ext = file.extension.toLowerCase();
		if (ext !== "djvu" && ext !== "djv") {
			this.showError("Not a DjVu file.");
			return;
		}

		// Increment sequence to invalidate any pending operations
		const seq = ++this.renderSeq;
		this.cleanup();
		this.contentEl.empty();

		// Create viewer container structure
		const root = this.contentEl.createDiv({ cls: "djvu-viewer" });
		const statusEl = root.createDiv({ cls: "djvu-viewer__status", text: "Loading DjVu…" });
		const hostEl = root.createDiv({ cls: "djvu-viewer__host" });

		try {
			// Start loading file binary in background
			const bufferPromise = this.app.vault.readBinary(file);
			
			// Get paths to vendor libraries
			const djvuJs = getDjvuLibraryResourcePath(this.plugin);
			const viewerJs = getDjvuViewerLibraryResourcePath(this.plugin);

			// Create isolated iframe for the viewer
			const iframe = document.createElement("iframe");
			iframe.className = "djvu-viewer__frame";
			iframe.setAttribute("referrerpolicy", "no-referrer");
			iframe.srcdoc = this.buildIframeSrcdoc(djvuJs, viewerJs);
			hostEl.appendChild(iframe);
			this.iframeEl = iframe;

			// Set up message handler for iframe communication
			this.messageHandler = (evt: MessageEvent) => {
				// Ignore messages from other sources
				if (evt.source !== iframe.contentWindow) return;
				const data = evt.data;
				if (!data?.type) return;

				// Handle different message types from iframe
				if (data.type === "DJVU_READY" && this.initWait?.seq === seq) {
					// Viewer initialized successfully
					window.clearTimeout(this.initWait.timeout);
					this.initWait.resolve();
					this.initWait = null;
				} else if (data.type === "DJVU_ERROR" && this.initWait?.seq === seq) {
					// Viewer encountered an error
					window.clearTimeout(this.initWait.timeout);
					this.initWait.reject(new Error(data.message || "DjVu viewer error"));
					this.initWait = null;
				} else if (data.type === "DJVU_CONTEXT_MENU") {
					// User right-clicked with text selected
					const text = (typeof data.text === "string" ? data.text : "").trim();
					const page = typeof data.page === "number" ? data.page : 1;
					this.showSelectionContextMenu(text, page, data.x ?? 0, data.y ?? 0);
				} else if (data.type === "DJVU_PAGE_CHANGED" && typeof data.page === "number") {
					// User navigated to a different page - save position
					if (file) {
						void this.plugin.setFilePage(file.path, data.page);
					}
				} else if (data.type === "DJVU_CLICK") {
					// User clicked in iframe - dismiss any open context menu
					if (this.activeMenu) {
						this.activeMenu.hide();
						this.activeMenu = null;
					}
				}
			};
			window.addEventListener("message", this.messageHandler);

			// Wait for iframe to signal ready (with 15s timeout)
			await new Promise<void>((resolve, reject) => {
				const timeout = window.setTimeout(() => {
					if (this.initWait?.seq === seq) {
						this.initWait = null;
						reject(new Error("Timed out initializing DjVu viewer."));
					}
				}, 15000);
				this.initWait = { seq, resolve, reject, timeout };
			});

			// Get the file buffer (should be ready by now)
			const buffer = await bufferPromise;
			
			// Check if this render is still current
			if (seq !== this.renderSeq) return;

			// Small delay to allow setEphemeralState to set pendingPage
			// (handles race condition with link navigation)
			await new Promise(resolve => setTimeout(resolve, 50));
			
			// Determine final page and highlight values
			const finalPage = this.pendingPage ?? page;
			const finalHighlight = this.pendingHighlight ?? highlight ?? null;
			this.pendingPage = null;
			this.pendingHighlight = null;
			
			// Send document to iframe for rendering
			// Transfer buffer ownership for efficiency
			iframe.contentWindow?.postMessage({ type: "LOAD_DJVU", buffer, name: file.name, page: finalPage, highlight: finalHighlight }, "*", [buffer]);
			statusEl.setText("");
		} catch (err) {
			// Display error in view and show notice
			const message = err instanceof Error ? err.message : String(err);
			this.showError(`Failed to open DjVu: ${message}`);
			new Notice(`DjVu reader: ${message}`);
		}
	}

	/**
	 * Shows a context menu for text selection with copy options.
	 * 
	 * Menu items:
	 * - Copy: Plain text copy
	 * - Copy as quote: Markdown blockquote with link
	 * - Copy link to selection: Obsidian link with page and encoded text
	 * 
	 * Link format: [[file.djvu#page=X&q=base64|file.djvu (page X)]]
	 * 
	 * @param text - The selected text
	 * @param page - The current page number
	 * @param x - X coordinate relative to iframe
	 * @param y - Y coordinate relative to iframe
	 */
	private showSelectionContextMenu(text: string, page: number, x: number, y: number): void {
		if (!this.file || !this.iframeEl || !text) return;

		// Convert iframe-relative coordinates to window coordinates
		const rect = this.iframeEl.getBoundingClientRect();
		
		// UTF-8 safe base64 encoding for the link
		// Encode: UTF-8 string → escaped string → base64 → URL-encoded
		const encodedText = encodeURIComponent(btoa(unescape(encodeURIComponent(text))));
		
		// Build Obsidian link with page and encoded highlight text
		const linkWithHighlight = `[[${this.file.path}#page=${page}&q=${encodedText}|${this.file.name} (page ${page})]]`;
		
		// Build blockquote with link attribution
		const quoteLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((l) => `> ${l}`.trimEnd());
		const quote = quoteLines.join("\n") + "\n\n" + linkWithHighlight;

		// Hide any existing menu
		if (this.activeMenu) {
			this.activeMenu.hide();
		}

		// Create and show context menu
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Copy").onClick(() => void navigator.clipboard.writeText(text)));
		menu.addItem((item) => item.setTitle("Copy as quote").onClick(() => void navigator.clipboard.writeText(quote)));
		menu.addItem((item) => item.setTitle("Copy link to selection").onClick(() => void navigator.clipboard.writeText(linkWithHighlight)));
		this.activeMenu = menu;
		menu.showAtPosition({ x: rect.left + x, y: rect.top + y });
	}

	/**
	 * Builds the complete HTML document for the iframe.
	 * 
	 * The iframe contains:
	 * - DjVu.js core library for document parsing
	 * - DjVu.js viewer library for UI rendering
	 * - Custom JavaScript for:
	 *   - Page change tracking (1s polling interval)
	 *   - Text highlighting functionality
	 *   - Context menu handling
	 *   - Parent-iframe communication
	 * 
	 * @param djvuJs - Resource URL for djvu.js
	 * @param viewerJs - Resource URL for djvu_viewer.js
	 * @returns Complete HTML document as string
	 */
	private buildIframeSrcdoc(djvuJs: string, viewerJs: string): string {
		return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    /* Full viewport viewer */
    html, body { margin: 0; padding: 0; height: 100%; width: 100%; }
    #app { height: 100%; width: 100%; }
    /* Yellow highlight style for search matches */
    .djvu-highlight { background-color: #ffeb3b !important; color: #000 !important; }
  </style>
</head>
<body>
  <div id="app"></div>
  <!-- Load DjVu libraries -->
  <script src="${djvuJs}"></script>
  <script src="${viewerJs}"></script>
  <script>
  (function(){
    /**
     * Send a message to the parent window (Obsidian).
     * @param {string} type - Message type identifier
     * @param {object} payload - Optional data to include
     */
    function post(type, payload) { parent.postMessage(Object.assign({ type: type }, payload || {}), '*'); }
    
    // Initialize DjVu viewer
    var viewer = new DjVu.Viewer();
    viewer.render(document.getElementById('app'));
    viewer.configure({ uiOptions: { hideOpenAndCloseButtons: true, hidePrintButton: true } });

    // Track page changes and notify parent (polling every 1 second)
    var lastPage = null;
    setInterval(function() {
      var p = viewer.getPageNumber();
      if (p && p !== lastPage) { lastPage = p; post('DJVU_PAGE_CHANGED', { page: p }); }
    }, 1000);

    // Handle messages from parent window
    window.addEventListener('message', function(ev) {
      var msg = ev.data;
      if (!msg || !msg.type) return;
      
      if (msg.type === 'LOAD_DJVU') {
        // Load document buffer into viewer
        viewer.loadDocument(msg.buffer, msg.name || '', msg.page ? { pageNumber: msg.page } : {})
          .then(function() {
            post('DJVU_LOADED');
            // If highlight text provided, apply it after short delay for rendering
            if (msg.highlight) setTimeout(function() { highlightText(msg.highlight); }, 500);
          })
          .catch(function(err) { post('DJVU_ERROR', { message: String(err && err.message || err) }); });
      }
    });

    /**
     * Highlights matching text on the current page.
     * Uses whitespace-normalized matching to handle DjVu OCR text variations.
     * 
     * @param {string} searchText - The text to find and highlight
     */
    function highlightText(searchText) {
      var attempts = 0;
      (function tryHighlight() {
        // Find text spans in the DjVu text layer (positioned absolutely)
        var spans = Array.from(document.querySelectorAll('#app span')).filter(function(s) {
          return s.textContent.trim() && getComputedStyle(s.parentElement).position === 'absolute';
        });
        
        // Retry if text layer not rendered yet
        if (!spans.length) { if (attempts++ < 20) setTimeout(tryHighlight, 300); return; }
        
        // Build text content map: [{el, start}, ...]
        var text = '', map = [];
        spans.forEach(function(s) { map.push({ el: s, start: text.length }); text += s.textContent; });
        
        // Normalize whitespace for matching
        var search = searchText.replace(/\\s+/g, '').toLowerCase();
        var idx = text.replace(/\\s+/g, '').toLowerCase().indexOf(search);
        if (idx === -1) return;
        
        // Map normalized position back to original text positions
        var pos = 0, startChar = 0, endChar = text.length;
        for (var i = 0; i < text.length && pos <= idx + search.length; i++) {
          if (!/\\s/.test(text[i])) {
            if (pos === idx) startChar = i;
            if (pos === idx + search.length - 1) { endChar = i + 1; break; }
            pos++;
          }
        }
        
        // Apply highlight class to matching spans
        map.forEach(function(m, i) {
          var end = (map[i + 1] ? map[i + 1].start : text.length);
          if (end > startChar && m.start < endChar) m.el.classList.add('djvu-highlight');
        });
        
        // Scroll first highlight into view
        var first = document.querySelector('.djvu-highlight');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })();
    }

    // Handle clicks: notify parent and clear highlights
    window.addEventListener('click', function() {
      post('DJVU_CLICK');
      document.querySelectorAll('.djvu-highlight').forEach(function(el) { el.classList.remove('djvu-highlight'); });
    }, true);

    // Handle right-click with selection: show context menu via parent
    window.addEventListener('contextmenu', function(ev) {
      var sel = (window.getSelection() || '').toString().trim();
      if (!sel) return;
      ev.preventDefault();
      post('DJVU_CONTEXT_MENU', { text: sel, page: viewer.getPageNumber() || 1, x: ev.clientX, y: ev.clientY });
    }, true);

    // Signal that viewer is ready
    post('DJVU_READY');
  })();
  </script>
</body>
</html>`;
	}
}
