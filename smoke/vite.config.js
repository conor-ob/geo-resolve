// A browser bundle: Vite's client build resolves `geo-resolve` with browser conditions. Library mode
// leaves out the HTML entry's preload polyfill, so the bundle can then be run headless.
export default {
  build: {
    lib: { entry: "smoke.js", formats: ["es"], fileName: "smoke" },
  },
};
