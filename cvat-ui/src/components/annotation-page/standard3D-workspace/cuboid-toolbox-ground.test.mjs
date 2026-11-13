// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import test from 'node:test';

import * as ground from './cuboid-toolbox-runtime.js';

const { estimateLidarOriginGround } = ground;

function slopedCloud(origin) {
    const positions = [];
    for (let x = -7; x <= 7; x += 0.25) {
        for (let y = -7; y <= 7; y += 0.25) {
            const z = -1.55 + 0.06 * x - 0.04 * y;
            positions.push(origin[0] + x, origin[1] + y, z);
            if (x > 0 && y > 0) positions.push(origin[0] + x, origin[1] + y, z + 1.2);
        }
    }
    return new Float32Array(positions);
}

test('fits road height and slope relative to a world-coordinate LiDAR origin', () => {
    const origin = [450, -800];
    const plane = estimateLidarOriginGround(slopedCloud(origin), origin);
    assert.ok(plane);
    assert.ok(Math.abs(plane.a - 0.06) < 0.01);
    assert.ok(Math.abs(plane.b + 0.04) < 0.01);
    const groundAtOrigin = plane.a * origin[0] + plane.b * origin[1] + plane.c;
    assert.ok(Math.abs(groundAtOrigin + 1.55) < 0.02);
});

test('returns no plane when coverage is insufficient or the sensor origin is out of range', () => {
    assert.equal(estimateLidarOriginGround([0, 0, 0], [0, 0]), null);
    assert.equal(estimateLidarOriginGround(slopedCloud([450, -800]), [0, 0]), null);
});

test('uses the sensor XY plane through the PCD viewpoint with its own orientation', () => {
    const origin = [3, 4, 7];
    const halfAngle = Math.PI / 12;
    const plane = ground.lidarPlaneFromPcdHeader(
        `VERSION 0.7\nVIEWPOINT ${origin.join(' ')} ${Math.cos(halfAngle)} ${Math.sin(halfAngle)} 0 0\nDATA binary\n`,
    );
    const heightAt = (x, y) => plane.a * x + plane.b * y + plane.c;
    assert.ok(Math.abs(heightAt(3, 4) - 7) < 1e-9);
    assert.ok(Math.abs(heightAt(3, 5) - (7 + Math.tan(2 * halfAngle))) < 1e-9);
});

test('defaults to frame Z zero when no viewpoint is provided and rejects an invalid declared pose', () => {
    assert.deepEqual(ground.lidarPlaneFromPcdHeader('VERSION 0.7\nDATA ascii\n'), {
        a: 0, b: 0, c: 0, slopeDeg: 0,
    });
    assert.equal(ground.lidarPlaneFromPcdHeader('VIEWPOINT 0 0 0 0 0 0 0\nDATA binary\n'), null);
});
