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
    const visible = element !== null && !element.hidden && element.getAttribute("aria-hidden") !== "true";

    return {
      pass: visible,
      message: () => `expected ${element?.outerHTML ?? String(received)} ${visible ? "not " : ""}to be visible`,
    };
  },
});
