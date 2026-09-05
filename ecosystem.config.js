module.exports = {
    apps: [
        {
            name: "carry-tavern",
            script: "./shutdown.js",
            cwd: __dirname,
            instances: 1,
            exec_mode: "fork",
            autorestart: false,
            watch: false,
            max_memory_restart: "512M",
            restart_delay: 3000,
            kill_timeout: 10000,
            time: true,
            env: {
                NODE_ENV: "production",
            },
        },
    ],
};
