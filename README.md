# intelligit

An Electron application with React, TypeScript, and a Go sidecar.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
# Start the main Electron application
$ npm run dev:main

# Start in test mode
$ npm run dev:test

# Start the default development mode
$ npm run dev
```

### Build

The Electron app depends on a Go sidecar binary. Every package build runs
`npm run build:sidecar` first, then runs TypeScript typechecking and
`electron-vite build`.

#### Sidecar build behavior

- If Go is installed and `go version` works, the build script recompiles the
  sidecar from `sidecar/`.
- On Windows, the sidecar output is `resources/intelligit-sidecar.exe`.
- On macOS/Linux, the sidecar output is `resources/intelligit-sidecar`.
- If Go is not installed, the build script reuses the matching prebuilt binary
  from `resources/`.
- If Go is not installed and the matching binary is missing from `resources/`,
  the build fails. Install Go or add a prebuilt sidecar binary before building.
- To force reuse of the existing binary even when Go is installed, set
  `INTELLIGIT_SKIP_SIDECAR_BUILD=1`.

#### Windows builds

```bash
# Build an unpacked Windows app directory for local inspection/testing
$ npm run build:unpack

# Build the Windows distributable package
$ npm run build:win
```

Both Windows commands disable certificate auto-discovery and executable signing
edits while invoking `electron-builder`.

#### Other platforms

```bash
# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

#### Manual sidecar build

```bash
# Windows
$ cd sidecar
$ go build -o ../resources/intelligit-sidecar.exe ./cmd/sidecar

# macOS / Linux
$ cd sidecar
$ go build -o ../resources/intelligit-sidecar ./cmd/sidecar
```
