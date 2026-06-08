if (!globalThis.process) {
  Object.defineProperty(globalThis, 'process', {
    value: {
      env: {},
      browser: true
    },
    configurable: true,
    enumerable: false,
    writable: true
  })
}
