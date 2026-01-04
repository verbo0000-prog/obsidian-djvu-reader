/**
 * DjVu Core Library Loader
 * 
 * Provides the resource path to the DjVu.js core library
 * stored in the plugin's vendor folder.
 * 
 * @module djvu/loadDjvuLibrary
 */

import type { Plugin } from "obsidian";

/**
 * Gets the vault-relative path to the djvu.js library file.
 * 
 * @param plugin - The plugin instance to get paths from
 * @returns The vault-relative path to vendor/djvu.js
 */
function getVendorScriptPath(plugin: Plugin): string {
	const configDir = plugin.app.vault.configDir;
	return `${configDir}/plugins/${plugin.manifest.id}/vendor/djvu.js`;
}

/**
 * Gets a fully-qualified resource URL for the DjVu core library.
 * This URL can be used in iframe src or script tags.
 * 
 * @param plugin - The plugin instance
 * @returns An absolute resource URL that Obsidian can load
 */
export function getDjvuLibraryResourcePath(plugin: Plugin): string {
	return plugin.app.vault.adapter.getResourcePath(getVendorScriptPath(plugin));
}
