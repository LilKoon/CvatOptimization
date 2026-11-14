// SPDX-License-Identifier: MIT

import assert from 'node:assert/strict';
import test from 'node:test';

import * as ground from './cuboid-toolbox-runtime.js';

const { estimateLidarOriginGround } = ground;

test('keeps the ground under the cuboid when a wider scan includes a lower road', () => {
    const positions = [];
    for (let i = -100; i <= 100; i++) {
        for (let j = -100; j <= 100; j++) {
            const x = i / 10, y = j / 10;
            if (Math.abs(x) < 0.7 && Math.abs(y) < 0.3) continue;
            const nearFootprint = Math.abs(x) <= 1.6 && Math.abs(y) <= 1.0;
            positions.push(x, y, nearFootprint ? 0.14 + 0.03 * x - 0.025 * y : -0.08);
            if (nearFootprint && i % 6 === 0) positions.push(x, y, 0.48);
        }
    }
    for (const radius of [5, 10]) {
        const plane = ground.estimateFootGround(positions, {
            x: 0, y: 0, bottom: 0, radius, halfLength: 1, halfWidth: 0.4, yaw: 0,
        });
        assert.ok(plane);
        assert.ok(Math.abs(plane.c - 0.14) < 0.025, `R${radius} ground at the cuboid: ${plane.c}`);
        assert.ok(Math.abs(plane.a - 0.03) < 0.018);
        assert.ok(Math.abs(plane.b + 0.025) < 0.018);
    }
});

test('finds the ground across the scene despite denser walls and a raised platform', () => {
    const positions = [];
    for (let i = -40; i <= 40; i++) {
        for (let j = -40; j <= 40; j++) {
            const x = i / 2, y = j / 2;
            const z = -1 + 0.02 * x - 0.01 * y;
            positions.push(x, y, z);
            if (x > 0) positions.push(x, y, z + 1);
            if (j === 10) for (let k = 1; k <= 20; k++) positions.push(x, y, z + k / 4);
        }
    }
    const plane = ground.estimateSceneGround(positions);
    assert.ok(plane);
    assert.ok(Math.abs(plane.c + 1) < 0.03);
    assert.ok(Math.abs(plane.a - 0.02) < 0.01);
    assert.ok(Math.abs(plane.b + 0.01) < 0.01);
    assert.equal(ground.estimateSceneGround(positions.filter((_, i) => i < 9)), null);
});

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
