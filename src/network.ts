import puppeteer, { type HTTPResponse } from "puppeteer";

import type { Options, Resource, ResourceType } from "./types.js";

function mapResourceType(
	response: HTTPResponse,
	mainFrameUrl: string,
): ResourceType | null {
	const request = response.request();
	const type = request.resourceType();
	const url = response.url();

	// Skip data URLs
	if (url.startsWith("data:")) return null;

	const contentType = response.headers()["content-type"] || "";
	switch (type) {
		case "stylesheet":
			return "stylesheet";
		case "script":
			return "script";
		case "image":
			// favicon detection
			if (url.match(/favicon|apple-touch-icon/i)) {
				return "favicon";
			}
			return "image";
		case "media": {
			if (contentType.startsWith("audio/")) return "audio";
			if (contentType.startsWith("video/")) return "video";
			return null;
		}
		case "font":
			return "font";
		case "manifest":
			return "manifest";
		case "document":
			if (contentType.startsWith("image/svg")) return "image";
			// iframe detection
			if (request.frame()?.parentFrame()) {
				return "iframe";
			}
			return null;
		case "other": {
			if (
				contentType.includes("application/pdf") ||
				contentType.includes("application/octet-stream")
			) {
				return "object";
			}
			return null;
		}
		default:
			return null;
	}
}

export async function* getAllSubResources(
	url: URL,
	options: Partial<Options> = {},
): AsyncGenerator<Resource, void, undefined> {
	let caughtError;
	const browser = await puppeteer.launch(options.puppeteerOptions);

	try {
		const page = await browser.newPage();

		const seen = new Set<string>();
		const queue: Resource[] = [];

		page.on("response", response => {
			const resourceType = mapResourceType(response, url.href);
			if (!resourceType) return;

			const resourceUrl = response.url();
			if (seen.has(resourceUrl)) return;

			seen.add(resourceUrl);
			queue.push({
				type: resourceType,
				url: resourceUrl,
			});
		});

		const response = await page.goto(url.href, {
			waitUntil: "networkidle0",
		});

		if (!response || !response.ok()) {
			const reason = response ? `. HTTP ${response.status()}` : "";
			throw new Error(`Failed to navigate to ${url}${reason}`);
		}

		// Yield network resources
		for (const resource of queue) {
			yield resource;
		}

		if (options.links) {
			const links = await page.$$eval("a[href]", elems =>
				(elems as HTMLAnchorElement[])
					.filter(el => el instanceof HTMLAnchorElement)
					.map(el => ({
						type: "link" as const,
						url: el.href,
					})),
			);

			for (const link of links) {
				if (!seen.has(link.url)) {
					seen.add(link.url);
					yield link;
				}
			}
		}
	} catch (error) {
		caughtError = error;
	} finally {
		await browser.close();
		if (caughtError) throw caughtError;
	}
}
