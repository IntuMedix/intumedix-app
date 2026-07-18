import { defineConfig } from '@capacitor/cli';

const config = defineConfig({
  appId: 'com.intumedix.app',
  appName: 'IntuMedix',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a0e1a',
      androidSplashResourceName: 'splash',
    }
  }
});

export default config;
