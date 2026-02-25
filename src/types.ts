export type ResourceType =
	| "stylesheet"
	| "script"
	| "image"
	| "favicon"
	| "video"
	| "audio"
	| "object"
	| "iframe"
	| "link"
	| "font"
	| "manifest";

export interface Resource {
	type: ResourceType;
	url: string;
}

export interface Options {
	links: boolean;
	puppeteerOptions?: import("puppeteer").LaunchOptions;
}
