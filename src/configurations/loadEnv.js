const dotenv = require('dotenv');

function loadEnv(appEnv) {
    const envPaths = {
        local: 'src/env/.env',
        dev: 'src/env/.env.dev',
        uat: 'src/env/.env.uat',
        prod: 'src/env/.env.prod',
    };

    const envPath = envPaths[appEnv];
    if (envPath) {
        dotenv.config({ path: envPath });
    } else {
        console.warn(`Unknown APP_ENV: ${appEnv}`);
    }
}

module.exports = { loadEnv };