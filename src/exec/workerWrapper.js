const { workerData } = require('worker_threads');

const isDevMode = workerData.fullpath.endsWith(".ts")
if (isDevMode) {
    console.log("WorkerWrapper: Starting instance as TypeScript.")
    require('ts-node').register();
}
module.exports = require(workerData.fullpath);
