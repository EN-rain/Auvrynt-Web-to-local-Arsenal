module.exports = {
  apps: [{
    name: "auvrynt",
    script: "auvrynt",
    args: "start",
    interpreter: "none",
    restart_delay: 3000,
    max_restarts: 10,
    min_uptime: 10000,
    exp_backoff_restart_delay: 100,
    watch: false,
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    error_file: "~/.auvrynt/logs/pm2-error.log",
    out_file: "~/.auvrynt/logs/pm2-out.log",
  }]
};
