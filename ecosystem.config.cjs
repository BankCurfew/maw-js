const MAW_ROOT = '/home/mbank/repos/github.com/BankCurfew/maw-js';

module.exports = {
  apps: [
    {
      name: 'maw',
      script: 'src/core/server.ts',
      cwd: MAW_ROOT,
      interpreter: '/home/mbank/.local/bin/bun',
      watch: false,
      max_restarts: 5,
      restart_delay: 3000,
      env: {
        MAW_HOST: 'local',
        MAW_PORT: '3456',
      },
    },
    {
      name: 'maw-boot',
      script: '/home/mbank/.local/bin/bun',
      args: 'run src/cli.ts wake all --resume',
      cwd: MAW_ROOT,
      interpreter: 'none',
      autorestart: false,
      restart_delay: 5000,
    },
    // maw-dev moved to Soul-Brews-Studio/maw-ui (bun run dev)
    // maw-broker removed — MQTT layer deleted in 3b71daa (WebSocket handles broadcast)
  ],
};
