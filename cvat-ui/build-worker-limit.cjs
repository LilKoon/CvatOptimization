// SPDX-License-Identifier: MIT

const os = require('node:os');

// The Docker build shares memory with the running CVAT stack.
// Cap build workers even when Docker Desktop exposes all host CPUs.
const workerCPUCount = 3;
const cpus = os.cpus();
const availableParallelism = os.availableParallelism;
os.cpus = () => cpus.slice(0, workerCPUCount);
os.availableParallelism = () => Math.min(availableParallelism(), workerCPUCount);
