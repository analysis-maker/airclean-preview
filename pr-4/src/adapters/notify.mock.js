// @ts-check

export function createNotifier() {
  /** @type {any[]} */
  const items = [];
  return {
    items,
    /** @param {any} notice */
    push(notice) {
      items.push(notice);
      return notice;
    },
  };
}
