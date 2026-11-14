// SPDX-License-Identifier: MIT

export function annotationFingerprint(state) {
    const input = JSON.stringify([
        [...state.points], state.label?.id, state.group?.id ?? state.group, state.outside, state.occluded,
        state.keyframe, state.zOrder, state.rotation,
        Object.entries(state.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    let a = 2166136261;
    let b = 5381;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        a = Math.imul(a ^ char, 16777619);
        b = Math.imul(b, 33) ^ char;
    }
    return [input.length, a >>> 0, b >>> 0].join(':');
}

export function issueGroups(issues) {
    const groups = [];
    const ordered = [...issues].sort((a, b) => a.trackId - b.trackId || a.type.localeCompare(b.type) ||
        String(a.related ?? '').localeCompare(String(b.related ?? '')) || a.frame - b.frame);
    for (const issue of ordered) {
        const group = groups.at(-1);
        if (group && issue.trackId === group.id && issue.type === group.type &&
            issue.related === group.related && issue.frame === group.end + 1) {
            group.end = issue.frame;
            group.issues.push(issue);
        } else {
            groups.push({
                id: issue.trackId, type: issue.type, related: issue.related,
                start: issue.frame, end: issue.frame, issues: [issue],
            });
        }
    }
    return groups;
}

export function resizeFace(points, normal, axis, delta, symmetric) {
    const next = [...points];
    const sizeIndex = 6 + axis;
    next[sizeIndex] = Math.max(0.1, points[sizeIndex] + delta * (symmetric ? 2 : 1));
    if (!symmetric) {
        const step = (next[sizeIndex] - points[sizeIndex]) / 2;
        for (let i = 0; i < 3; i++) next[i] += normal[i] * step;
    }
    return next;
}

export function pointsInRegion(positions, region) {
    const output = new Float32Array(positions.length);
    const [[x0, x1], [y0, y1], [z0, z1]] = region.bounds;
    let length = 0;
    for (let i = 0; i + 2 < positions.length; i += 3) {
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
        if (inside !== region.include) continue;
        output[length++] = x;
        output[length++] = y;
        output[length++] = z;
    }
    return output.subarray(0, length);
}

function copyKey(key) {
    const { id, ...shape } = key;
    return { ...shape, points: [...key.points], attributes: key.attributes.map((attribute) => ({ ...attribute })) };
}

function trackFrom(track, shapes) {
    const { id, clientID, ...metadata } = track;
    return { ...metadata, frame: shapes[0].frame, shapes: shapes.map(copyKey) };
}

function observationKey(state) {
    return {
        type: 'cuboid',
        frame: state.frame,
        points: [...state.points],
        outside: !!state.outside,
        occluded: !!state.occluded,
        z_order: state.zOrder,
        rotation: state.rotation,
        attributes: state.label.attributes.filter((attribute) =>
            attribute.mutable && state.attributes[attribute.id] !== undefined).map(({ id }) => ({
            spec_id: id, value: state.attributes[id],
        })),
    };
}

// Add evaluated keys at the edge of a changed interval. The original sparse keys
// outside the interval then interpolate to the same values as before the repair.
export function planTrackRepair({ action, a, b, from, to, frames }) {
    const visible = (state) => state && !state.outside;
    const at = (frame, side) => frames.get(frame)?.[side];
    const nearest = (frame, side, direction) => {
        const keys = [...frames.keys()].filter((f) => direction < 0 ? f < frame : f > frame);
        if (direction < 0) keys.reverse();
        return keys.map((f) => at(f, side)).find(Boolean);
    };
    const byFrame = (keys) => [...new Map(keys.map((key) => [key.frame, key])).values()]
        .sort((left, right) => left.frame - right.frame);
    if (action === 'split') {
        const pivot = at(from, 'a');
        const previous = nearest(from, 'a', -1);
        if (!visible(pivot) || !visible(previous) || from <= a.frame) {
            throw new Error('Chọn frame tách có cuboid hiện diện ở cả hai phía.');
        }
        const left = byFrame([...a.shapes.filter((key) => key.frame < from),
            observationKey(previous), { ...observationKey(pivot), outside: true }]);
        const right = byFrame([observationKey(pivot), ...a.shapes.filter((key) => key.frame >= from)]);
        return [trackFrom(a, left), trackFrom(a, right)];
    }
    if (a.label_id !== b?.label_id) throw new Error('Hai track phải dùng cùng nhãn.');
    if (action === 'swap') {
        const keysA = [], keysB = [];
        const first = [...frames.keys()].find((frame) => frame >= from && frame <= to);
        const last = [...frames.keys()].filter((frame) => frame >= from && frame <= to).at(-1);
        if (first === undefined) throw new Error('Dải hoán đổi không có frame.');
        for (const [frame, entry] of frames) {
            if (frame < from || frame > to) continue;
            if (!visible(entry.a) || !visible(entry.b)) throw new Error(`Hai track phải hiện diện tại F${frame}.`);
            if (frame === first || frame === last || entry.b.keyframe) keysA.push(observationKey(entry.b));
            if (frame === first || frame === last || entry.a.keyframe) keysB.push(observationKey(entry.a));
        }
        const swap = (track, side, keys) => {
            const guards = [nearest(first, side, -1), nearest(last, side, 1)].filter(Boolean).map(observationKey);
            return trackFrom(track, byFrame([...guards, ...track.shapes.filter((key) =>
                key.frame < from || key.frame > to), ...keys]));
        };
        return [swap(a, 'a', keysA), swap(b, 'b', keysB)];
    }
    if (action !== 'join') throw new Error('Thao tác track không hợp lệ.');
    const keys = [];
    const seen = { a: false, b: false };
    let prior = null;
    let side = null;
    for (const [frame, entry] of frames) {
        const hasA = visible(entry.a), hasB = visible(entry.b);
        if (hasA && hasB) throw new Error(`Hai track chồng tại F${frame}. Tách đoạn xung đột trước.`);
        const nextSide = hasA ? 'a' : hasB ? 'b' : null;
        const state = nextSide ? entry[nextSide] : null;
        if (side && side !== nextSide) {
            keys.push(observationKey(prior));
            if (!state) keys.push({ ...observationKey(prior), frame, outside: true });
        }
        if (state) {
            if (side !== nextSide || state.keyframe) keys.push(observationKey(state));
            seen[nextSide] = true;
        }
        side = nextSide;
        prior = state;
    }
    if (!seen.a || !seen.b) throw new Error('Cần hai track có cuboid hiện diện.');
    return [trackFrom(a, byFrame(keys))];
}
