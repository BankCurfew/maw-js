module.exports = {
  apps: [
    {
      name: 'maw',
      script: 'src/server.ts',
      interpreter: '/home/mbank/.local/bin/bun',
      watch: ['src'],
      watch_delay: 500,
      ignore_watch: ['node_modules', 'dist-office', 'office'],
      env: {
        MAW_HOST: 'local',
        MAW_PORT: '3456',
      },
    },
    {
      name: 'maw-boot',
      // interpreter: 'none' + script: bun-binary pattern bypasses PM2's
      // ProcessContainerForkBun.js require() wrapper, which crashes on Bun 1.3.11
      // when entrypoint (src/cli.ts) is top-level ESM. Mirrors oracle-api config.
      // Ref: Admin-Oracle admin-bot-health 2026-04-16, ruling path (a).
      script: '/home/mbank/.local/bin/bun',
      args: 'run src/cli.ts wake all --resume',
      interpreter: 'none',
      // One-shot: spawn fleet after server starts, don't restart
      autorestart: false,
      // Give maw server time to come up
      restart_delay: 5000,
    },
    {
      name: 'maw-bob',
      script: 'src/serve-bob.ts',
      interpreter: '/home/mbank/.local/bin/bun',
      watch: ['src/serve-bob.ts', 'src/auth.ts'],
      watch_delay: 500,
      env: {
        BOB_PORT: '3457',
        MAW_PORT: '3456',
      },
    },
    {
      name: 'maw-dev',
      script: 'node_modules/.bin/vite',
      args: '--host',
      cwd: './office',
      interpreter: '/home/mbank/.local/bin/bun',
      env: {
        NODE_ENV: 'development',
      },
      // Only start manually: pm2 start ecosystem.config.cjs --only maw-dev
      autorestart: false,
    },
  ],
};
