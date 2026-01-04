/**
 * Obsidian DjVu Reader Plugin
 * 
 * This plugin enables viewing DjVu files directly within Obsidian.
 * It uses the DjVu.js library (MIT licensed) to render documents
 * in an isolated iframe for security and compatibility.
 * 
 * @module main
 */

import { Plugin } from "obsidian";
import { DjvuView, VIEW_TYPE_DJVU } from "./views/DjvuView";

/**
 * Plugin data structure persisted to disk.
 * Stores per-file reading positions to restore when reopening files.
 */
interface DjVuPluginData {
	/** Maps file paths to their last viewed page numbers */
	filePages: Record<string, number>;
}

/** Default plugin data with empty page tracking */
const DEFAULT_DATA: DjVuPluginData = {
	filePages: {},
};

/**
 * Main plugin class for the DjVu Reader.
 * 
 * Responsibilities:
 * - Registers the custom DjVu view for .djvu and .djv files
 * - Persists and retrieves per-file page positions
 * - Manages plugin lifecycle (load/unload)
 */
export default class DjVuReaderPlugin extends Plugin {
	/** Persisted plugin data containing reading positions */
	private data: DjVuPluginData = DEFAULT_DATA;

	/**
	 * Called when the plugin is loaded.
	 * Registers the DjVu file view and supported extensions.
	 */
	async onload(): Promise<void> {
		// Load saved page positions from disk
		await this.loadPluginData();
		
		// Register our custom view for DjVu files
		this.registerView(VIEW_TYPE_DJVU, (leaf) => new DjvuView(leaf, this));
		
		// Associate .djvu and .djv extensions with our view
		this.registerExtensions(["djvu", "djv"], VIEW_TYPE_DJVU);
	}

	/**
	 * Loads plugin data from Obsidian's data store.
	 * Merges with defaults to handle missing properties.
	 */
	private async loadPluginData(): Promise<void> {
		this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
	}

	/**
	 * Gets the last viewed page number for a file.
	 * 
	 * @param filePath - The vault-relative path to the DjVu file
	 * @returns The page number, or null if not previously opened
	 */
	getFilePage(filePath: string): number | null {
		return this.data.filePages[filePath] ?? null;
	}

	/**
	 * Saves the current page number for a file.
	 * Called automatically when the user navigates pages.
	 * 
	 * @param filePath - The vault-relative path to the DjVu file
	 * @param page - The current page number (1-indexed)
	 */
	async setFilePage(filePath: string, page: number): Promise<void> {
		this.data.filePages[filePath] = page;
		await this.saveData(this.data);
	}
}
