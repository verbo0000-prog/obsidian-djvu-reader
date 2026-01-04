# DjVu Reader for Obsidian

View DjVu files directly inside Obsidian with full navigation, text selection, and deep linking support.

## Features

### View DjVu files
- Open `.djvu` and `.djv` files directly in Obsidian
- Full-featured viewer with zoom, page navigation, and continuous scroll mode
- Works on both desktop and mobile

### Page position memory
- Automatically remembers the last viewed page for each file
- When you reopen a file, it opens at the page where you left off

### Link to specific pages
- Create links to specific pages: `[[document.djvu#page=42]]`
- Click the link to open the document at that exact page

### Text selection and quoting
Right-click on selected text to access the context menu:
- **Copy** — Copy the selected text
- **Copy as quote** — Copy as a blockquote with a link back to the source
- **Copy link to selection** — Copy a link that opens the page and highlights the text

### Quote highlighting
- Links created with "Copy as quote" include the selected text
- When clicked, the document opens and the quoted text is highlighted in yellow
- Click anywhere to dismiss the highlight

## Installation

### From Community Plugins (recommended)
1. Open **Settings → Community plugins**
2. Select **Browse** and search for "DjVu Reader"
3. Select **Install**, then **Enable**

### Manual installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/yourusername/obsidian-djvu-reader/releases)
2. Create a folder `<vault>/.obsidian/plugins/obsidian-djvu-reader/`
3. Copy the downloaded files into the folder
4. Reload Obsidian and enable the plugin in **Settings → Community plugins**

## Usage

### Opening DjVu files
Simply click on any `.djvu` or `.djv` file in your vault to open it in the viewer.

### Creating page links
To link to a specific page, use the format:
```
[[path/to/document.djvu#page=15]]
```

### Creating quote links
1. Select text in the DjVu viewer
2. Right-click to open the context menu
3. Choose **Copy as quote** or **Copy link to selection**
4. Paste in your note

The pasted quote will look like:
```markdown
> This is the quoted text from the document
> spanning multiple lines if needed

[[document.djvu#page=15&q=...|document.djvu (page 15)]]
```

## Third-party libraries

This plugin uses [DjVu.js](https://djvu.js.org/) (MIT License) for DjVu file rendering.

## License

MIT License. See [LICENSE](LICENSE) for details.
