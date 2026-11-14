// SPDX-License-Identifier: MIT

import type { getCVATStore } from 'cvat-store';
import type { Job } from 'cvat-core-wrapper';

export default function mountCuboidToolbox(options: {
    job: Job;
    store: ReturnType<typeof getCVATStore>;
    decodePointCloud: (data: ArrayBuffer) => Float32Array | null;
    changeFrame: (frame: number) => Promise<void>;
    refreshAnnotations: () => Promise<void>;
    selectObject: (id: number | null) => void;
}): () => void;
