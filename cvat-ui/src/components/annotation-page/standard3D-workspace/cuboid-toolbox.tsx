// SPDX-License-Identifier: MIT

import './cuboid-toolbox.css';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { decodePointCloud } from 'cvat-canvas3d/src/typescript/point-cloud';

import { activateObject, changeFrameAsync, fetchAnnotationsAsync } from 'actions/annotation-actions';
import { getCVATStore } from 'cvat-store';
import { CombinedState } from 'reducers';
import { ThunkDispatch } from 'utils/redux';
import mountCuboidToolbox from './cuboid-toolbox-runtime';

export default function CuboidToolbox(): null {
    const job = useSelector((state: CombinedState) => state.annotation.job.instance);
    const dispatch = useDispatch<ThunkDispatch>();

    useEffect(() => {
        if (!job) return undefined;

        return mountCuboidToolbox({
            job,
            store: getCVATStore(),
            decodePointCloud,
            changeFrame: (frame: number) => dispatch(changeFrameAsync(frame)),
            refreshAnnotations: () => dispatch(fetchAnnotationsAsync()),
            selectObject: (id: number | null) => dispatch(activateObject(id, null, null)),
        });
    }, [dispatch, job]);

    return null;
}
