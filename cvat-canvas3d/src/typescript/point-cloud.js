// SPDX-License-Identifier: MIT

import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';

export function decodePointCloud(data) {
    const { geometry } = new PCDLoader().parse(data);
    const positions = geometry.getAttribute('position')?.array;
    if (!positions?.length) return null;

    let length = 0;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            positions[length++] = x;
            positions[length++] = y;
            positions[length++] = z;
        }
    }
    return length ? (length === positions.length ? positions : positions.slice(0, length)) : null;
}
