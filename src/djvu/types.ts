export type DjVuGlobal = {
	VERSION: string;
	ErrorCodes: Record<string, string>;
	Document: new (buffer: ArrayBuffer, options?: { baseUrl?: string | null; memoryLimit?: number }) => unknown;
	Worker: new (urlToTheLibrary?: string) => {
		createDocument: (buffer: ArrayBuffer, options?: Record<string, unknown>) => Promise<unknown>;
		run: (...tasks: unknown[]) => Promise<unknown>;
		doc: unknown;
		cancelAllTasks?: () => void;
		reset?: () => void;
		revokeObjectURL?: (url: string) => void;
	};
	Viewer?: new () => {
		render: (container: HTMLElement) => void;
		unmount?: () => void;
		destroy?: () => void;
		configure?: (options?: {
			pageNumber?: number;
			pageRotation?: number;
			viewMode?: "continuous" | "single" | "text";
			pageScale?: number;
			language?: string;
			theme?: string;
			uiOptions?: Record<string, unknown>;
		}) => unknown;
		loadDocument: (buffer: ArrayBuffer, name?: string, config?: Record<string, unknown>) => Promise<void>;
		loadDocumentByUrl?: (url: string, config?: Record<string, unknown> | null) => Promise<void>;
		getPageNumber?: () => number;
	};
};

/**
 * Message types for communication between the parent window and the DjVu viewer iframe.
 */
export type DjvuIframeMessage =
	| { type: "DJVU_READY" }
	| { type: "DJVU_LOADED" }
	| { type: "DJVU_ERROR"; message?: string }
	| { type: "DJVU_CONTEXT_MENU"; text?: string; page?: number; x?: number; y?: number }
	| { type: "DJVU_PAGE_CHANGED"; page?: number }
	| { type: "DJVU_CLICK" };
