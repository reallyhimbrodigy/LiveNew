# Deployment Guide

## Available npm Scripts

### Development
```bash
npm start           # Start Expo dev server
npm run android     # Start on Android device/emulator
npm run ios         # Start on iOS device/simulator
npm run web         # Start web version
```

### Deployment
```bash
npm run login       # Login to EAS (one-time setup)
npm run deploy      # Auto-deploy update to all branches
npm run deploy:prod # Deploy to production branch
npm run deploy:dev  # Deploy to development branch
```

### Building
```bash
npm run build         # Build for all platforms
npm run build:ios     # Build iOS app
npm run build:android # Build Android app
```

### Git
```bash
npm run push        # Push to GitHub (main branch)
```

## Deployment Workflow

### First Time Setup
1. Login to EAS:
   ```bash
   npm run login
   ```

### Regular Updates
1. Make your code changes
2. Test locally:
   ```bash
   npm start
   ```
3. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "Your commit message"
   npm run push
   ```
4. Deploy the update:
   ```bash
   npm run deploy
   ```

### Full Build (for app stores)
```bash
npm run build
```

## Notes
- No need to use `npx` anymore - all commands are available via `npm run`
- EAS CLI is installed locally as a dev dependency
- Changes are automatically pushed to GitHub before deployment
