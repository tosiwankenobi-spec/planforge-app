import { Capacitor } from '@capacitor/core';

// The real backend customers' apps talk to. Update this once /server is deployed
// (see render.yaml — Render assigns this exact URL unless "planforge-server" is taken).
const PROD_API_BASE = 'https://planforge-server.onrender.com';

// Local dev only: 10.0.2.2 is the Android emulator's alias for the host machine's
// localhost; desktop (browser or Electron) reaches the same local server via plain localhost.
const LOCAL_API_BASE = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  ? 'http://10.0.2.2:3000'
  : 'http://localhost:3000';

// `import.meta.env.DEV` is true under `vite`/`vite dev` (npm run dev, electron:dev) —
// those always hit the local server. Production-mode builds (`vite build`, used for both
// the shipped .exe and the shipped APK) default to PROD; pass VITE_TARGET=local to a
// `vite build` (see `npm run build:local`) when you need a local-server build instead —
// e.g. testing the Android app on an emulator/device against your own machine.
const useLocal = import.meta.env.DEV || import.meta.env.VITE_TARGET === 'local';

export const API_BASE = useLocal ? LOCAL_API_BASE : PROD_API_BASE;
