const MAW_ROOT = '/home/mbank/repos/github.com/BankCurfew/maw-js';

module.exports = {
  apps: [
    {
      name: 'maw',
      script: 'src/core/server.ts',
      cwd: MAW_ROOT,
      interpreter: '/home/mbank/.local/bin/bun',
      watch: false,
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
  ],
};
