// @ts-check

/**
 * Read a JSON file. Node uses the filesystem. The browser uses a same-origin fetch.
 * @param {URL} url
 */
export async function readJson(url) {
  if (typeof window === "undefined") {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(url, "utf8");
    return JSON.parse(text);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not read ${url.pathname || url.href}`);
  }
  return response.json();
}
