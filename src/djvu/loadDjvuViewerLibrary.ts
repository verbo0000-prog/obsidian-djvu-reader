/**
 * DjVu Viewer Library Loader
 * 
 * Provides the resource path to the DjVu.js viewer UI library
 * stored in the plugin's vendor folder.
 * 
 * @module djvu/loadDjvuViewerLibrary
 */

import type { Plugin } from "obsidian";

/**
 * Gets the vault-relative path to the djvu_viewer.js library file.
 * 
 * @param plugin - The plugin instance to get paths from
 * @returns The vault-relative path to vendor/djvu_viewer.js
 */
function getVendorScriptPath(plugin: Plugin): string {
	const configDir = plugin.app.vault.configDir;
	return `${configDir}/plugins/${plugin.manifest.id}/vendor/djvu_viewer.js`;
}

/**
 * Gets a fully-qualified resource URL for the DjVu viewer library.
 * This URL can be used in iframe src or script tags.
 * 
 * @param plugin - The plugin instance
 * @returns An absolute resource URL that Obsidian can load
 */
export function getDjvuViewerLibraryResourcePath(plugin: Plugin): string {
	return plugin.app.vault.adapter.getResourcePath(getVendorScriptPath(plugin));
}
