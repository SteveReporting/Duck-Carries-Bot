module.exports = {
    apps: [
        {
            name: "carry-tavern",
            script: "./index.js",
            cwd: __dirname,
            node_args: "-r ./env-bootstrap.js -r ./security-command-pass-through.js",
            instances: 1,
            exec_mode: "fork",
            autorestart: true,
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
