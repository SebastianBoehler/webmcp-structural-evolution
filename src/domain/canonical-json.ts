export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const UNSUPPORTED = "Unsupported canonical JSON value";

function serialize(value: unknown, ancestors: WeakSet<object>, path: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`${UNSUPPORTED} at ${path}`);
      return Object.is(value, -0) ? "-0" : String(value);
    case "object":
      break;
    default:
      throw new TypeError(`${UNSUPPORTED} at ${path}`);
  }

  if (ancestors.has(value)) {
    throw new TypeError(`${UNSUPPORTED} at ${path}: circular reference`);
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError(`${UNSUPPORTED} at ${path}[${index}]: sparse array`);
        }
        items.push(serialize(value[index], ancestors, `${path}[${index}]`));
      }
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${UNSUPPORTED} at ${path}`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`${UNSUPPORTED} at ${path}: symbol key`);
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (descriptor?.get || descriptor?.set) {
          throw new TypeError(`${UNSUPPORTED} at ${path}.${key}: accessor`);
        }
        return `${JSON.stringify(key)}:${serialize(record[key], ancestors, `${path}.${key}`)}`;
      });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, new WeakSet<object>(), "$");
}
