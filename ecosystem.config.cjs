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
      script: 'src/cli.ts',
      args: 'wake all --resume',
      interpreter: '/home/mbank/.local/bin/bun',
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
