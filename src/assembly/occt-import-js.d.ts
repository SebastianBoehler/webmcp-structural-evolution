declare module "occt-import-js" {
  const factory: (options?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default factory;
}

declare module "occt-import-js/dist/occt-import-js.wasm?url" {
  const url: string;
  export default url;
}
