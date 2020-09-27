import puppeteer, { Page } from "puppeteer";

export const enum ResourceType {
	stylesheet = "stylesheet",
	script = "script",
	image = "image",
	video = "video",
	audio = "audio",
	iframe = "iframe",
	manifest = "manifest",
}

export interface Resource {
	type: ResourceType;
	url: string;
}

export async function* getAllSubResources(
	url: URL,
): AsyncGenerator<Resource, void, undefined> {
	let caughtError;
	const browser = await puppeteer.launch();
	try {
		const page = await browser.newPage();
		const response = await page.goto(url.href, {});

		if (!response || !response.ok()) {
			const reason = response ? `. HTTP ${response.status()}` : "";
			throw new Error(`Failed to navigate to ${url}${reason}`);
		}

		yield* await getStyleSheets(page);
		yield* await getImportedStyleSheets(page);
		yield* await getScripts(page);
		yield* await getMedia(page);
		yield* await getStyleSheetImages(page);
		yield* await getIframes(page);
		yield* await getMiscResources(page);
	} catch (error) {
		caughtError = error;
	} finally {
		await browser.close();
		if (caughtError) throw caughtError;
	}
}

async function getStyleSheets(page: Page) {
	return await page.$$eval(`link[rel="stylesheet"]`, elems => {
		return (elems as HTMLLinkElement[]).map(elem => {
			return {
				type: ResourceType.stylesheet as const,
				url: elem.href,
			};
		});
	});
}

async function getImportedStyleSheets(page: Page) {
	return await page.evaluate((pageURL: string) => {
		const importedStylesheets = [];
		for (const stylesheet of document.styleSheets) {
			const baseURL = stylesheet.href || pageURL;
			for (const rule of stylesheet.cssRules) {
				if (rule instanceof CSSImportRule) {
					const url = new URL(rule.href, baseURL).href;
					importedStylesheets.push({
						type: ResourceType.stylesheet as const,
						url,
					});
				}
			}
		}
		return importedStylesheets;
	}, page.url());
}

async function getScripts(page: Page) {
	return await page.$$eval(`script[src]`, elems => {
		return (elems as HTMLScriptElement[]).map(elem => {
			return {
				type: ResourceType.script as const,
				url: elem.src,
			};
		});
	});
}

async function getMedia(page: Page) {
	type MediaResource = HTMLImageElement | HTMLVideoElement | HTMLSourceElement;
	const mediaSources = await page.$$eval(
		`img[src], video > source[src], video[src], audio[src]`,
		elems => {
			const images = [];
			for (const elem of elems as MediaResource[]) {
				let type;
				if (elem instanceof HTMLImageElement) {
					type = ResourceType.image as const;
				} else if (elem instanceof HTMLVideoElement) {
					type = ResourceType.video as const;
				} else if (elem instanceof HTMLSourceElement) {
					if (elem.parentElement instanceof HTMLVideoElement) {
						type = ResourceType.video as const;
					} else {
						type = ResourceType.audio as const;
					}
				} else {
					throw new Error("Reached unreachable code.");
				}
				images.push({
					type,
					url: elem.src,
				});
			}
			return images;
		},
	);

	const imageSrcSets = await page.$$eval(
		`img[srcset], picture > source[srcset]`,
		(elems, pageURL: string) => {
			const images = [];
			for (const elem of elems as (HTMLImageElement | HTMLSourceElement)[]) {
				images.push(
					...elem.srcset
						.trim()
						.split(/,\s+/)
						.filter(s => s.trim())
						.map(part => {
							const src = part.trim().split(/\s+/, 2)[0];
							const url = new URL(src, pageURL).href;
							return {
								type: ResourceType.image as const,
								url,
							};
						}),
				);
			}
			return images;
		},
		page.url(),
	);

	return [...mediaSources, ...imageSrcSets];
}

async function getStyleSheetImages(page: Page) {
	return await page.evaluate((pageURL: string) => {
		const urls = [];
		for (const stylesheet of document.styleSheets) {
			const baseURL = stylesheet.href || pageURL;
			for (const rule of stylesheet.cssRules) {
				if (rule instanceof CSSStyleRule && rule.style.backgroundImage) {
					urls.push(
						...rule.style.backgroundImage
							.split(",")
							.map(s => s.match(/url\("([^)]+)"\)/))
							.map(s => (s ? s[1].trim() : undefined))
							.filter((s): s is string => !!s)
							.map(url => new URL(url, baseURL).href),
					);
				}
			}
		}
		return urls.map(url => ({
			type: ResourceType.image as const,
			url,
		}));
	}, page.url());
}

async function getIframes(page: Page) {
	return await page.$$eval(`iframe[src]`, elems => {
		const iframes = [];
		for (const elem of elems as HTMLIFrameElement[]) {
			iframes.push({
				type: ResourceType.iframe as const,
				url: elem.src,
			});
		}
		return iframes;
	});
}

async function getMiscResources(page: Page) {
	const manifest = await page
		.$eval(`link[rel="manifest"]`, elem => {
			return {
				type: ResourceType.manifest as const,
				url: (elem as HTMLLinkElement).href,
			};
		})
		.catch(() => null);

	return [manifest].filter(
		(resource): resource is NonNullable<typeof resource> => resource !== null,
	);
}
