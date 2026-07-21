import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the same build works served from an HTTP root (web/Capacitor)
  // and loaded directly via file:// (the Electron desktop shell).
  base: './',
});
