import { expect } from "vitest";

declare module "vitest" {
  interface Assertion<T = any> {
    toBeDisabled(): T;
    toBeVisible(): T;
  }
}

expect.extend({
  toBeDisabled(received: unknown) {
    const element = received instanceof HTMLButtonElement ? received : null;
    const disabled = element?.disabled === true;

    return {
      pass: disabled,
      message: () => `expected ${element?.outerHTML ?? String(received)} ${disabled ? "not " : ""}to be disabled`,
    };
  },
  toBeVisible(received: unknown) {
    const element = received instanceof HTMLElement ? received : null;
    const visible = element !== null && isVisible(element);

    return {
      pass: visible,
      message: () => `expected ${element?.outerHTML ?? String(received)} ${visible ? "not " : ""}to be visible`,
    };
  },
});

function isVisible(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);

    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    ) {
      return false;
    }
  }

  return true;
}
