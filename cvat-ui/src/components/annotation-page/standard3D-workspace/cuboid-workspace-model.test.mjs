import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationFingerprint, issueGroups, planTrackRepair, pointsInRegion, resizeFace } from './cuboid-workspace-model.js';
import { estimateFootGround } from './cuboid-toolbox-runtime.js';

const state = (frame, x, overrides = {}) => ({
    frame, label: { id: 1, attributes: [{ id: 1, mutable: true }, { id: 2, mutable: false }] },
    attributes: { 1: 'visible', 2: 'identity' }, group: 7, keyframe: frame % 4 === 0,
    points: [x, 0, 0, 0.15, -0.1, 0.3, 4, 2, 2], outside: false, occluded: false,
    zOrder: 0, rotation: 0, ...overrides,
});
const track = (clientID, from, to, offset) => ({
    clientID, id: clientID * 10, label_id: 1, frame: from, group: 7, source: 'manual',
    attributes: [{ spec_id: 2, value: 'identity' + clientID }], elements: [],
    shapes: [from, to].map((frame) => ({
        id: 100 + frame, type: 'cuboid', frame, points: state(frame, offset + frame).points,
        outside: false, occluded: false, z_order: 0, rotation: 0, attributes: [{ spec_id: 1, value: 'visible' }],
    })),
});

test('resize keeps the world position of the opposite face with a tilted local axis', () => {
    const p = state(0, 3).points;
    const n = [0.6, -0.48, 0.64];
    const next = resizeFace(p, n, 2, 0.7, false);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(next[i] - n[i] * next[8] / 2 - (p[i] - n[i] * p[8] / 2)) < 1e-12);
    assert.deepEqual(resizeFace(p, n, 2, -8, true).slice(0, 3), p.slice(0, 3));
});

test('review fingerprints track annotation changes but ignore client/server ID remapping', () => {
    const a = state(2, 3);
    assert.equal(annotationFingerprint(a), annotationFingerprint({ ...a, clientID: 100, serverID: 10 }));
    assert.notEqual(annotationFingerprint(a), annotationFingerprint(state(2, 3.05)));
    assert.notEqual(annotationFingerprint(a), annotationFingerprint({ ...a, outside: true }));
});

test('issue grouping ends on a gap and keeps related objects separate', () => {
    const mk = (frame, related) => ({ frame, trackId: 3, type: 'overlap', related });
    const result = issueGroups([mk(8, 5), mk(3, 5), mk(4, 7), mk(4, 5)]);
    assert.deepEqual(result.map((g) => [g.start, g.end, g.related]), [[3, 4, 5], [8, 8, 5], [4, 4, 7]]);
});

test('ROI resolves same-XY returns at different heights', () => {
    const cloud = [1, 1, 0, 1, 1, 4, 2, 2, 0];
    const bounds = [[0.5, 1.5], [0.5, 1.5], [-0.2, 0.2]];
    assert.deepEqual([...pointsInRegion(cloud, { bounds, include: true })], [1, 1, 0]);
    assert.deepEqual([...pointsInRegion(cloud, { bounds, include: false })], [1, 1, 4, 2, 2, 0]);
});

test('ground evidence is returned in world coordinates with measurable residual', () => {
    const cloud = [];
    for (let i = -45; i <= 45; i++) for (let j = -45; j <= 45; j++) {
        const x = 20 + i / 20, y = -10 + j / 20;
        cloud.push(x, y, 0.02 * x + 0.01 * y);
    }
    const plane = estimateFootGround(cloud, { x: 20, y: -10, bottom: 0.3, radius: 5, halfLength: 1.5, halfWidth: 0.8, yaw: 0.7 }, true);
    assert.ok(plane && plane.coverage >= 3);
    assert.equal(plane.count, plane.support.length);
    assert.ok(plane.residual < 1e-8);
    assert.ok(plane.support.every(([x, y, z]) => Math.abs(plane.a * x + plane.b * y + plane.c - z) < 1e-8));
});

test('split carries observation at the boundary and clears old server IDs', () => {
    const a = track(1, 0, 8, 0);
    const frames = new Map(Array.from({ length: 9 }, (_, f) => [f, { a: state(f, f) }]));
    const [left, right] = planTrackRepair({ action: 'split', a, from: 3, frames });
    assert.deepEqual(left.shapes.map(({ frame, outside }) => [frame, outside]), [[0, false], [2, false], [3, true]]);
    assert.equal(right.shapes[0].frame, 3);
    assert.equal(right.shapes[0].points[0], 3);
    assert.equal(right.group, 7);
    assert.equal(right.id, undefined);
    assert.ok(right.shapes.every(({ id }) => id === undefined));
});

test('merge preserves an Outside gap and blocks overlapping observations', () => {
    const a = track(1, 0, 2, 0);
    const b = track(2, 5, 8, 20);
    const frames = new Map(Array.from({ length: 9 }, (_, f) => [f, {
        a: f <= 2 ? state(f, f) : undefined,
        b: f >= 5 ? state(f, 20 + f) : undefined,
    }]));
    const [merged] = planTrackRepair({ action: 'join', a, b, frames });
    assert.equal(merged.shapes.find((key) => key.frame === 3).outside, true);
    assert.equal(merged.shapes.find((key) => key.frame === 5).outside, false);
    assert.equal(merged.attributes[0].value, 'identity1');
    frames.get(2).b = state(2, 25);
    assert.throws(() => planTrackRepair({ action: 'join', a, b, frames }), /F2/);
});

test('swap preserves the boundary values and moves mutable observation fields only', () => {
    const a = track(1, 0, 8, 0);
    const b = track(2, 0, 8, 20);
    const frames = new Map(Array.from({ length: 9 }, (_, f) => [f, {
        a: state(f, f), b: state(f, 20 + f, { attributes: { 1: 'covered', 2: 'other' }, occluded: true }),
    }]));
    const [left, right] = planTrackRepair({ action: 'swap', a, b, from: 2, to: 6, frames });
    const at = (t, f) => t.shapes.find(({ frame }) => frame === f);
    assert.equal(at(left, 1).points[0], 1);
    assert.equal(at(left, 2).points[0], 22);
    assert.equal(at(left, 4).attributes[0].value, 'covered');
    assert.equal(at(left, 4).occluded, true);
    assert.equal(at(left, 7).points[0], 7);
    assert.equal(at(right, 6).points[0], 6);
    assert.equal(left.attributes[0].value, 'identity1');
});
