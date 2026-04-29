export function getDomainFaviconUrl(domain: string, size = 128): string {
	return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
		domain
	)}&sz=${size}`
}
